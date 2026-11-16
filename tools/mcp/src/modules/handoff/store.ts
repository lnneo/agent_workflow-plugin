import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import type { SqliteDatabase } from "./db.js";
import {
  syncGitState as runSyncGitState,
  syncWorkspaceFromManifest as runSyncWorkspace,
  type SyncGitStateInput,
  type SyncGitStateResult,
  type SyncWorkspaceInput,
  type SyncWorkspaceResult
} from "./git-sync.js";
import type {
  ActivityLogInput,
  ActivityLogRecord,
  ActivityStatus,
  BranchHistoryView,
  CommitRecord,
  DeployStatus,
  DeploymentRecord,
  EnvName,
  EventType,
  EventView,
  HandoffSnapshot,
  Project,
  SpecContract,
  Task,
  TaskProjectRole,
  TaskStatus,
  VerifyType,
  Workspace
} from "./types.js";

function normalizePath(p: string): string {
  const resolved = resolve(p);
  if (existsSync(resolved)) {
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  }
  return resolved;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseEvent(row: {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string;
  ts: string;
  type: string;
  summary: string;
  payload: string;
  created_at: string;
}): EventView {
  return {
    ...row,
    type: row.type as EventType,
    payload: JSON.parse(row.payload) as unknown
  };
}

export class HandoffStore {
  private readonly logListeners = new Set<(log: ActivityLogRecord) => void>();

  constructor(private readonly db: SqliteDatabase) {}

  onActivityLog(listener: (log: ActivityLogRecord) => void): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  logActivity(input: ActivityLogInput): ActivityLogRecord {
    const id = randomUUID();
    const ts = input.ts ?? nowIso();
    const status: ActivityStatus = input.status ?? "info";
    const filesJson = JSON.stringify(input.files_changed ?? []);
    const detailsJson = input.details ? JSON.stringify(input.details) : null;

    this.db
      .prepare(
        `INSERT INTO activity_logs (
           id, ts, workspace_slug, project_slug, task_slug, stage, source, action,
           status, duration_ms, commit_hash, files_changed, summary, details_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        ts,
        input.workspace_slug ?? null,
        input.project_slug ?? null,
        input.task_slug ?? null,
        input.stage ?? null,
        input.source,
        input.action,
        status,
        input.duration_ms ?? null,
        input.commit_hash ?? null,
        filesJson,
        input.summary,
        detailsJson
      );

    const record = this.db
      .prepare(`SELECT * FROM activity_logs WHERE id = ?`)
      .get(id) as ActivityLogRecord;

    for (const listener of this.logListeners) {
      try {
        listener(record);
      } catch {
        // ignore listener errors
      }
    }
    return record;
  }

  listActivityLogs(filters?: {
    workspace_slug?: string;
    source?: string;
    status?: string;
    q?: string;
    limit?: number;
  }): ActivityLogRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters?.workspace_slug) {
      where.push("workspace_slug = ?");
      params.push(filters.workspace_slug);
    }
    if (filters?.source) {
      where.push("source = ?");
      params.push(filters.source);
    }
    if (filters?.status) {
      where.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.q) {
      where.push(
        "(summary LIKE ? OR action LIKE ? OR commit_hash LIKE ? OR files_changed LIKE ? OR task_slug LIKE ?)"
      );
      const pattern = `%${filters.q}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    const sql = `SELECT * FROM activity_logs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ts DESC LIMIT ?`;
    params.push(Math.min(Math.max(filters?.limit ?? 150, 1), 500));
    return this.db.prepare(sql).all(...params) as ActivityLogRecord[];
  }

  upsertWorkspace(input: {
    slug: string;
    name: string;
    timezone?: string;
    manifest_path?: string;
    deploy_order?: string[];
  }): Workspace {
    const existing = this.db
      .prepare(`SELECT * FROM workspaces WHERE slug = ?`)
      .get(input.slug) as Workspace | undefined;

    const ts = nowIso();
    const manifestPath = input.manifest_path
      ? normalizePath(input.manifest_path)
      : null;
    const deployOrderJson = input.deploy_order
      ? JSON.stringify(input.deploy_order)
      : null;

    if (existing) {
      this.db
        .prepare(
          `UPDATE workspaces
           SET name = ?,
               timezone = ?,
               manifest_path = COALESCE(?, manifest_path),
               deploy_order_json = COALESCE(?, deploy_order_json),
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.name,
          input.timezone ?? existing.timezone,
          manifestPath,
          deployOrderJson,
          ts,
          existing.id
        );
      return this.db
        .prepare(`SELECT * FROM workspaces WHERE id = ?`)
        .get(existing.id) as Workspace;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO workspaces (
           id, slug, name, timezone, manifest_path, deploy_order_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.slug,
        input.name,
        input.timezone ?? "Asia/Ho_Chi_Minh",
        manifestPath,
        deployOrderJson,
        ts,
        ts
      );
    return this.db
      .prepare(`SELECT * FROM workspaces WHERE id = ?`)
      .get(id) as Workspace;
  }

  listWorkspaces(): Workspace[] {
    return this.db
      .prepare(`SELECT * FROM workspaces ORDER BY slug ASC`)
      .all() as Workspace[];
  }

  getWorkspaceBySlug(slug: string): Workspace {
    const row = this.db
      .prepare(`SELECT * FROM workspaces WHERE slug = ?`)
      .get(slug) as Workspace | undefined;
    if (!row) {
      throw new Error(`Workspace not found: ${slug}`);
    }
    return row;
  }

  upsertProject(input: {
    workspace_slug: string;
    slug: string;
    name: string;
    role?: string;
    repo_path?: string;
    remote_url?: string;
    default_branch?: string;
  }): Project {
    const workspace = this.getWorkspaceBySlug(input.workspace_slug);
    const existing = this.db
      .prepare(
        `SELECT * FROM projects WHERE workspace_id = ? AND slug = ?`
      )
      .get(workspace.id, input.slug) as Project | undefined;
    const ts = nowIso();
    const repoPath = input.repo_path ? normalizePath(input.repo_path) : null;

    if (existing) {
      this.db
        .prepare(
          `UPDATE projects
           SET name = ?,
               role = COALESCE(?, role),
               repo_path = COALESCE(?, repo_path),
               remote_url = COALESCE(?, remote_url),
               default_branch = COALESCE(?, default_branch),
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.name,
          input.role ?? null,
          repoPath,
          input.remote_url ?? null,
          input.default_branch ?? null,
          ts,
          existing.id
        );
      return this.db
        .prepare(`SELECT * FROM projects WHERE id = ?`)
        .get(existing.id) as Project;
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO projects (
           id, workspace_id, slug, name, role, repo_path, remote_url, default_branch, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspace.id,
        input.slug,
        input.name,
        input.role ?? null,
        repoPath,
        input.remote_url ?? null,
        input.default_branch ?? null,
        ts,
        ts
      );
    return this.db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .get(id) as Project;
  }

  listProjects(workspace_slug: string): Project[] {
    const workspace = this.getWorkspaceBySlug(workspace_slug);
    return this.db
      .prepare(
        `SELECT * FROM projects WHERE workspace_id = ? ORDER BY slug ASC`
      )
      .all(workspace.id) as Project[];
  }

  getProjectBySlug(workspace_slug: string, project_slug: string): Project {
    const workspace = this.getWorkspaceBySlug(workspace_slug);
    const row = this.db
      .prepare(
        `SELECT * FROM projects WHERE workspace_id = ? AND slug = ?`
      )
      .get(workspace.id, project_slug) as Project | undefined;
    if (!row) {
      throw new Error(
        `Project not found: ${workspace_slug}/${project_slug}`
      );
    }
    return row;
  }

  findProjectByRepoPath(
    workspace_slug: string,
    repo_path: string
  ): Project | null {
    const workspace = this.getWorkspaceBySlug(workspace_slug);
    const row = this.db
      .prepare(
        `SELECT * FROM projects WHERE workspace_id = ? AND repo_path = ?`
      )
      .get(workspace.id, repo_path) as Project | undefined;
    return row ?? null;
  }

  findProjectAcrossWorkspaces(repo_path: string): {
    workspace: Workspace;
    project: Project;
  } | null {
    const normalized = normalizePath(repo_path);
    const projects = this.db
      .prepare(`SELECT * FROM projects WHERE repo_path IS NOT NULL`)
      .all() as Project[];

    let bestMatch: Project | null = null;
    let bestLen = -1;
    for (const p of projects) {
      if (!p.repo_path) continue;
      const candidate = normalizePath(p.repo_path);
      const isMatch =
        normalized === candidate || normalized.startsWith(`${candidate}/`);
      if (isMatch && candidate.length > bestLen) {
        bestMatch = p;
        bestLen = candidate.length;
      }
    }

    if (!bestMatch) return null;
    const workspace = this.db
      .prepare(`SELECT * FROM workspaces WHERE id = ?`)
      .get(bestMatch.workspace_id) as Workspace | undefined;
    if (!workspace) return null;
    return { workspace, project: bestMatch };
  }

  upsertTask(input: {
    workspace_slug: string;
    project_slug: string;
    slug: string;
    title: string;
    status?: TaskStatus;
    current_spec_ref?: string;
    target_branch?: string;
    base_branch?: string;
    base_commit?: string;
  }): Task {
    const workspace = this.getWorkspaceBySlug(input.workspace_slug);
    const project = this.getProjectBySlug(
      input.workspace_slug,
      input.project_slug
    );
    const existing = this.db
      .prepare(`SELECT * FROM tasks WHERE workspace_id = ? AND slug = ?`)
      .get(workspace.id, input.slug) as Task | undefined;
    const ts = nowIso();

    if (existing) {
      this.db
        .prepare(
          `UPDATE tasks
           SET title = ?,
               primary_project_id = ?,
               status = COALESCE(?, status),
               current_spec_ref = COALESCE(?, current_spec_ref),
               target_branch = COALESCE(?, target_branch),
               base_branch = COALESCE(?, base_branch),
               base_commit = COALESCE(?, base_commit),
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.title,
          project.id,
          input.status ?? null,
          input.current_spec_ref ?? null,
          input.target_branch ?? null,
          input.base_branch ?? null,
          input.base_commit ?? null,
          ts,
          existing.id
        );
      this.linkTaskProject(existing.id, project.id, "primary");
      return this.getTaskById(existing.id);
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks (
           id, workspace_id, primary_project_id, slug, title, status,
           current_spec_ref, target_branch, base_branch, base_commit, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspace.id,
        project.id,
        input.slug,
        input.title,
        input.status ?? "open",
        input.current_spec_ref ?? null,
        input.target_branch ?? null,
        input.base_branch ?? null,
        input.base_commit ?? null,
        ts,
        ts
      );
    this.linkTaskProject(id, project.id, "primary");
    return this.getTaskById(id);
  }

  getTaskById(id: string): Task {
    const row = this.db
      .prepare(`SELECT * FROM tasks WHERE id = ?`)
      .get(id) as Task | undefined;
    if (!row) {
      throw new Error(`Task not found: ${id}`);
    }
    return row;
  }

  getTask(workspace_slug: string, task_slug: string): Task {
    const workspace = this.getWorkspaceBySlug(workspace_slug);
    const row = this.db
      .prepare(`SELECT * FROM tasks WHERE workspace_id = ? AND slug = ?`)
      .get(workspace.id, task_slug) as Task | undefined;
    if (!row) {
      throw new Error(`Task not found: ${workspace_slug}/${task_slug}`);
    }
    return row;
  }

  listTasks(workspace_slug: string, status?: TaskStatus): Task[] {
    const workspace = this.getWorkspaceBySlug(workspace_slug);
    if (status) {
      return this.db
        .prepare(
          `SELECT * FROM tasks WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC`
        )
        .all(workspace.id, status) as Task[];
    }
    return this.db
      .prepare(
        `SELECT * FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC`
      )
      .all(workspace.id) as Task[];
  }

  linkTaskProject(
    taskIdOrSlugs:
      | string
      | { workspace_slug: string; task_slug: string; project_slug: string },
    projectId?: string,
    role: TaskProjectRole = "related"
  ): { task_id: string; project_id: string; role: TaskProjectRole } {
    let taskId: string;
    let projId: string;
    let linkRole: TaskProjectRole = role;

    if (typeof taskIdOrSlugs === "string") {
      taskId = taskIdOrSlugs;
      if (!projectId) {
        throw new Error("projectId required when linking by id");
      }
      projId = projectId;
    } else {
      const task = this.getTask(
        taskIdOrSlugs.workspace_slug,
        taskIdOrSlugs.task_slug
      );
      const project = this.getProjectBySlug(
        taskIdOrSlugs.workspace_slug,
        taskIdOrSlugs.project_slug
      );
      taskId = task.id;
      projId = project.id;
      linkRole = role;
    }

    this.db
      .prepare(
        `INSERT INTO task_projects (task_id, project_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(task_id, project_id) DO UPDATE SET role = excluded.role`
      )
      .run(taskId, projId, linkRole);

    return { task_id: taskId, project_id: projId, role: linkRole };
  }

  appendEvent(input: {
    workspace_slug: string;
    project_slug: string;
    task_slug: string;
    type: EventType;
    summary: string;
    payload?: unknown;
    ts?: string;
    task_status?: TaskStatus;
  }): EventView {
    const workspace = this.getWorkspaceBySlug(input.workspace_slug);
    const project = this.getProjectBySlug(
      input.workspace_slug,
      input.project_slug
    );
    const task = this.getTask(input.workspace_slug, input.task_slug);
    const createdAt = nowIso();
    const ts = input.ts ?? createdAt;
    const id = randomUUID();
    const payload = JSON.stringify(input.payload ?? {});

    this.db
      .prepare(
        `INSERT INTO events (
           id, workspace_id, project_id, task_id, ts, type, summary, payload, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspace.id,
        project.id,
        task.id,
        ts,
        input.type,
        input.summary,
        payload,
        createdAt
      );

    if (input.type === "spec_confirmed" && input.payload) {
      const payloadObj = input.payload as { spec_ref?: string };
      if (payloadObj.spec_ref) {
        this.db
          .prepare(
            `UPDATE tasks SET current_spec_ref = ?, status = 'in_progress', updated_at = ? WHERE id = ?`
          )
          .run(payloadObj.spec_ref, createdAt, task.id);
      }
    }

    if (input.type === "code_shipped") {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'shipped_local', updated_at = ? WHERE id = ?`
        )
        .run(createdAt, task.id);
    }

    if (input.type === "test_blocked") {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'blocked', updated_at = ? WHERE id = ?`
        )
        .run(createdAt, task.id);
    }

    if (input.task_status) {
      this.db
        .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
        .run(input.task_status, createdAt, task.id);
    }

    return this.getEventById(id);
  }

  getEventById(id: string): EventView {
    const row = this.db
      .prepare(`SELECT * FROM events WHERE id = ?`)
      .get(id) as
      | {
          id: string;
          workspace_id: string;
          project_id: string;
          task_id: string;
          ts: string;
          type: string;
          summary: string;
          payload: string;
          created_at: string;
        }
      | undefined;
    if (!row) {
      throw new Error(`Event not found: ${id}`);
    }
    return parseEvent(row);
  }

  listEvents(input: {
    workspace_slug: string;
    task_slug?: string;
    project_slug?: string;
    type?: EventType;
    limit?: number;
  }): EventView[] {
    const workspace = this.getWorkspaceBySlug(input.workspace_slug);
    const limit = input.limit ?? 50;
    const clauses = ["workspace_id = ?"];
    const params: unknown[] = [workspace.id];

    if (input.task_slug) {
      const task = this.getTask(input.workspace_slug, input.task_slug);
      clauses.push("task_id = ?");
      params.push(task.id);
    }
    if (input.project_slug) {
      const project = this.getProjectBySlug(
        input.workspace_slug,
        input.project_slug
      );
      clauses.push("project_id = ?");
      params.push(project.id);
    }
    if (input.type) {
      clauses.push("type = ?");
      params.push(input.type);
    }

    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY ts DESC LIMIT ?`
      )
      .all(...params) as Array<{
      id: string;
      workspace_id: string;
      project_id: string;
      task_id: string;
      ts: string;
      type: string;
      summary: string;
      payload: string;
      created_at: string;
    }>;

    return rows.map(parseEvent);
  }

  getTimeline(workspace_slug: string, task_slug: string): EventView[] {
    const task = this.getTask(workspace_slug, task_slug);
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC`)
      .all(task.id) as Array<{
      id: string;
      workspace_id: string;
      project_id: string;
      task_id: string;
      ts: string;
      type: string;
      summary: string;
      payload: string;
      created_at: string;
    }>;
    return rows.map(parseEvent);
  }

  recordEnv(input: {
    workspace_slug: string;
    project_slug: string;
    task_slug: string;
    env: EnvName;
    deploy_ref?: string;
    summary?: string;
    ts?: string;
  }): EventView {
    return this.appendEvent({
      workspace_slug: input.workspace_slug,
      project_slug: input.project_slug,
      task_slug: input.task_slug,
      type: "env_promoted",
      summary:
        input.summary ??
        `Promoted ${input.project_slug} to ${input.env}`,
      payload: {
        env: input.env,
        deploy_ref: input.deploy_ref
      },
      ts: input.ts
    });
  }

  confirmSpec(input: {
    workspace_slug: string;
    project_slug: string;
    task_slug: string;
    title: string;
    target_branch?: string;
    base_branch?: string;
    spec: SpecContract;
    related_projects?: string[];
  }): { task: Task; event: EventView } {
    const task = this.upsertTask({
      workspace_slug: input.workspace_slug,
      project_slug: input.project_slug,
      slug: input.task_slug,
      title: input.title,
      status: "in_progress"
    });
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE tasks
         SET target_branch = COALESCE(?, target_branch),
             base_branch = COALESCE(?, base_branch),
             spec_json = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.target_branch ?? null,
        input.base_branch ?? null,
        JSON.stringify(input.spec),
        ts,
        task.id
      );

    for (const relSlug of input.related_projects ?? []) {
      if (relSlug === input.project_slug) continue;
      const relProj = this.getProjectBySlug(input.workspace_slug, relSlug);
      this.linkTaskProject(task.id, relProj.id, "related");
    }

    const event = this.appendEvent({
      workspace_slug: input.workspace_slug,
      project_slug: input.project_slug,
      task_slug: input.task_slug,
      type: "spec_confirmed",
      summary: `Confirmed Executable Spec for ${input.task_slug}: ${input.spec.objective}`,
      payload: {
        target_branch: input.target_branch,
        base_branch: input.base_branch,
        related_projects: input.related_projects ?? [],
        spec: input.spec
      }
    });

    return { task: this.getTaskById(task.id), event };
  }

  recordVerification(input: {
    workspace_slug: string;
    project_slug: string;
    task_slug: string;
    verify_type: VerifyType;
    passed: boolean;
    command?: string;
    summary: string;
    details?: Record<string, unknown>;
  }): { task: Task; event: EventView; circuit_breaker_tripped: boolean } {
    const task = this.getTask(input.workspace_slug, input.task_slug);
    const ts = nowIso();
    const nextAttempts = input.passed ? 0 : task.fix_attempts + 1;
    const circuitBreakerTripped = !input.passed && nextAttempts >= 3;
    const nextStatus: TaskStatus = circuitBreakerTripped
      ? "blocked"
      : input.passed && task.status === "blocked"
        ? "in_progress"
        : task.status;

    this.db
      .prepare(
        `UPDATE tasks SET fix_attempts = ?, status = ?, updated_at = ? WHERE id = ?`
      )
      .run(nextAttempts, nextStatus, ts, task.id);

    const event = this.appendEvent({
      workspace_slug: input.workspace_slug,
      project_slug: input.project_slug,
      task_slug: input.task_slug,
      type: input.passed ? "test_passed" : "test_blocked",
      summary: input.summary,
      payload: {
        verify_type: input.verify_type,
        passed: input.passed,
        command: input.command,
        fix_attempts: nextAttempts,
        circuit_breaker_tripped: circuitBreakerTripped,
        ...(input.details ?? {})
      }
    });

    return {
      task: this.getTaskById(task.id),
      event,
      circuit_breaker_tripped: circuitBreakerTripped
    };
  }

  saveHandoffSnapshot(input: {
    workspace_slug: string;
    project_slug: string;
    task_slug: string;
    handoff: HandoffSnapshot;
    mark_shipped?: boolean;
  }): { task: Task; event: EventView } {
    const task = this.getTask(input.workspace_slug, input.task_slug);
    const ts = nowIso();
    const snapshot: HandoffSnapshot = {
      ...input.handoff,
      updated_at: ts
    };

    this.db
      .prepare(
        `UPDATE tasks
         SET handoff_json = ?,
             status = COALESCE(?, status),
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        JSON.stringify(snapshot),
        input.mark_shipped ? "shipped_local" : null,
        ts,
        task.id
      );

    const event = this.appendEvent({
      workspace_slug: input.workspace_slug,
      project_slug: input.project_slug,
      task_slug: input.task_slug,
      type: "handoff_saved",
      summary: `Saved source-grounded handoff snapshot for ${task.slug}`,
      payload: snapshot
    });

    return { task: this.getTaskById(task.id), event };
  }

  recordCommit(input: {
    workspace_slug: string;
    project_slug: string;
    task_slug: string;
    commit_hash: string;
    branch: string;
    subject: string;
    ai_change?: string;
    ai_pick_notes?: string;
    depends_on?: string;
    tests_run?: string;
    files_changed?: string[];
    committed_at?: string;
    mark_shipped?: boolean;
  }): { commit: CommitRecord; event?: EventView } {
    const workspace = this.getWorkspaceBySlug(input.workspace_slug);
    const project = this.getProjectBySlug(
      input.workspace_slug,
      input.project_slug
    );
    const task = this.getTask(input.workspace_slug, input.task_slug);
    const createdAt = nowIso();
    const committedAt = input.committed_at ?? createdAt;
    const filesJson = JSON.stringify(input.files_changed ?? []);

    const existing = this.db
      .prepare(
        `SELECT id FROM commits WHERE project_id = ? AND commit_hash = ?`
      )
      .get(project.id, input.commit_hash) as { id: string } | undefined;

    let commitId: string;
    if (existing) {
      commitId = existing.id;
      this.db
        .prepare(
          `UPDATE commits
           SET task_id = ?,
               branch = ?,
               subject = ?,
               ai_change = COALESCE(?, ai_change),
               ai_pick_notes = COALESCE(?, ai_pick_notes),
               depends_on = COALESCE(?, depends_on),
               tests_run = COALESCE(?, tests_run),
               files_changed = ?,
               committed_at = ?
           WHERE id = ?`
        )
        .run(
          task.id,
          input.branch,
          input.subject,
          input.ai_change ?? null,
          input.ai_pick_notes ?? null,
          input.depends_on ?? null,
          input.tests_run ?? null,
          filesJson,
          committedAt,
          commitId
        );
    } else {
      commitId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO commits (
             id, workspace_id, project_id, task_id, commit_hash, branch, subject,
             ai_change, ai_pick_notes, depends_on, tests_run, files_changed, committed_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          commitId,
          workspace.id,
          project.id,
          task.id,
          input.commit_hash,
          input.branch,
          input.subject,
          input.ai_change ?? null,
          input.ai_pick_notes ?? null,
          input.depends_on ?? null,
          input.tests_run ?? null,
          filesJson,
          committedAt,
          createdAt
        );
    }

    if (input.mark_shipped) {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'shipped_local', updated_at = ? WHERE id = ?`
        )
        .run(createdAt, task.id);
    }

    const commit = this.db
      .prepare(`SELECT * FROM commits WHERE id = ?`)
      .get(commitId) as CommitRecord;

    const event = existing
      ? undefined
      : this.appendEvent({
          workspace_slug: input.workspace_slug,
          project_slug: input.project_slug,
          task_slug: input.task_slug,
          type: "code_shipped",
          summary: `${input.commit_hash.slice(0, 7)} ${input.subject}`,
          payload: {
            commit_hash: input.commit_hash,
            branch: input.branch,
            ai_change: input.ai_change,
            files_changed: input.files_changed ?? []
          },
          ts: committedAt
        });

    if (!existing) {
      this.logActivity({
        workspace_slug: input.workspace_slug,
        project_slug: input.project_slug,
        task_slug: input.task_slug,
        stage: "build",
        source: "git",
        action: "commit",
        status: "success",
        commit_hash: input.commit_hash,
        files_changed: input.files_changed,
        summary: `${input.commit_hash.slice(0, 7)} — ${input.subject}`,
        details: {
          branch: input.branch,
          ai_change: input.ai_change,
          tests_run: input.tests_run
        },
        ts: committedAt
      });
    }

    return { commit, event };
  }

  recordDeploy(input: {
    workspace_slug: string;
    project_slug: string;
    task_slug?: string;
    source_branch: string;
    target_branch: string;
    env: EnvName;
    commit_hash?: string;
    status?: DeployStatus;
    deployed_by: string;
    deployed_at?: string;
    deploy_ref?: string;
    notes?: string;
  }): { deployment: DeploymentRecord; event?: EventView } {
    const workspace = this.getWorkspaceBySlug(input.workspace_slug);
    const project = this.getProjectBySlug(
      input.workspace_slug,
      input.project_slug
    );
    const task = input.task_slug
      ? this.getTask(input.workspace_slug, input.task_slug)
      : null;

    const id = randomUUID();
    const createdAt = nowIso();
    const deployedAt = input.deployed_at ?? createdAt;
    const status: DeployStatus = input.status ?? "success";

    this.db
      .prepare(
        `INSERT INTO deployments (
           id, workspace_id, project_id, task_id, source_branch, target_branch,
           env, commit_hash, status, deployed_by, deployed_at, deploy_ref, notes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspace.id,
        project.id,
        task?.id ?? null,
        input.source_branch,
        input.target_branch,
        input.env,
        input.commit_hash ?? null,
        status,
        input.deployed_by,
        deployedAt,
        input.deploy_ref ?? null,
        input.notes ?? null,
        createdAt
      );

    const deployment = this.db
      .prepare(`SELECT * FROM deployments WHERE id = ?`)
      .get(id) as DeploymentRecord;

    let event: EventView | undefined;
    if (task) {
      event = this.appendEvent({
        workspace_slug: input.workspace_slug,
        project_slug: input.project_slug,
        task_slug: task.slug,
        type: "deploy_recorded",
        summary: `Deploy ${input.project_slug} (${input.source_branch} -> ${input.target_branch}, ${status}) by ${input.deployed_by}`,
        payload: {
          env: input.env,
          source_branch: input.source_branch,
          target_branch: input.target_branch,
          commit_hash: input.commit_hash,
          status,
          deployed_by: input.deployed_by,
          deployed_at: deployedAt,
          deploy_ref: input.deploy_ref
        },
        ts: deployedAt
      });
    }

    return { deployment, event };
  }

  getBranchHistory(input: {
    workspace_slug: string;
    project_slug: string;
    branch: string;
    task_slug?: string;
  }): BranchHistoryView {
    const workspace = this.getWorkspaceBySlug(input.workspace_slug);
    const project = this.getProjectBySlug(
      input.workspace_slug,
      input.project_slug
    );
    const task = input.task_slug
      ? this.getTask(input.workspace_slug, input.task_slug)
      : ((this.db
          .prepare(
            `SELECT * FROM tasks WHERE workspace_id = ? AND primary_project_id = ? AND target_branch = ? ORDER BY updated_at DESC LIMIT 1`
          )
          .get(workspace.id, project.id, input.branch) as Task | undefined) ??
        null);

    const commits = task
      ? (this.db
          .prepare(
            `SELECT * FROM commits WHERE project_id = ? AND (task_id = ? OR branch = ?) ORDER BY committed_at ASC`
          )
          .all(project.id, task.id, input.branch) as CommitRecord[])
      : (this.db
          .prepare(
            `SELECT * FROM commits WHERE project_id = ? AND branch = ? ORDER BY committed_at ASC`
          )
          .all(project.id, input.branch) as CommitRecord[]);

    const deployments = task
      ? (this.db
          .prepare(
            `SELECT * FROM deployments WHERE project_id = ? AND (task_id = ? OR source_branch = ?) ORDER BY deployed_at DESC`
          )
          .all(project.id, task.id, input.branch) as DeploymentRecord[])
      : (this.db
          .prepare(
            `SELECT * FROM deployments WHERE project_id = ? AND source_branch = ? ORDER BY deployed_at DESC`
          )
          .all(project.id, input.branch) as DeploymentRecord[]);

    const latestFor = (target: string): DeploymentRecord | null =>
      deployments.find((d) => d.target_branch === target) ?? null;

    return {
      workspace,
      project,
      task,
      branch: input.branch,
      commits,
      deployments,
      deploy_matrix: {
        local: latestFor("local"),
        develop: latestFor("develop"),
        staging: latestFor("staging"),
        main: latestFor("main") ?? latestFor("master")
      }
    };
  }

  syncGitState(input: SyncGitStateInput): SyncGitStateResult {
    return runSyncGitState(this.db, this, input);
  }

  syncWorkspace(input: SyncWorkspaceInput): SyncWorkspaceResult {
    return runSyncWorkspace(this.db, this, input);
  }
}

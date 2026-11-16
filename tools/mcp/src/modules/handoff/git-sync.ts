import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { SqliteDatabase } from "./db.js";
import type { HandoffStore } from "./store.js";
import type { EnvName, HandoffSnapshot, Task, TaskStatus } from "./types.js";
import { discoverWorkspaceManifest } from "./workspace-manifest.js";

export interface SyncGitStateInput {
  repo_path: string;
  workspace_slug?: string;
  project_slug?: string;
  manifest_path?: string;
  include_branches?: string[];
  dry_run?: boolean;
}

export interface SyncedBranchReport {
  branch: string;
  task_slug: string;
  head_commit: string;
  base_branch: string | null;
  base_commit: string | null;
  commits_found: number;
  commits_synced: number;
  synced_branches: string[];
  synced_status: string;
  deployments_added: string[];
  handoff_state: "missing" | "stale" | "fresh";
  task_status: TaskStatus;
}

export interface MainBranchHead {
  branch: string;
  ref: string;
  head_commit: string;
  subject: string;
  committed_at: string;
}

export interface SyncGitStateResult {
  dry_run: boolean;
  repo_path: string;
  workspace_slug: string;
  project_slug: string;
  project_registered: boolean;
  main_branches: MainBranchHead[];
  branches: SyncedBranchReport[];
  summary: {
    total_working_branches: number;
    commits_synced: number;
    deployments_added: number;
    missing_handoff: number;
    stale_handoff: number;
  };
}

export interface SyncWorkspaceInput {
  manifest_path?: string;
  repo_path?: string;
  include_branches?: string[];
  dry_run?: boolean;
}

export interface SyncWorkspaceResult {
  dry_run: boolean;
  manifest_path: string;
  workspace_slug: string;
  workspace_name: string;
  deploy_order: string[];
  projects_synced: Array<{
    slug: string;
    role?: string;
    repo_path: string;
    skipped_missing_dir?: boolean;
    result?: SyncGitStateResult;
  }>;
  summary: {
    total_projects: number;
    synced_projects: number;
    total_working_branches: number;
    commits_synced: number;
    deployments_added: number;
    missing_handoff: number;
    stale_handoff: number;
  };
}

const TARGET_BRANCHES = ["develop", "staging", "main", "master"] as const;

function git(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function gitSuccess(repoPath: string, args: string[]): boolean {
  try {
    execFileSync("git", ["-C", repoPath, ...args], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveTaskSlugFromBranch(branch: string): string {
  const stripped = branch.replace(
    /^(feature|feat|fix|bugfix|hotfix|refactor|chore|docs|test)\//i,
    ""
  );
  return sanitizeSlug(stripped) || sanitizeSlug(branch) || "task";
}

function mapTargetBranchToEnv(targetBranch: string): EnvName {
  if (targetBranch === "develop") return "dev";
  if (targetBranch === "staging") return "staging";
  if (targetBranch === "main" || targetBranch === "master") return "production";
  return "local";
}

function resolveTargetRef(repoPath: string, branch: string): string | null {
  if (gitSuccess(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) {
    return branch;
  }
  if (
    gitSuccess(repoPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${branch}`
    ])
  ) {
    return `origin/${branch}`;
  }
  return null;
}

function isBranchSyncedToTarget(
  repoPath: string,
  branch: string,
  branchHead: string,
  targetRef: string
): boolean {
  if (gitSuccess(repoPath, ["merge-base", "--is-ancestor", branchHead, targetRef])) {
    return true;
  }

  const cherryOut = git(repoPath, ["cherry", targetRef, branch]);
  if (!cherryOut) return false;
  const lines = cherryOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  const hasApplied = lines.some((l) => l.startsWith("- "));
  const hasUnapplied = lines.some((l) => l.startsWith("+ "));
  return hasApplied && !hasUnapplied;
}

export function computeSyncedStatus(branches: string[]): string {
  if (branches.length === 0) return "unmerged";
  return branches.join(" + ");
}

export function syncGitState(
  db: SqliteDatabase,
  store: HandoffStore,
  input: SyncGitStateInput
): SyncGitStateResult {
  const dryRun = Boolean(input.dry_run);
  const top = git(input.repo_path, ["rev-parse", "--show-toplevel"]);
  const repoPath = realpathSync(top ?? input.repo_path);

  const manifest = discoverWorkspaceManifest(
    [repoPath],
    store,
    input.manifest_path
  );
  const manifestProject = manifest?.projects.find(
    (p) => existsSync(p.repo_path) && realpathSync(p.repo_path) === repoPath
  );
  const existingCtx = store.findProjectAcrossWorkspaces(repoPath);
  let workspaceSlug =
    input.workspace_slug ||
    manifest?.workspace_slug ||
    existingCtx?.workspace.slug ||
    "";
  let projectSlug =
    input.project_slug ||
    manifestProject?.slug ||
    existingCtx?.project.slug ||
    "";
  let projectRegistered = Boolean(existingCtx);

  if (!workspaceSlug) {
    workspaceSlug = sanitizeSlug(basename(dirname(repoPath))) || "default";
  }
  if (!projectSlug) {
    projectSlug = sanitizeSlug(basename(repoPath)) || "project";
  }

  const remoteUrl = git(repoPath, ["config", "--get", "remote.origin.url"]) ?? undefined;

  const mainBranches: MainBranchHead[] = [];
  const mainRefMap = new Map<string, string>();
  for (const name of TARGET_BRANCHES) {
    const ref = resolveTargetRef(repoPath, name);
    if (!ref) continue;
    mainRefMap.set(name, ref);
    const meta = git(repoPath, ["log", "-1", "--format=%H\x1f%s\x1f%aI", ref]);
    if (meta) {
      const [head_commit = "", subject = "", committed_at = ""] = meta.split("\x1f");
      mainBranches.push({ branch: name, ref, head_commit, subject, committed_at });
    }
  }

  const defaultBranch =
    manifestProject?.default_branch ??
    (mainRefMap.has("main")
      ? "main"
      : mainRefMap.has("master")
        ? "master"
        : mainRefMap.has("develop")
          ? "develop"
          : git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "main");

  if (!dryRun) {
    store.upsertWorkspace({
      slug: workspaceSlug,
      name: manifest?.workspace_name ?? workspaceSlug,
      manifest_path: manifest?.manifest_path,
      deploy_order: manifest?.deploy_order.length ? manifest.deploy_order : undefined
    });
    store.upsertProject({
      workspace_slug: workspaceSlug,
      slug: projectSlug,
      name: manifestProject?.name ?? projectSlug,
      role: manifestProject?.role,
      repo_path: repoPath,
      remote_url: remoteUrl,
      default_branch: defaultBranch
    });
    projectRegistered = true;
  }

  const rawBranches = git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  const allLocalBranches = rawBranches
    ? rawBranches.split("\n").map((b) => b.trim()).filter(Boolean)
    : [];

  const targetSet = new Set<string>(TARGET_BRANCHES);
  let workingBranches = allLocalBranches.filter((b) => !targetSet.has(b));
  if (input.include_branches && input.include_branches.length > 0) {
    const allow = new Set(input.include_branches);
    workingBranches = workingBranches.filter((b) => allow.has(b));
  }

  const baseCandidates = [
    mainRefMap.get("develop"),
    mainRefMap.get("main"),
    mainRefMap.get("master"),
    mainRefMap.get("staging")
  ].filter((x): x is string => Boolean(x));

  const projectRow =
    existingCtx?.project ??
    (!dryRun ? store.getProjectBySlug(workspaceSlug, projectSlug) : null);
  const workspaceRow =
    existingCtx?.workspace ??
    (!dryRun ? store.getWorkspaceBySlug(workspaceSlug) : null);

  const branchReports: SyncedBranchReport[] = [];
  let totalCommitsSynced = 0;
  let totalDeploymentsAdded = 0;
  let missingHandoff = 0;
  let staleHandoff = 0;

  for (const branch of workingBranches) {
    const headCommit = git(repoPath, ["rev-parse", branch]) ?? "";
    if (!headCommit) continue;

    let baseBranch: string | null = null;
    let baseCommit: string | null = null;
    for (const candidate of baseCandidates) {
      if (candidate === branch) continue;
      const mb = git(repoPath, ["merge-base", candidate, branch]);
      if (mb) {
        baseBranch = candidate.replace(/^origin\//, "");
        baseCommit = mb;
        break;
      }
    }

    const range = baseCommit ? `${baseCommit}..${branch}` : branch;
    const maxFlag = baseCommit ? [] : ["-n", "30"];
    const logOut = git(repoPath, [
      "log",
      "--reverse",
      ...maxFlag,
      "--format=%H\x1f%s\x1f%aI\x1f%an\x1f%(trailers:key=Feature,valueonly)\x1f%(trailers:key=AI-Change,valueonly)",
      range
    ]);

    const parsedCommits = logOut
      ? logOut
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [
              hash = "",
              subject = "",
              committed_at = "",
              author = "",
              featureTrailer = "",
              aiChange = ""
            ] = line.split("\x1f");
            return {
              hash,
              subject,
              committed_at,
              author,
              featureTrailer: featureTrailer.trim(),
              aiChange: aiChange.trim()
            };
          })
      : [];

    let existingTask: Task | null = null;
    if (workspaceRow && projectRow) {
      const byBranch = db
        .prepare(
          `SELECT slug FROM tasks WHERE workspace_id = ? AND primary_project_id = ? AND target_branch = ? LIMIT 1`
        )
        .get(workspaceRow.id, projectRow.id, branch) as { slug: string } | undefined;
      if (byBranch) {
        existingTask = store.getTask(workspaceSlug, byBranch.slug);
      }
    }

    const trailerSlug = parsedCommits.find((c) => c.featureTrailer)?.featureTrailer;
    const taskSlug =
      existingTask?.slug ??
      (trailerSlug ? sanitizeSlug(trailerSlug) : deriveTaskSlugFromBranch(branch));

    if (!existingTask && workspaceRow) {
      try {
        existingTask = store.getTask(workspaceSlug, taskSlug);
      } catch {
        existingTask = null;
      }
    }

    const syncedBranches: string[] = [];
    for (const targetName of ["develop", "staging", "main", "master"] as const) {
      const targetRef = mainRefMap.get(targetName);
      if (!targetRef) continue;
      if (isBranchSyncedToTarget(repoPath, branch, headCommit, targetRef)) {
        syncedBranches.push(targetName);
      }
    }

    const syncedStatus = computeSyncedStatus(syncedBranches);
    const latestCommit = parsedCommits[parsedCommits.length - 1];
    const headMeta = git(repoPath, ["log", "-1", "--format=%an\x1f%aI", headCommit]) ?? "";
    const [headAuthor = "git-sync", headDate = new Date().toISOString()] =
      headMeta.split("\x1f");

    let taskStatus: TaskStatus = existingTask?.status ?? "open";
    if (syncedBranches.includes("main") || syncedBranches.includes("master")) {
      taskStatus = "closed";
    } else if (!existingTask && parsedCommits.length > 0) {
      taskStatus = "in_progress";
    }

    const deploymentsAdded: string[] = [];
    let commitsSyncedForBranch = 0;

    if (!dryRun) {
      const currentProj = store.getProjectBySlug(workspaceSlug, projectSlug);
      let task: Task;
      if (existingTask && existingTask.primary_project_id !== currentProj.id) {
        store.linkTaskProject(existingTask.id, currentProj.id, "related");
        task = existingTask;
      } else {
        task = store.upsertTask({
          workspace_slug: workspaceSlug,
          project_slug: projectSlug,
          slug: taskSlug,
          title: existingTask?.title ?? taskSlug,
          status: taskStatus,
          target_branch: branch,
          base_branch: baseBranch ?? undefined,
          base_commit: baseCommit ?? undefined
        });
      }

      for (const c of parsedCommits) {
        const filesRaw = git(repoPath, [
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "-r",
          c.hash
        ]);
        const filesChanged = filesRaw
          ? filesRaw.split("\n").map((f) => f.trim()).filter(Boolean)
          : [];
        store.recordCommit({
          workspace_slug: workspaceSlug,
          project_slug: projectSlug,
          task_slug: task.slug,
          commit_hash: c.hash,
          branch,
          subject: c.subject,
          ai_change: c.aiChange || undefined,
          files_changed: filesChanged,
          committed_at: c.committed_at || undefined
        });
        commitsSyncedForBranch++;
      }

      for (const targetName of syncedBranches) {
        const existingDeploy = db
          .prepare(
            `SELECT id FROM deployments
             WHERE project_id = ? AND task_id = ? AND target_branch = ? AND status = 'success'
             LIMIT 1`
          )
          .get(currentProj.id, task.id, targetName) as { id: string } | undefined;

        if (!existingDeploy) {
          store.recordDeploy({
            workspace_slug: workspaceSlug,
            project_slug: projectSlug,
            task_slug: task.slug,
            source_branch: branch,
            target_branch: targetName,
            env: mapTargetBranchToEnv(targetName),
            commit_hash: headCommit,
            status: "success",
            deployed_by: latestCommit?.author || headAuthor,
            deployed_at: latestCommit?.committed_at || headDate,
            notes: `Synced from git branch ${targetName}`
          });
          deploymentsAdded.push(targetName);
        }
      }

      existingTask = store.getTask(workspaceSlug, task.slug);
    } else {
      commitsSyncedForBranch = parsedCommits.length;
    }

    let handoffState: "missing" | "stale" | "fresh" = "missing";
    if (existingTask?.handoff_json) {
      try {
        const parsedHandoff = JSON.parse(existingTask.handoff_json) as HandoffSnapshot;
        const handoffUpdatedAt = parsedHandoff.updated_at;
        const latestCommittedAt = latestCommit?.committed_at || headDate;
        handoffState =
          latestCommittedAt && handoffUpdatedAt && latestCommittedAt > handoffUpdatedAt
            ? "stale"
            : "fresh";
      } catch {
        handoffState = "missing";
      }
    }

    if (handoffState === "missing") missingHandoff++;
    if (handoffState === "stale") staleHandoff++;

    totalCommitsSynced += commitsSyncedForBranch;
    totalDeploymentsAdded += deploymentsAdded.length;

    branchReports.push({
      branch,
      task_slug: taskSlug,
      head_commit: headCommit,
      base_branch: baseBranch,
      base_commit: baseCommit,
      commits_found: parsedCommits.length,
      commits_synced: commitsSyncedForBranch,
      synced_branches: syncedBranches,
      synced_status: syncedStatus,
      deployments_added: deploymentsAdded,
      handoff_state: handoffState,
      task_status: existingTask?.status ?? taskStatus
    });
  }

  return {
    dry_run: dryRun,
    repo_path: repoPath,
    workspace_slug: workspaceSlug,
    project_slug: projectSlug,
    project_registered: projectRegistered,
    main_branches: mainBranches,
    branches: branchReports,
    summary: {
      total_working_branches: branchReports.length,
      commits_synced: totalCommitsSynced,
      deployments_added: totalDeploymentsAdded,
      missing_handoff: missingHandoff,
      stale_handoff: staleHandoff
    }
  };
}

export function syncWorkspaceFromManifest(
  db: SqliteDatabase,
  store: HandoffStore,
  input: SyncWorkspaceInput
): SyncWorkspaceResult {
  const dryRun = Boolean(input.dry_run);
  const searchPaths = input.repo_path ? [input.repo_path] : [process.cwd()];
  const manifest = discoverWorkspaceManifest(
    searchPaths,
    store,
    input.manifest_path
  );
  if (!manifest) {
    throw new Error(
      "No workspace manifest (.ai/workspace.md or WORKSPACE.md) found. Create one or pass manifest_path explicitly."
    );
  }

  if (!dryRun) {
    store.upsertWorkspace({
      slug: manifest.workspace_slug,
      name: manifest.workspace_name,
      manifest_path: manifest.manifest_path,
      deploy_order: manifest.deploy_order.length ? manifest.deploy_order : undefined
    });
  }

  const projectsSynced: SyncWorkspaceResult["projects_synced"] = [];
  let syncedProjects = 0;
  let totalWorkingBranches = 0;
  let totalCommits = 0;
  let totalDeployments = 0;
  let missingHandoff = 0;
  let staleHandoff = 0;

  for (const proj of manifest.projects) {
    if (!existsSync(proj.repo_path)) {
      projectsSynced.push({
        slug: proj.slug,
        role: proj.role,
        repo_path: proj.repo_path,
        skipped_missing_dir: true
      });
      continue;
    }

    const res = syncGitState(db, store, {
      repo_path: proj.repo_path,
      workspace_slug: manifest.workspace_slug,
      project_slug: proj.slug,
      manifest_path: manifest.manifest_path,
      include_branches: input.include_branches,
      dry_run: dryRun
    });

    syncedProjects++;
    totalWorkingBranches += res.summary.total_working_branches;
    totalCommits += res.summary.commits_synced;
    totalDeployments += res.summary.deployments_added;
    missingHandoff += res.summary.missing_handoff;
    staleHandoff += res.summary.stale_handoff;

    projectsSynced.push({
      slug: proj.slug,
      role: proj.role,
      repo_path: proj.repo_path,
      result: res
    });
  }

  return {
    dry_run: dryRun,
    manifest_path: manifest.manifest_path,
    workspace_slug: manifest.workspace_slug,
    workspace_name: manifest.workspace_name,
    deploy_order: manifest.deploy_order,
    projects_synced: projectsSynced,
    summary: {
      total_projects: manifest.projects.length,
      synced_projects: syncedProjects,
      total_working_branches: totalWorkingBranches,
      commits_synced: totalCommits,
      deployments_added: totalDeployments,
      missing_handoff: missingHandoff,
      stale_handoff: staleHandoff
    }
  };
}

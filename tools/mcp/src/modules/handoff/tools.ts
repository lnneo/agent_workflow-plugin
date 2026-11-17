import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { HandoffStore } from "./store.js";
import {
  ACTIVITY_STATUSES,
  DEPLOY_STATUSES,
  ENV_NAMES,
  EVENT_TYPES,
  TASK_PROJECT_ROLES,
  TASK_STATUSES,
  VERIFY_TYPES
} from "./types.js";

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const
  };
}

export function registerTools(server: McpServer, store: HandoffStore): void {
  server.registerTool(
    "handoff_upsert_workspace",
    {
      title: "Upsert Workspace",
      description: "Create or update a workspace by slug.",
      inputSchema: {
        slug: z.string().min(1),
        name: z.string().min(1),
        timezone: z.string().min(1).optional(),
        manifest_path: z.string().min(1).optional(),
        deploy_order: z.array(z.string().min(1)).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.upsertWorkspace(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_list_workspaces",
    {
      title: "List Workspaces",
      description: "List all workspaces.",
      inputSchema: {}
    },
    async () => {
      try {
        return jsonResult(store.listWorkspaces());
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_upsert_project",
    {
      title: "Upsert Project",
      description: "Create or update a project under a workspace.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        slug: z.string().min(1),
        name: z.string().min(1),
        role: z.string().min(1).optional(),
        repo_path: z.string().min(1).optional(),
        remote_url: z.string().min(1).optional(),
        default_branch: z.string().min(1).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.upsertProject(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_list_projects",
    {
      title: "List Projects",
      description: "List projects in a workspace.",
      inputSchema: {
        workspace_slug: z.string().min(1)
      }
    },
    async (input) => {
      try {
        return jsonResult(store.listProjects(input.workspace_slug));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_upsert_task",
    {
      title: "Upsert Task",
      description:
        "Create or update a task. Requires workspace_slug, project_slug (primary), and task slug.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        slug: z.string().min(1),
        title: z.string().min(1),
        status: z.enum(TASK_STATUSES).optional(),
        current_spec_ref: z.string().min(1).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.upsertTask(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_get_task",
    {
      title: "Get Task",
      description: "Get a task by workspace and task slug.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        task_slug: z.string().min(1)
      }
    },
    async (input) => {
      try {
        return jsonResult(
          store.getTask(input.workspace_slug, input.task_slug)
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_list_tasks",
    {
      title: "List Tasks",
      description: "List tasks in a workspace, optionally filtered by status.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        status: z.enum(TASK_STATUSES).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(
          store.listTasks(input.workspace_slug, input.status)
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_link_task_project",
    {
      title: "Link Task Project",
      description:
        "Link an additional project to a task (multi-repo). Use role primary or related.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        task_slug: z.string().min(1),
        project_slug: z.string().min(1),
        role: z.enum(TASK_PROJECT_ROLES).default("related")
      }
    },
    async (input) => {
      try {
        return jsonResult(
          store.linkTaskProject(
            {
              workspace_slug: input.workspace_slug,
              task_slug: input.task_slug,
              project_slug: input.project_slug
            },
            undefined,
            input.role
          )
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_append_event",
    {
      title: "Append Event",
      description:
        "Append an append-only timeline event. Types: spec_confirmed, code_shipped, test_passed, test_blocked, env_promoted, note.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        task_slug: z.string().min(1),
        type: z.enum(EVENT_TYPES),
        summary: z.string().min(1),
        payload: z.record(z.string(), z.unknown()).optional(),
        ts: z.string().min(1).optional(),
        task_status: z.enum(TASK_STATUSES).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.appendEvent(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_list_events",
    {
      title: "List Events",
      description: "List events newest-first with optional filters.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        task_slug: z.string().min(1).optional(),
        project_slug: z.string().min(1).optional(),
        type: z.enum(EVENT_TYPES).optional(),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.listEvents(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_get_timeline",
    {
      title: "Get Timeline",
      description: "Get chronological events for a task (oldest → newest).",
      inputSchema: {
        workspace_slug: z.string().min(1),
        task_slug: z.string().min(1)
      }
    },
    async (input) => {
      try {
        return jsonResult(
          store.getTimeline(input.workspace_slug, input.task_slug)
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_record_env",
    {
      title: "Record Env Promote",
      description: "Sugar for env_promoted events (dev|staging|production).",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        task_slug: z.string().min(1),
        env: z.enum(ENV_NAMES),
        deploy_ref: z.string().min(1).optional(),
        summary: z.string().min(1).optional(),
        ts: z.string().min(1).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.recordEnv(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_resolve_project",
    {
      title: "Resolve Project",
      description:
        "Optional helper: resolve a project within a workspace by repo_path.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        repo_path: z.string().min(1)
      }
    },
    async (input) => {
      try {
        const project = store.findProjectByRepoPath(
          input.workspace_slug,
          input.repo_path
        );
        return jsonResult(project);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_confirm_spec",
    {
      title: "Confirm Executable Spec",
      description:
        "Stage 1 (/spec) gate: persist and lock the developer-approved Executable Spec for a task (including multi-project links) in SQLite.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        task_slug: z.string().min(1),
        title: z.string().min(1),
        target_branch: z.string().min(1).optional(),
        base_branch: z.string().min(1).optional(),
        related_projects: z.array(z.string().min(1)).optional(),
        spec: z.object({
          objective: z.string().min(1),
          affected_projects: z.array(z.string().min(1)).optional(),
          out_of_scope: z.array(z.string().min(1)).optional(),
          acceptance_criteria: z.array(z.string().min(1)).optional(),
          verify_commands: z.array(z.string().min(1)).optional(),
          e2e_checks: z.array(z.string().min(1)).optional(),
          deploy_order: z.array(z.string().min(1)).optional()
        })
      }
    },
    async (input) => {
      try {
        return jsonResult(store.confirmSpec(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_record_verification",
    {
      title: "Record Verification",
      description:
        "Stage 2 (/build): record unit/integration/Playwright/DevTools check result. Pass resets fix_attempts; 3 consecutive failures trip the circuit breaker (status=blocked).",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        task_slug: z.string().min(1),
        verify_type: z.enum(VERIFY_TYPES),
        passed: z.boolean(),
        command: z.string().min(1).optional(),
        summary: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.recordVerification(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_save_handoff_snapshot",
    {
      title: "Save Handoff Snapshot",
      description:
        "Stage 2 (/build): persist source-grounded final business logic, technical flow, key references, and workspace manifest info into SQLite.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        task_slug: z.string().min(1),
        mark_shipped: z.boolean().optional(),
        handoff: z.object({
          final_business_logic: z.string().min(1),
          technical_flow: z.array(z.string().min(1)).optional(),
          important_references: z
            .array(
              z.object({
                symbol: z.string().min(1),
                file: z.string().min(1),
                notes: z.string().optional()
              })
            )
            .optional(),
          workspace_manifest_path: z.string().min(1).optional(),
          affected_projects: z.array(z.string().min(1)).optional(),
          known_limitations: z.array(z.string().min(1)).optional(),
          follow_up_tasks: z.array(z.string().min(1)).optional(),
          next_ai_instructions: z.array(z.string().min(1)).optional()
        })
      }
    },
    async (input) => {
      try {
        return jsonResult(store.saveHandoffSnapshot(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_record_commit",
    {
      title: "Record Commit",
      description:
        "Record a Git commit for a task (idempotent on project + commit_hash).",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        task_slug: z.string().min(1),
        commit_hash: z.string().min(1),
        branch: z.string().min(1),
        subject: z.string().min(1),
        ai_change: z.string().optional(),
        ai_pick_notes: z.string().optional(),
        depends_on: z.string().optional(),
        tests_run: z.string().optional(),
        files_changed: z.array(z.string()).optional(),
        committed_at: z.string().optional(),
        mark_shipped: z.boolean().optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.recordCommit(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_record_deploy",
    {
      title: "Record Deploy / Branch Promotion",
      description:
        "Record a deployment or branch promotion (local, develop, staging, main) for a project and task.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        task_slug: z.string().min(1).optional(),
        source_branch: z.string().min(1),
        target_branch: z.string().min(1),
        env: z.enum(ENV_NAMES),
        commit_hash: z.string().min(1).optional(),
        status: z.enum(DEPLOY_STATUSES).optional(),
        deployed_by: z.string().min(1),
        deployed_at: z.string().min(1).optional(),
        deploy_ref: z.string().min(1).optional(),
        notes: z.string().optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.recordDeploy(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_get_branch_history",
    {
      title: "Get Branch History",
      description:
        "Get commits, deployments, and branch deploy matrix (local, develop, staging, main) for a project branch.",
      inputSchema: {
        workspace_slug: z.string().min(1),
        project_slug: z.string().min(1),
        branch: z.string().min(1),
        task_slug: z.string().min(1).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.getBranchHistory(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_sync_git_state",
    {
      title: "Sync Git State",
      description:
        "Scan all Git branches (develop/staging/main plus unmerged feature/fix/other branches), backfill commits, detect merge/cherry-pick branch sync status, and flag missing/stale handoffs.",
      inputSchema: {
        repo_path: z.string().min(1),
        workspace_slug: z.string().min(1).optional(),
        project_slug: z.string().min(1).optional(),
        manifest_path: z.string().min(1).optional(),
        include_branches: z.array(z.string().min(1)).optional(),
        dry_run: z.boolean().optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.syncGitState(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_sync_workspace",
    {
      title: "Sync Workspace From Manifest",
      description:
        "Read .ai/workspace.md (or WORKSPACE.md), register workspace and all listed projects (FE, BE, Infra), scan all Git branches across every project, and auto-link shared task slugs.",
      inputSchema: {
        manifest_path: z.string().min(1).optional(),
        repo_path: z.string().min(1).optional(),
        include_branches: z.array(z.string().min(1)).optional(),
        dry_run: z.boolean().optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.syncWorkspace(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_log_activity",
    {
      title: "Log Activity",
      description:
        "Record a detailed background activity log entry (with optional commit_hash and files_changed) into the /viewer Live Monitor.",
      inputSchema: {
        workspace_slug: z.string().min(1).optional(),
        project_slug: z.string().min(1).optional(),
        task_slug: z.string().min(1).optional(),
        stage: z.string().min(1).optional(),
        source: z.string().min(1).default("agent"),
        action: z.string().min(1),
        status: z.enum(ACTIVITY_STATUSES).optional(),
        duration_ms: z.number().int().nonnegative().optional(),
        commit_hash: z.string().min(1).optional(),
        files_changed: z.array(z.string()).optional(),
        summary: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.logActivity(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "handoff_bulk_sync",
    {
      title: "Bulk Sync Workspace Git State",
      description:
        "Host-driven sync: accept workspace manifest metadata, projects (with roles), tasks (auto-linked across projects), commits, and idempotent deployments scanned by the AI in the current workspace, saving everything in one SQLite transaction without mounting host repos in Docker.",
      inputSchema: {
        workspace: z.object({
          slug: z.string().min(1),
          name: z.string().min(1),
          timezone: z.string().min(1).optional(),
          manifest_path: z.string().min(1).optional(),
          deploy_order: z.array(z.string().min(1)).optional()
        }),
        projects: z.array(
          z.object({
            slug: z.string().min(1),
            name: z.string().min(1),
            role: z.string().min(1).optional(),
            repo_path: z.string().min(1).optional(),
            remote_url: z.string().min(1).optional(),
            default_branch: z.string().min(1).optional()
          })
        ),
        tasks: z
          .array(
            z.object({
              slug: z.string().min(1),
              title: z.string().min(1),
              project_slug: z.string().min(1),
              related_projects: z.array(z.string().min(1)).optional(),
              status: z.enum(TASK_STATUSES).optional(),
              target_branch: z.string().min(1).optional(),
              base_branch: z.string().min(1).optional(),
              base_commit: z.string().min(1).optional(),
              commits: z
                .array(
                  z.object({
                    project_slug: z.string().min(1).optional(),
                    commit_hash: z.string().min(1),
                    branch: z.string().min(1),
                    subject: z.string().min(1),
                    ai_change: z.string().optional(),
                    files_changed: z.array(z.string()).optional(),
                    committed_at: z.string().optional()
                  })
                )
                .optional(),
              deployments: z
                .array(
                  z.object({
                    project_slug: z.string().min(1).optional(),
                    source_branch: z.string().min(1),
                    target_branch: z.string().min(1),
                    env: z.enum(ENV_NAMES),
                    commit_hash: z.string().min(1).optional(),
                    status: z.enum(DEPLOY_STATUSES).optional(),
                    deployed_by: z.string().min(1),
                    deployed_at: z.string().optional(),
                    deploy_ref: z.string().min(1).optional(),
                    notes: z.string().optional()
                  })
                )
                .optional()
            })
          )
          .optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(store.bulkSync(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}

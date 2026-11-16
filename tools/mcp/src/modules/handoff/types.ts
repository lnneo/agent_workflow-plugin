export const TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "shipped_local",
  "closed"
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const EVENT_TYPES = [
  "spec_confirmed",
  "code_shipped",
  "test_passed",
  "test_blocked",
  "env_promoted",
  "deploy_recorded",
  "handoff_saved",
  "note"
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const DEPLOY_STATUSES = [
  "pending",
  "success",
  "failed",
  "rolled_back"
] as const;

export type DeployStatus = (typeof DEPLOY_STATUSES)[number];

export const VERIFY_TYPES = [
  "unit",
  "integration",
  "playwright",
  "devtools",
  "typecheck",
  "lint",
  "build",
  "deploy"
] as const;

export type VerifyType = (typeof VERIFY_TYPES)[number];

export const TASK_PROJECT_ROLES = ["primary", "related"] as const;

export type TaskProjectRole = (typeof TASK_PROJECT_ROLES)[number];

export const ENV_NAMES = ["local", "dev", "staging", "production"] as const;

export type EnvName = (typeof ENV_NAMES)[number];

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  manifest_path: string | null;
  deploy_order_json: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  role: string | null;
  repo_path: string | null;
  remote_url: string | null;
  default_branch: string | null;
  created_at: string;
  updated_at: string;
};

export type SpecContract = {
  objective: string;
  affected_projects?: string[];
  out_of_scope?: string[];
  acceptance_criteria?: string[];
  verify_commands?: string[];
  e2e_checks?: string[];
  deploy_order?: string[];
};

export type HandoffReference = {
  symbol: string;
  file: string;
  notes?: string;
};

export type HandoffSnapshot = {
  final_business_logic: string;
  technical_flow?: string[];
  important_references?: HandoffReference[];
  workspace_manifest_path?: string;
  affected_projects?: string[];
  known_limitations?: string[];
  follow_up_tasks?: string[];
  next_ai_instructions?: string[];
  updated_at?: string;
};

export type Task = {
  id: string;
  workspace_id: string;
  primary_project_id: string;
  slug: string;
  title: string;
  status: TaskStatus;
  current_spec_ref: string | null;
  target_branch: string | null;
  base_branch: string | null;
  base_commit: string | null;
  spec_json: string | null;
  handoff_json: string | null;
  fix_attempts: number;
  created_at: string;
  updated_at: string;
};

export type CommitRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string | null;
  commit_hash: string;
  branch: string;
  subject: string;
  ai_change: string | null;
  ai_pick_notes: string | null;
  depends_on: string | null;
  tests_run: string | null;
  files_changed: string;
  committed_at: string;
  created_at: string;
};

export type DeploymentRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string | null;
  source_branch: string;
  target_branch: string;
  env: EnvName;
  commit_hash: string | null;
  status: DeployStatus;
  deployed_by: string;
  deployed_at: string;
  deploy_ref: string | null;
  notes: string | null;
  created_at: string;
};

export const ACTIVITY_STATUSES = ["info", "running", "success", "error"] as const;

export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export type ActivityLogRecord = {
  id: string;
  ts: string;
  workspace_slug: string | null;
  project_slug: string | null;
  task_slug: string | null;
  stage: string | null;
  source: string;
  action: string;
  status: ActivityStatus;
  duration_ms: number | null;
  commit_hash: string | null;
  files_changed: string;
  summary: string;
  details_json: string | null;
};

export type ActivityLogInput = {
  workspace_slug?: string;
  project_slug?: string;
  task_slug?: string;
  stage?: string;
  source: string;
  action: string;
  status?: ActivityStatus;
  duration_ms?: number;
  commit_hash?: string;
  files_changed?: string[];
  summary: string;
  details?: Record<string, unknown>;
  ts?: string;
};

export type BranchHistoryView = {
  workspace: Workspace;
  project: Project;
  task: Task | null;
  branch: string;
  commits: CommitRecord[];
  deployments: DeploymentRecord[];
  deploy_matrix: {
    local: DeploymentRecord | null;
    develop: DeploymentRecord | null;
    staging: DeploymentRecord | null;
    main: DeploymentRecord | null;
  };
};

export type TaskProject = {
  task_id: string;
  project_id: string;
  role: TaskProjectRole;
};

export type EventRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  task_id: string;
  ts: string;
  type: EventType;
  summary: string;
  payload: string;
  created_at: string;
};

export type EventView = Omit<EventRow, "payload"> & {
  payload: unknown;
};

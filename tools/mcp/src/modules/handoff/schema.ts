export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  manifest_path TEXT,
  deploy_order_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  repo_path TEXT,
  remote_url TEXT,
  default_branch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  primary_project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  current_spec_ref TEXT,
  target_branch TEXT,
  base_branch TEXT,
  base_commit TEXT,
  spec_json TEXT,
  handoff_json TEXT,
  fix_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (primary_project_id) REFERENCES projects(id),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS task_projects (
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (task_id, project_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_task_ts ON events(task_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_workspace_ts ON events(workspace_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events(project_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_branch ON tasks(target_branch);

CREATE TABLE IF NOT EXISTS commits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT,
  commit_hash TEXT NOT NULL,
  branch TEXT NOT NULL,
  subject TEXT NOT NULL,
  ai_change TEXT,
  ai_pick_notes TEXT,
  depends_on TEXT,
  tests_run TEXT,
  files_changed TEXT NOT NULL DEFAULT '[]',
  committed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  UNIQUE (project_id, commit_hash)
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  env TEXT NOT NULL,
  commit_hash TEXT,
  status TEXT NOT NULL,
  deployed_by TEXT NOT NULL,
  deployed_at TEXT NOT NULL,
  deploy_ref TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_task_time ON commits(task_id, committed_at ASC);
CREATE INDEX IF NOT EXISTS idx_commits_branch ON commits(project_id, branch);
CREATE INDEX IF NOT EXISTS idx_deployments_project_branch ON deployments(project_id, target_branch, deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_task ON deployments(task_id, deployed_at DESC);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  workspace_slug TEXT,
  project_slug TEXT,
  task_slug TEXT,
  stage TEXT,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  commit_hash TEXT,
  files_changed TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_ts ON activity_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_source ON activity_logs(source, ts DESC);
`;

import type { Express, Request, Response } from "express";
import type { SqliteDatabase } from "./db.js";
import type { HandoffStore } from "./store.js";
import type { EventView, HandoffSnapshot, SpecContract, Task } from "./types.js";

const ALLOWED_TABLES = new Set([
  "workspaces",
  "projects",
  "tasks",
  "task_projects",
  "commits",
  "deployments",
  "events",
  "activity_logs"
]);

function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function buildOverview(db: SqliteDatabase, store: HandoffStore) {
  const tableCounts: Record<string, number> = {};
  for (const tbl of ALLOWED_TABLES) {
    const row = db
      .prepare(`SELECT COUNT(*) AS cnt FROM ${tbl}`)
      .get() as { cnt: number };
    tableCounts[tbl] = row.cnt;
  }

  const workspaces = store.listWorkspaces();
  const enrichedWorkspaces = workspaces.map((ws) => {
    const projects = store.listProjects(ws.slug);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const tasks = store.listTasks(ws.slug);

    const enrichedTasks = tasks.map((t) => {
      const proj = projectById.get(t.primary_project_id);
      const commitsCountRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM commits WHERE task_id = ?`)
        .get(t.id) as { cnt: number };

      const projectLinks = db
        .prepare(
          `SELECT p.slug, p.name, p.role, p.repo_path, tp.role AS link_role
           FROM task_projects tp
           JOIN projects p ON p.id = tp.project_id
           WHERE tp.task_id = ?
           ORDER BY CASE tp.role WHEN 'primary' THEN 0 ELSE 1 END, p.slug ASC`
        )
        .all(t.id) as Array<{
        slug: string;
        name: string;
        role: string | null;
        repo_path: string | null;
        link_role: string;
      }>;

      const projectSyncMatrix = projectLinks.map((lp) => {
        const hist = store.getBranchHistory({
          workspace_slug: ws.slug,
          project_slug: lp.slug,
          branch: t.target_branch ?? t.slug,
          task_slug: t.slug
        });
        const synced = (["develop", "staging", "main"] as const).filter(
          (b) => hist.deploy_matrix[b]?.status === "success"
        );
        return {
          project_slug: lp.slug,
          role: lp.role ?? lp.link_role,
          synced_status: synced.length > 0 ? synced.join(" + ") : "unmerged",
          commits_count: hist.commits.length
        };
      });

      return {
        ...t,
        project_slug: proj?.slug ?? "unknown",
        linked_projects: projectLinks,
        commits_count: commitsCountRow.cnt,
        project_sync_matrix: projectSyncMatrix
      };
    });

    // Sort tasks descending by updated_at (newest first)
    enrichedTasks.sort((a, b) => {
      const da = new Date(a.updated_at || a.created_at || 0).getTime();
      const db = new Date(b.updated_at || b.created_at || 0).getTime();
      return db - da;
    });

    return {
      workspace: {
        ...ws,
        deploy_order: safeJsonParse<string[]>(ws.deploy_order_json) ?? []
      },
      projects,
      tasks: enrichedTasks
    };
  });

  return { table_counts: tableCounts, workspaces: enrichedWorkspaces };
}

function buildTaskDetail(
  db: SqliteDatabase,
  store: HandoffStore,
  workspaceSlug: string,
  taskSlug: string
) {
  const workspace = store.getWorkspaceBySlug(workspaceSlug);
  const task = store.getTask(workspaceSlug, taskSlug);
  const projects = store.listProjects(workspaceSlug);
  const linked = db
    .prepare(
      `SELECT p.slug, p.name, p.role, p.repo_path, tp.role AS link_role
       FROM task_projects tp
       JOIN projects p ON p.id = tp.project_id
       WHERE tp.task_id = ?
       ORDER BY CASE tp.role WHEN 'primary' THEN 0 ELSE 1 END, p.slug ASC`
    )
    .all(task.id) as Array<{
    slug: string;
    name: string;
    role: string | null;
    repo_path: string | null;
    link_role: string;
  }>;

  const targetLinks =
    linked.length > 0
      ? linked
      : projects
          .filter((p) => p.id === task.primary_project_id)
          .map((p) => ({
            slug: p.slug,
            name: p.name,
            role: p.role,
            repo_path: p.repo_path,
            link_role: "primary"
          }));

  const perProjectHistory = targetLinks.map((lp) => {
    const hist = store.getBranchHistory({
      workspace_slug: workspaceSlug,
      project_slug: lp.slug,
      branch: task.target_branch ?? task.slug,
      task_slug: task.slug
    });
    // Sort commits descending by committed_at (newest first)
    hist.commits.sort((a, b) => {
      const da = new Date(a.committed_at || 0).getTime();
      const db = new Date(b.committed_at || 0).getTime();
      return db - da;
    });
    return hist;
  });

  const rawEvents: EventView[] = store.getTimeline(workspaceSlug, taskSlug);
  // Sort events descending by timestamp (newest activity first)
  const events = [...rawEvents].sort((a, b) => {
    const da = new Date(a.ts || 0).getTime();
    const db = new Date(b.ts || 0).getTime();
    return db - da;
  });

  const spec = safeJsonParse<SpecContract>(task.spec_json);
  const handoff = safeJsonParse<HandoffSnapshot>(task.handoff_json);

  return {
    workspace: {
      ...workspace,
      deploy_order: safeJsonParse<string[]>(workspace.deploy_order_json) ?? []
    },
    task,
    spec,
    handoff,
    linked_projects: targetLinks,
    per_project_history: perProjectHistory,
    events
  };
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Handoff MCP Activity Cockpit</title>
  <style>
    :root {
      --bg: #0b1120;
      --panel: #111a33;
      --panel-2: #182245;
      --panel-3: #1f2c59;
      --border: #253360;
      --border-subtle: #1c274c;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --green: #10b981;
      --green-bg: rgba(16, 185, 129, 0.12);
      --green-border: rgba(16, 185, 129, 0.35);
      --yellow: #f59e0b;
      --yellow-bg: rgba(245, 158, 11, 0.12);
      --yellow-border: rgba(245, 158, 11, 0.35);
      --red: #ef4444;
      --red-bg: rgba(239, 68, 68, 0.12);
      --red-border: rgba(239, 68, 68, 0.35);
      --purple: #a855f7;
      --purple-bg: rgba(168, 85, 247, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: grid;
      grid-template-columns: 350px 1fr;
      height: 100vh;
      overflow: hidden;
    }
    aside {
      border-right: 1px solid var(--border);
      background: var(--panel);
      padding: 14px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    main {
      padding: 18px 24px;
      overflow-y: auto;
      position: relative;
    }
    h1 {
      font-size: 16px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .sub { font-size: 11px; color: var(--muted); word-break: break-all; }
    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    select, button, input {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      white-space: nowrap;
    }
    input:focus, select:focus { outline: none; border-color: var(--accent); }
    button { cursor: pointer; transition: all 0.15s ease; font-weight: 500; }
    button:hover { border-color: var(--accent); background: var(--panel-3); }
    .full-btn { grid-column: span 2; }
    .search-input { width: 100%; box-sizing: border-box; padding: 7px 10px; margin-top: 2px; }
    .task-counter { font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
    
    /* Task List Cards in Sidebar */
    .task-item {
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      cursor: pointer;
      margin-bottom: 8px;
      transition: all 0.15s ease;
      position: relative;
    }
    .task-item:hover { border-color: var(--accent); transform: translateY(-1px); }
    .task-item.active { border-color: var(--accent); background: #1e2c56; box-shadow: 0 0 0 1px var(--accent); }
    .task-slug { font-size: 11px; font-weight: 700; color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .task-title { font-weight: 600; font-size: 13px; margin: 3px 0 6px; line-height: 1.3; }
    .task-branch-row { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #cbd5e1; margin-bottom: 6px; }
    .task-meta { display: flex; gap: 4px; flex-wrap: wrap; font-size: 10px; color: var(--muted); align-items: center; }
    
    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .badge.in_progress { color: var(--accent); background: rgba(56,189,248,0.1); border-color: var(--accent); }
    .badge.blocked { color: var(--red); background: var(--red-bg); border-color: var(--red-border); }
    .badge.shipped_local, .badge.closed { color: var(--green); background: var(--green-bg); border-color: var(--green-border); }
    .badge.open { color: var(--yellow); background: var(--yellow-bg); border-color: var(--yellow-border); }
    .badge.sync { color: var(--purple); background: var(--purple-bg); border-color: rgba(168,85,247,0.3); text-transform: none; }
    .badge.tag { color: var(--muted); background: var(--panel-3); text-transform: none; font-weight: 400; }

    /* Main Navigation Tabs */
    .tabs { display: flex; gap: 8px; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .tab-btn { background: transparent; border: 1px solid transparent; padding: 7px 14px; border-radius: 6px; color: var(--muted); font-weight: 600; font-size: 13px; }
    .tab-btn.active { background: var(--panel-2); border-color: var(--border); color: var(--text); border-bottom-color: var(--accent); }

    /* Cards */
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
    .card h2 { font-size: 14px; margin: 0 0 12px; color: var(--accent); display: flex; justify-content: space-between; align-items: center; font-weight: 700; }
    .card h3 { font-size: 13px; margin: 14px 0 8px; color: #cbd5e1; font-weight: 600; }

    /* Stepper (Visual Progress) */
    .stepper {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      margin: 12px 0 16px;
      position: relative;
    }
    .step-node {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: all 0.2s ease;
      position: relative;
    }
    .step-node.completed {
      border-color: var(--green-border);
      background: linear-gradient(180deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.02) 100%);
    }
    .step-node.current {
      border-color: var(--accent);
      background: linear-gradient(180deg, rgba(56,189,248,0.12) 0%, rgba(56,189,248,0.03) 100%);
      box-shadow: 0 0 10px rgba(56,189,248,0.15);
    }
    .step-node.blocked {
      border-color: var(--red-border);
      background: var(--red-bg);
    }
    .step-header { display: flex; justify-content: space-between; align-items: center; }
    .step-badge {
      font-size: 10px;
      font-weight: 700;
      border-radius: 999px;
      padding: 2px 6px;
      border: 1px solid var(--border);
    }
    .step-node.completed .step-badge { color: var(--green); border-color: var(--green-border); background: var(--green-bg); }
    .step-node.current .step-badge { color: var(--accent); border-color: var(--accent); background: rgba(56,189,248,0.15); }
    .step-node.blocked .step-badge { color: var(--red); border-color: var(--red-border); background: var(--red-bg); }
    .step-node.pending .step-badge { color: var(--muted); border-color: var(--border); }
    .step-title { font-size: 12px; font-weight: 700; color: var(--text); }
    .step-sub { font-size: 10px; color: var(--muted); line-height: 1.3; }

    /* Executive Callout Card */
    .callout-box {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 12px;
      font-size: 13px;
      line-height: 1.5;
    }
    .callout-box strong { color: var(--accent); }

    /* Checklist & Out-of-Scope Items */
    .checklist { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
    .checklist-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: var(--panel-2);
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      font-size: 12px;
      line-height: 1.4;
    }
    .checklist-item .check-icon {
      color: var(--green);
      font-weight: 700;
      font-size: 13px;
      margin-top: -1px;
    }
    .out-of-scope-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: rgba(239, 68, 68, 0.05);
      border: 1px dashed rgba(239, 68, 68, 0.3);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      color: #fca5a5;
    }

    /* Terminal Command Box */
    .terminal-box {
      background: #060913;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      overflow-x: auto;
      white-space: nowrap;
    }
    .terminal-prompt { color: var(--muted); user-select: none; font-weight: 700; }

    /* Sub-tabs inside Task Detail */
    .subtabs { display: flex; gap: 6px; margin: 12px 0; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .subtab-btn {
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .subtab-btn.active {
      background: var(--panel-3);
      border-color: var(--accent);
      color: var(--text);
    }

    /* Pipeline Step */
    .pipeline-bar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 12px;
    }
    .pipe-step {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 11px;
    }
    .pipe-step.ok { border-color: var(--green-border); background: var(--green-bg); }
    .pipe-step.fail { border-color: var(--red-border); background: var(--red-bg); }
    .pipe-step .pipe-env { font-weight: 700; text-transform: uppercase; font-size: 10px; color: var(--muted); margin-bottom: 2px; }
    .pipe-step.ok .pipe-env { color: var(--green); }

    /* Vertical Timeline */
    .timeline {
      position: relative;
      padding-left: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin: 10px 0;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 7px;
      top: 6px;
      bottom: 6px;
      width: 2px;
      background: var(--border);
    }
    .timeline-node {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
    }
    .timeline-node::before {
      content: '';
      position: absolute;
      left: -21px;
      top: 14px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 3px var(--panel);
    }
    .timeline-node.spec::before { background: var(--purple); }
    .timeline-node.test::before { background: var(--green); }
    .timeline-node.blocked::before { background: var(--red); }
    .timeline-node.ship::before { background: #38bdf8; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    th { color: var(--muted); font-weight: 600; white-space: nowrap; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: var(--panel-2); padding: 2px 5px; border-radius: 4px; }
    .nowrap { white-space: nowrap; }

    /* Side Drawer for JSON / Details */
    .drawer-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(2px);
      z-index: 99;
    }
    .drawer-overlay.open { display: block; }
    .drawer {
      position: fixed;
      top: 0;
      right: -600px;
      width: 580px;
      max-width: 90vw;
      height: 100vh;
      background: var(--panel);
      border-left: 1px solid var(--border);
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
      z-index: 100;
      transition: right 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
    }
    .drawer.open { right: 0; }
    .drawer-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--panel-2);
    }
    .drawer-header h3 { margin: 0; font-size: 14px; color: var(--text); font-weight: 700; }
    .drawer-body {
      padding: 16px 18px;
      overflow-y: auto;
      flex: 1;
    }
    .drawer pre {
      margin: 0;
      background: #060913;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-size: 11px;
      color: #7dd3fc;
      overflow-x: auto;
      line-height: 1.4;
    }
    .close-btn { background: transparent; border: none; font-size: 16px; color: var(--muted); cursor: pointer; padding: 4px 8px; }
    .close-btn:hover { color: var(--text); }
  </style>
</head>
<body>
  <aside>
    <h1><span>⚡</span> Handoff MCP Cockpit</h1>
    <div class="sub" id="dbPath">Loading database...</div>
    
    <input id="taskSearch" class="search-input" placeholder="🔍 Search slug, branch, title..." oninput="renderTaskList()" />
    
    <div class="controls">
      <select id="wsFilter"><option value="">All workspaces</option></select>
      <select id="projectFilter"><option value="">All projects</option></select>
      <select id="statusFilter">
        <option value="">All statuses</option>
        <option value="open">open</option>
        <option value="in_progress">in_progress</option>
        <option value="blocked">blocked</option>
        <option value="shipped_local">shipped_local</option>
        <option value="closed">closed</option>
      </select>
      <button id="refreshBtn">Refresh</button>
      <button id="syncBtn" class="full-btn">Sync Workspace / Git</button>
    </div>

    <div class="task-counter">
      <span id="taskCountLabel">Tasks</span>
      <span id="taskSortLabel" style="font-size:10px;color:var(--accent);">🕒 Newest updated first</span>
    </div>

    <div id="taskList"></div>
  </aside>

  <main>
    <div class="tabs">
      <button class="tab-btn active" data-tab="task" onclick="switchTab('task')">Task Cockpit (Spec / Build)</button>
      <button class="tab-btn" data-tab="monitor" onclick="switchTab('monitor')">Live Activity Monitor</button>
      <button class="tab-btn" data-tab="projects" onclick="switchTab('projects')">Workspaces & Projects</button>
      <button class="tab-btn" data-tab="tables" onclick="switchTab('tables')">Raw DB Tables</button>
    </div>
    <div id="content">Loading workspace state...</div>
  </main>

  <!-- Side Drawer for formatted JSON and details -->
  <div id="drawerOverlay" class="drawer-overlay" onclick="closeDrawer()"></div>
  <div id="sideDrawer" class="drawer">
    <div class="drawer-header">
      <h3 id="drawerTitle">Details</h3>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="drawerCopyBtn" onclick="copyDrawerContent()">📋 Copy JSON</button>
        <button class="close-btn" onclick="closeDrawer()">✕</button>
      </div>
    </div>
    <div class="drawer-body">
      <div id="drawerSub" class="sub" style="margin-bottom:8px;"></div>
      <pre id="drawerPre"></pre>
    </div>
  </div>

  <script>
    let overview = [];
    let tableCounts = {};
    let selected = null;
    let activeTab = "task";
    let taskSubTab = "spec"; // 'spec', 'build', 'commits', 'timeline'
    let monitorLive = true;
    let monitorSource = "";
    let monitorStatus = "";
    let monitorQuery = "";
    let monitorStream = null;
    let currentDrawerData = null;

    function esc(s) {
      return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    }

    function formatTime(iso) {
      if (!iso) return "—";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return esc(iso);
      const pad = (n) => String(n).padStart(2, '0');
      const time = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
      const date = pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
      return time + " " + date;
    }

    function formatRelativeTime(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      const now = new Date();
      const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
      if (diffSec < 60) return "just now";
      if (diffSec < 3600) return Math.floor(diffSec / 60) + "m ago";
      if (diffSec < 86400) return Math.floor(diffSec / 3600) + "h ago";
      return Math.floor(diffSec / 86400) + "d ago";
    }

    async function loadState() {
      const res = await fetch("/viewer/api/state");
      const data = await res.json();
      overview = data.workspaces || [];
      tableCounts = data.table_counts || {};
      document.getElementById("dbPath").textContent = "DB: " + data.db_path;
      populateFilters();
      renderTaskList();
      if (!selected) {
        for (const ws of overview) {
          if (ws.tasks.length > 0) {
            selected = { ws: ws.workspace.slug, slug: ws.tasks[0].slug };
            break;
          }
        }
      }
      renderActiveTab();
    }

    function populateFilters() {
      const wsSel = document.getElementById("wsFilter");
      const prevWs = wsSel.value;
      wsSel.innerHTML = '<option value="">All workspaces</option>' +
        overview.map(w => '<option value="' + esc(w.workspace.slug) + '">' + esc(w.workspace.slug) + '</option>').join("");
      if (prevWs) wsSel.value = prevWs;

      const projSel = document.getElementById("projectFilter");
      const prevProj = projSel.value;
      const projSet = new Set();
      for (const w of overview) {
        if (wsSel.value && w.workspace.slug !== wsSel.value) continue;
        for (const p of w.projects) projSet.add(p.slug);
      }
      projSel.innerHTML = '<option value="">All projects</option>' +
        Array.from(projSet).sort().map(p => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join("");
      if (prevProj && projSet.has(prevProj)) projSel.value = prevProj;
    }

    function renderTaskList() {
      const wsFilter = document.getElementById("wsFilter").value;
      const projFilter = document.getElementById("projectFilter").value;
      const statusFilter = document.getElementById("statusFilter").value;
      const query = (document.getElementById("taskSearch")?.value || "").toLowerCase().trim();
      const root = document.getElementById("taskList");
      
      const allTasks = [];

      for (const ws of overview) {
        if (wsFilter && ws.workspace.slug !== wsFilter) continue;
        for (const t of ws.tasks) {
          if (statusFilter && t.status !== statusFilter) continue;
          const linked = (t.linked_projects || []).map(lp => lp.slug);
          if (projFilter && t.project_slug !== projFilter && !linked.includes(projFilter)) continue;
          
          if (query) {
            const matchSlug = t.slug.toLowerCase().includes(query);
            const matchTitle = (t.title || "").toLowerCase().includes(query);
            const matchBranch = (t.target_branch || "").toLowerCase().includes(query);
            if (!matchSlug && !matchTitle && !matchBranch) continue;
          }

          allTasks.push({ ws, t });
        }
      }

      // Sort tasks DESCENDING by updated_at (newest first)
      allTasks.sort((a, b) => {
        const da = new Date(a.t.updated_at || a.t.created_at || 0).getTime();
        const db = new Date(b.t.updated_at || b.t.created_at || 0).getTime();
        return db - da;
      });

      document.getElementById("taskCountLabel").textContent = "Showing " + allTasks.length + " tasks";

      const items = allTasks.map(({ ws, t }) => {
        const active = selected && selected.ws === ws.workspace.slug && selected.slug === t.slug ? "active" : "";
        const relTime = formatRelativeTime(t.updated_at || t.created_at);
        const branchDisplay = t.target_branch || t.slug;
        const commitCount = t.commits_count || 0;
        const commitText = commitCount === 1 ? '1 commit' : commitCount + ' commits';

        return '<div class="task-item ' + active + '" onclick="selectTask(\\'' + esc(ws.workspace.slug) + '\\',\\'' + esc(t.slug) + '\\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span class="task-slug">' + esc(t.slug) + '</span>' +
            '<span class="badge ' + esc(t.status) + '">' + esc(t.status) + '</span>' +
          '</div>' +
          '<div class="task-title">' + esc(t.title) + '</div>' +
          '<div class="task-branch-row">' +
            '<span>🌿</span>' +
            '<code style="font-size:10px;color:#93c5fd;">' + esc(branchDisplay) + '</code>' +
          '</div>' +
          '<div class="task-meta">' +
            '<span>' + esc(ws.workspace.slug) + '</span> • ' +
            '<span>' + commitText + '</span>' +
            (relTime ? ' • <span>🕒 ' + esc(relTime) + '</span>' : '') +
          '</div>' +
        '</div>';
      });

      root.innerHTML = items.length ? items.join("") : '<div class="empty" style="padding:14px;text-align:center;">No tasks match filter.</div>';
    }

    function switchTab(tab) {
      activeTab = tab;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
      renderActiveTab();
    }

    function selectTask(ws, slug) {
      selected = { ws, slug };
      activeTab = "task";
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "task"));
      renderTaskList();
      renderActiveTab();
    }

    async function renderActiveTab() {
      if (activeTab === "monitor") await renderMonitorTab();
      else if (activeTab === "task") await renderTaskDetail();
      else if (activeTab === "projects") renderProjectsTab();
      else if (activeTab === "tables") await renderTablesTab("tasks");
    }

    function switchTaskSubTab(sub) {
      taskSubTab = sub;
      document.querySelectorAll(".subtab-btn").forEach(b => b.classList.toggle("active", b.dataset.sub === sub));
      document.querySelectorAll(".subtab-pane").forEach(p => p.style.display = p.id === "subtab-" + sub ? "block" : "none");
    }

    function openDrawer(title, subtitle, data) {
      currentDrawerData = data;
      document.getElementById("drawerTitle").textContent = title || "Details";
      document.getElementById("drawerSub").textContent = subtitle || "";
      document.getElementById("drawerPre").textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      document.getElementById("drawerOverlay").classList.add("open");
      document.getElementById("sideDrawer").classList.add("open");
    }

    function closeDrawer() {
      document.getElementById("drawerOverlay").classList.remove("open");
      document.getElementById("sideDrawer").classList.remove("open");
    }

    function copyDrawerContent() {
      if (!currentDrawerData) return;
      const text = typeof currentDrawerData === "string" ? currentDrawerData : JSON.stringify(currentDrawerData, null, 2);
      navigator.clipboard.writeText(text);
      const btn = document.getElementById("drawerCopyBtn");
      btn.textContent = "✓ Copied!";
      setTimeout(() => btn.textContent = "📋 Copy JSON", 2000);
    }

    /* Task Detail Rendering with Visual Stepper and Tabbed Cockpit */
    async function renderTaskDetail() {
      const root = document.getElementById("content");
      if (!selected) {
        root.innerHTML = '<div class="card"><div class="empty">No task selected. Select a task from the sidebar.</div></div>';
        return;
      }

      root.innerHTML = '<div class="card"><div class="empty">Loading task cockpit...</div></div>';

      const res = await fetch('/viewer/api/task?workspace=' + encodeURIComponent(selected.ws) + '&task=' + encodeURIComponent(selected.slug));
      const d = await res.json();
      const t = d.task;
      const spec = d.spec;
      const h = d.handoff;
      const events = d.events || [];
      const verifyEvents = events.filter(e => e.type === "test_passed" || e.type === "test_blocked");

      // Compute Stepper States
      const hasSpec = !!(spec && spec.objective);
      const hasUnit = verifyEvents.some(v => (v.payload?.verify_type || "").includes("unit") || v.type === "test_passed") || !!h;
      const hasE2E = verifyEvents.some(v => (v.payload?.verify_type || "").includes("playwright") || (v.payload?.verify_type || "").includes("e2e")) || (!!h && !!spec?.e2e_checks?.length);
      const isShipped = t.status === "shipped_local" || t.status === "closed" || !!h;
      const isDeployed = (d.per_project_history || []).some(ph => ["develop", "staging", "main"].some(env => ph.deploy_matrix?.[env]?.status === "success"));

      const s1Class = hasSpec ? "completed" : (t.status === "open" ? "current" : "pending");
      const s2Class = hasUnit ? "completed" : (t.status === "in_progress" ? "current" : "pending");
      const s3Class = hasE2E ? "completed" : (spec?.e2e_checks?.length ? "current" : "pending");
      const s4Class = isShipped ? "completed" : (hasUnit || hasE2E ? "current" : "pending");
      const s5Class = isDeployed ? "completed" : "pending";

      const stepperHtml =
        '<div class="stepper">' +
          '<div class="step-node ' + s1Class + '">' +
            '<div class="step-header"><span class="step-title">1. Spec Defined</span><span class="step-badge">' + (hasSpec ? '✓ DONE' : 'WAITING') + '</span></div>' +
            '<div class="step-sub">Objective & Criteria</div>' +
          '</div>' +
          '<div class="step-node ' + s2Class + '">' +
            '<div class="step-header"><span class="step-title">2. Unit / TDD</span><span class="step-badge">' + (hasUnit ? '✓ PASS' : 'BUILD') + '</span></div>' +
            '<div class="step-sub">Logic Verification</div>' +
          '</div>' +
          '<div class="step-node ' + s3Class + '">' +
            '<div class="step-header"><span class="step-title">3. Playwright E2E</span><span class="step-badge">' + (hasE2E ? '✓ PASS' : 'BROWSER') + '</span></div>' +
            '<div class="step-sub">Real Runtime Check</div>' +
          '</div>' +
          '<div class="step-node ' + s4Class + '">' +
            '<div class="step-header"><span class="step-title">4. Shipped Local</span><span class="step-badge">' + (isShipped ? '✓ DONE' : 'PENDING') + '</span></div>' +
            '<div class="step-sub">Commits & Handoff</div>' +
          '</div>' +
          '<div class="step-node ' + s5Class + '">' +
            '<div class="step-header"><span class="step-title">5. Deployed</span><span class="step-badge">' + (isDeployed ? '✓ DEPLOYED' : 'UNMERGED') + '</span></div>' +
            '<div class="step-sub">Dev / Stage / Main</div>' +
          '</div>' +
        '</div>';

      // Header Executive Card
      const headerHtml =
        '<div class="card" style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">' +
            '<div>' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<span class="task-slug" style="font-size:13px;">' + esc(t.slug) + '</span>' +
                '<span class="badge ' + esc(t.status) + '">' + esc(t.status) + '</span>' +
              '</div>' +
              '<h2 style="font-size:18px;margin:4px 0 6px;color:#f8fafc;">' + esc(t.title) + '</h2>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<span class="badge sync">Workspace: ' + esc(d.workspace.slug) + '</span>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--muted);background:var(--panel-2);padding:8px 12px;border-radius:6px;border:1px solid var(--border);">' +
            '<div><strong>🌿 Base Branch:</strong> <code>' + esc(t.base_branch || "develop") + '</code></div>' +
            '<div><strong>🌿 Target Branch:</strong> <code style="color:#38bdf8;">' + esc(t.target_branch || t.slug) + '</code></div>' +
            '<div><strong>Linked Projects:</strong> ' + esc((d.linked_projects || []).map(lp => lp.slug + (lp.role ? ' [' + lp.role + ']' : '')).join(", ") || "—") + '</div>' +
            '<div><strong>Fix Attempts:</strong> ' + esc(t.fix_attempts) + ' / 3</div>' +
            (t.updated_at ? '<div><strong>🕒 Updated:</strong> ' + esc(formatTime(t.updated_at)) + '</div>' : '') +
          '</div>' +
          stepperHtml +
        '</div>';

      // Sub-Tabs Navigation
      const subTabsHtml =
        '<div class="subtabs">' +
          '<button class="subtab-btn ' + (taskSubTab === "spec" ? "active" : "") + '" data-sub="spec" onclick="switchTaskSubTab(\\'spec\\')">📋 1. Kế hoạch & Nghiệm thu (Spec)</button>' +
          '<button class="subtab-btn ' + (taskSubTab === "build" ? "active" : "") + '" data-sub="build" onclick="switchTaskSubTab(\\'build\\')">🛠️ 2. Kết quả & Kiểm thử (Build & Handoff)</button>' +
          '<button class="subtab-btn ' + (taskSubTab === "commits" ? "active" : "") + '" data-sub="commits" onclick="switchTaskSubTab(\\'commits\\')">🌿 3. Commits & Pipeline Deploy</button>' +
          '<button class="subtab-btn ' + (taskSubTab === "timeline" ? "active" : "") + '" data-sub="timeline" onclick="switchTaskSubTab(\\'timeline\\')">⏱️ 4. Dòng thời gian hoạt động (' + events.length + ')</button>' +
        '</div>';

      // Pane 1: Spec & Acceptance Criteria
      let specPaneHtml = '<div id="subtab-spec" class="subtab-pane" style="display:' + (taskSubTab === "spec" ? "block" : "none") + ';">';
      if (spec) {
        specPaneHtml +=
          '<div class="card">' +
            '<h2>🎯 Mục tiêu cốt lõi (Objective)</h2>' +
            '<div class="callout-box"><strong>Objective:</strong> ' + esc(spec.objective) + '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">' +
              '<div style="background:var(--panel-2);padding:10px;border-radius:6px;border:1px solid var(--border);font-size:12px;">' +
                '<strong style="color:var(--muted);">AFFECTED PROJECTS</strong>' +
                '<div style="margin-top:4px;">' + esc((spec.affected_projects || []).join(", ") || "—") + '</div>' +
              '</div>' +
              '<div style="background:var(--panel-2);padding:10px;border-radius:6px;border:1px solid var(--border);font-size:12px;">' +
                '<strong style="color:var(--muted);">DEPLOY ORDER</strong>' +
                '<div style="margin-top:4px;">' + esc((spec.deploy_order || d.workspace.deploy_order || []).join(" ➔ ") || "—") + '</div>' +
              '</div>' +
            '</div>' +
            (spec.out_of_scope?.length ?
              '<div style="margin-bottom:12px;">' +
                '<h3>🚫 Phạm vi không làm (Out of Scope)</h3>' +
                '<div class="checklist">' +
                  spec.out_of_scope.map(o => '<div class="out-of-scope-item"><span>✕</span><span>' + esc(o) + '</span></div>').join("") +
                '</div>' +
              '</div>' : '') +
            (spec.acceptance_criteria?.length ?
              '<div style="margin-bottom:12px;">' +
                '<h3>✓ Tiêu chí nghiệm thu (Acceptance Criteria)</h3>' +
                '<div class="checklist">' +
                  spec.acceptance_criteria.map(a => '<div class="checklist-item"><span class="check-icon">✓</span><span>' + esc(a) + '</span></div>').join("") +
                '</div>' +
              '</div>' : '') +
            (spec.verify_commands?.length ?
              '<div>' +
                '<h3>🧪 Lệnh kiểm thử (Verify Commands)</h3>' +
                spec.verify_commands.map(cmd => '<div class="terminal-box"><span class="terminal-prompt">$</span><span>' + esc(cmd) + '</span></div>').join("") +
              '</div>' : '') +
            (spec.e2e_checks?.length ?
              '<div style="margin-top:10px;">' +
                '<h3>🎭 Kiểm thử trình duyệt thực tế (Playwright / E2E Checks)</h3>' +
                spec.e2e_checks.map(cmd => '<div class="terminal-box"><span class="terminal-prompt">$</span><span>' + esc(cmd) + '</span></div>').join("") +
              '</div>' : '') +
          '</div>';
      } else {
        specPaneHtml += '<div class="card"><div class="empty">Chưa có Spec nào được xác nhận cho task này (Chạy lệnh /spec để chốt spec).</div></div>';
      }
      specPaneHtml += '</div>';

      // Pane 2: Build & Verification & Handoff
      let buildPaneHtml = '<div id="subtab-build" class="subtab-pane" style="display:' + (taskSubTab === "build" ? "block" : "none") + ';">';
      buildPaneHtml +=
        '<div class="card">' +
          '<h2>🧪 Bằng chứng kiểm thử & Xác thực (Verification Verdict)</h2>' +
          (verifyEvents.length ?
            '<div style="overflow-x:auto;"><table><thead><tr><th>Thời gian</th><th>Trạng thái</th><th>Loại test</th><th>Kết quả tóm tắt</th><th>Payload</th></tr></thead><tbody>' +
              verifyEvents.map(v => {
                const p = v.payload || {};
                const isPass = v.type === "test_passed";
                return '<tr>' +
                  '<td class="nowrap"><code>' + esc(formatTime(v.ts)) + '</code></td>' +
                  '<td><span class="badge ' + (isPass ? "closed" : "blocked") + '">' + (isPass ? '✓ PASS' : '✕ BLOCKED') + '</span></td>' +
                  '<td><code>' + esc(p.verify_type || "test") + '</code></td>' +
                  '<td>' + esc(v.summary) + '</td>' +
                  '<td><button onclick="openDrawer(\\'Verification Payload\\', \\'' + esc(v.summary) + '\\', ' + esc(JSON.stringify(p)) + ')">Chi tiết</button></td>' +
                '</tr>';
              }).join("") +
            '</tbody></table></div>' :
            '<div class="empty">Chưa có sự kiện test/verification nào được ghi nhận.</div>') +
        '</div>';

      if (h) {
        buildPaneHtml +=
          '<div class="card">' +
            '<h2>💾 Handoff Snapshot (Bàn giao kỹ thuật)</h2>' +
            '<div class="callout-box"><strong>Final Business Logic:</strong> ' + esc(h.final_business_logic) + '</div>' +
            (h.workspace_manifest_path ? '<div style="margin-bottom:10px;font-size:12px;"><strong>Workspace Manifest:</strong> <code>' + esc(h.workspace_manifest_path) + '</code></div>' : '') +
            (h.technical_flow?.length ?
              '<div style="margin-bottom:12px;">' +
                '<h3>⚙️ Luồng kỹ thuật (Technical Flow)</h3>' +
                '<ol style="margin:4px 0 10px;padding-left:20px;font-size:13px;line-height:1.5;">' +
                  h.technical_flow.map(s => '<li>' + esc(s) + '</li>').join("") +
                '</ol>' +
              '</div>' : '') +
            (h.important_references?.length ?
              '<div style="margin-bottom:12px;">' +
                '<h3>📌 Symbols & Module quan trọng</h3>' +
                '<table><thead><tr><th>Symbol</th><th>File</th><th>Ghi chú</th></tr></thead><tbody>' +
                  h.important_references.map(r => '<tr><td><code>' + esc(r.symbol) + '</code></td><td><code>' + esc(r.file) + '</code></td><td>' + esc(r.notes || "—") + '</td></tr>').join("") +
                '</tbody></table>' +
              '</div>' : '') +
            (h.next_ai_instructions?.length ?
              '<div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:6px;padding:10px 14px;">' +
                '<strong style="color:var(--accent);">🤖 Chỉ dẫn cho AI Agent tiếp theo (Next AI Instructions):</strong>' +
                '<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;">' +
                  h.next_ai_instructions.map(ins => '<li>' + esc(ins) + '</li>').join("") +
                '</ul>' +
              '</div>' : '') +
          '</div>';
      } else {
        buildPaneHtml += '<div class="card"><div class="empty">Chưa có Handoff Snapshot nào được lưu (Được tạo tự động ở Bước 5 của /build).</div></div>';
      }
      buildPaneHtml += '</div>';

      // Pane 3: Commits & Deployment Pipeline
      let commitsPaneHtml = '<div id="subtab-commits" class="subtab-pane" style="display:' + (taskSubTab === "commits" ? "block" : "none") + ';">';
      const historyList = d.per_project_history || [];
      if (historyList.length) {
        commitsPaneHtml += historyList.map(ph => {
          const boxes = ["local", "develop", "staging", "main"].map(env => {
            const dep = ph.deploy_matrix?.[env];
            const isOk = dep && dep.status === "success";
            return '<div class="pipe-step ' + (isOk ? "ok" : "") + '">' +
              '<div class="pipe-env">' + esc(env) + '</div>' +
              '<div>' + (isOk ? '<strong>✓ DEPLOYED</strong>' : '<span style="color:var(--muted);">not deployed</span>') + '</div>' +
              (dep ? '<div class="sub">' + esc(dep.deployed_by || "auto") + ' @ ' + esc(formatTime(dep.deployed_at)) + '</div>' : '') +
            '</div>';
          }).join("");

          const commitRows = (ph.commits || []).map(c =>
            '<tr>' +
              '<td><code style="color:#fbbf24;border:1px solid #78350f;">' + esc((c.commit_hash || "").slice(0, 7)) + '</code></td>' +
              '<td><code>' + esc(c.branch) + '</code></td>' +
              '<td>' + esc(c.subject) + '</td>' +
              '<td class="nowrap"><code>' + esc(formatTime(c.committed_at)) + '</code></td>' +
            '</tr>'
          ).join("");

          return '<div class="card">' +
            '<h2><span>📁 Dự án: ' + esc(ph.project.slug) + (ph.project.role ? ' [' + esc(ph.project.role) + ']' : '') + '</span><span class="badge tag">' + (ph.commits || []).length + ' commits (giảm dần)</span></h2>' +
            '<div class="pipeline-bar">' + boxes + '</div>' +
            (commitRows ?
              '<div style="overflow-x:auto;"><table><thead><tr><th>SHA</th><th>Branch</th><th>Commit Message</th><th>Thời gian commit</th></tr></thead><tbody>' + commitRows + '</tbody></table></div>' :
              '<div class="empty">Chưa có commit nào được đồng bộ trong project này.</div>') +
          '</div>';
        }).join("");
      } else {
        commitsPaneHtml += '<div class="card"><div class="empty">Không tìm thấy thông tin dự án liên kết.</div></div>';
      }
      commitsPaneHtml += '</div>';

      // Pane 4: Vertical Activity Timeline
      let timelinePaneHtml = '<div id="subtab-timeline" class="subtab-pane" style="display:' + (taskSubTab === "timeline" ? "block" : "none") + ';">';
      if (events.length) {
        timelinePaneHtml +=
          '<div class="card">' +
            '<h2><span>⏱️ Lịch sử hoạt động (Timeline - Mới nhất trước)</span><span class="badge tag">' + events.length + ' events</span></h2>' +
            '<div class="timeline">' +
              events.map(e => {
                let nodeCls = "note";
                let icon = "ℹ️";
                if (e.type === "spec_confirmed") { nodeCls = "spec"; icon = "📝"; }
                else if (e.type === "test_passed") { nodeCls = "test"; icon = "🧪"; }
                else if (e.type === "test_blocked") { nodeCls = "blocked"; icon = "⚠️"; }
                else if (e.type === "code_shipped") { nodeCls = "ship"; icon = "🚀"; }
                else if (e.type === "handoff_saved") { nodeCls = "ship"; icon = "💾"; }

                return '<div class="timeline-node ' + nodeCls + '">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                    '<div style="display:flex;align-items:center;gap:6px;">' +
                      '<span>' + icon + '</span>' +
                      '<span class="badge">' + esc(e.type) + '</span>' +
                      '<span style="font-weight:600;font-size:12px;">' + esc(e.summary) + '</span>' +
                    '</div>' +
                    '<div style="display:flex;gap:6px;align-items:center;">' +
                      '<span class="sub nowrap"><code>' + esc(formatTime(e.ts)) + '</code></span>' +
                      '<button onclick="openDrawer(\\'Event: ' + esc(e.type) + '\\', \\'' + esc(e.summary) + '\\', ' + esc(JSON.stringify(e.payload)) + ')">Payload</button>' +
                    '</div>' +
                  '</div>' +
                '</div>';
              }).join("") +
            '</div>' +
          '</div>';
      } else {
        timelinePaneHtml += '<div class="card"><div class="empty">Chưa có sự kiện nào trong timeline.</div></div>';
      }
      timelinePaneHtml += '</div>';

      root.innerHTML = headerHtml + subTabsHtml + specPaneHtml + buildPaneHtml + commitsPaneHtml + timelinePaneHtml;
    }

    /* Live Activity Monitor Rendering */
    function renderLogRow(l) {
      let files = [];
      try { files = JSON.parse(l.files_changed || "[]"); } catch {}
      const commitBadge = l.commit_hash
        ? '<code title="' + esc(l.commit_hash) + '" style="color:#fbbf24;border:1px solid #78350f;">' + esc(l.commit_hash.slice(0, 7)) + '</code> '
        : '';
      const filesHtml = files.length
        ? '<div class="sub" style="margin-top:2px;">Files (' + files.length + '): ' + files.slice(0, 5).map(f => '<code>' + esc(f) + '</code>').join(" ") + (files.length > 5 ? ' +' + (files.length - 5) + ' more' : '') + '</div>'
        : '';
      const statusCls = l.status === "success" ? "closed" : (l.status === "error" ? "blocked" : (l.status === "running" ? "in_progress" : "open"));
      const scope = [l.workspace_slug, l.project_slug, l.task_slug].filter(Boolean).join(" / ") || "global";
      
      let detailsBtn = '';
      if (l.details_json) {
        try {
          const parsed = JSON.parse(l.details_json);
          detailsBtn = '<button onclick="openDrawer(\\'Activity Details: ' + esc(l.action) + '\\', \\'' + esc(l.summary) + '\\', ' + esc(JSON.stringify(parsed)) + ')">Chi tiết</button>';
        } catch {
          detailsBtn = '<button onclick="openDrawer(\\'Activity Details\\', \\'\\', ' + esc(JSON.stringify(l.details_json)) + ')">Chi tiết</button>';
        }
      }

      // Avoid repeating action inside summary if summary starts with action
      let cleanSummary = l.summary || "";
      if (l.commit_hash && cleanSummary.startsWith(l.commit_hash.slice(0, 7))) {
        cleanSummary = cleanSummary.replace(new RegExp('^' + l.commit_hash.slice(0, 7) + '\\s*—?\\s*'), '');
      }
      if (cleanSummary.startsWith(l.source + '.' + l.action) || cleanSummary.startsWith(l.action)) {
        cleanSummary = cleanSummary.replace(new RegExp('^(' + l.source + '\\.)?' + l.action + '(\\s*\\(\\d+ms\\))?\\s*:?\\s*'), '');
        if (!cleanSummary) cleanSummary = "Executed " + l.action;
      }

      return '<tr>' +
        '<td class="nowrap"><code>' + esc(formatTime(l.ts)) + '</code></td>' +
        '<td><span class="badge sync">' + esc(l.source) + '</span>' + (l.stage ? ' <span class="badge tag">' + esc(l.stage) + '</span>' : '') + '</td>' +
        '<td><span class="badge ' + statusCls + '">' + esc(l.status) + '</span></td>' +
        '<td><div class="sub">' + esc(scope) + '</div><code>' + esc(l.action) + '</code>' + (l.duration_ms != null ? ' <span class="nowrap" style="color:var(--accent);font-size:10px;">(' + l.duration_ms + 'ms)</span>' : '') + '</td>' +
        '<td>' + commitBadge + esc(cleanSummary) + filesHtml + '</td>' +
        '<td>' + detailsBtn + '</td>' +
      '</tr>';
    }

    async function renderMonitorTab() {
      const root = document.getElementById("content");
      const params = new URLSearchParams();
      const wsFilter = document.getElementById("wsFilter").value;
      if (wsFilter) params.set("workspace", wsFilter);
      if (monitorSource) params.set("source", monitorSource);
      if (monitorStatus) params.set("status", monitorStatus);
      if (monitorQuery) params.set("q", monitorQuery);
      params.set("limit", "150");

      const res = await fetch("/viewer/api/logs?" + params.toString());
      const data = await res.json();
      const logs = data.logs || [];

      root.innerHTML =
        '<div class="card">' +
          '<h2><span>Live Activity Monitor</span>' +
            '<span style="display:flex;gap:6px;align-items:center;">' +
              '<button onclick="toggleLiveMonitor()">' + (monitorLive ? '🟢 LIVE (SSE): ON' : '⏸️ PAUSED') + '</button>' +
              '<button onclick="renderMonitorTab()">Reload</button>' +
            '</span>' +
          '</h2>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
            '<select id="monSrc" onchange="monitorSource=this.value;renderMonitorTab()">' +
              '<option value="">All sources</option>' +
              ['git', 'playwright', 'agent', 'pg', 'redis', 'handoff', 'backlog'].map(s => '<option value="' + s + '"' + (monitorSource === s ? ' selected' : '') + '>' + s + '</option>').join("") +
            '</select>' +
            '<select id="monStat" onchange="monitorStatus=this.value;renderMonitorTab()">' +
              '<option value="">All statuses</option>' +
              ['running', 'success', 'error', 'info'].map(s => '<option value="' + s + '"' + (monitorStatus === s ? ' selected' : '') + '>' + s + '</option>').join("") +
            '</select>' +
            '<input id="monSearch" value="' + esc(monitorQuery) + '" placeholder="🔍 Tìm kiếm commit, file, action, summary..." style="flex:1;min-width:200px;" oninput="monitorQuery=this.value;renderMonitorTab()" />' +
          '</div>' +
          (logs.length
            ? '<div style="overflow-x:auto;"><table><thead><tr><th>Thời gian</th><th>Source</th><th>Status</th><th>Scope / Action</th><th>Summary / Commit / Files</th><th>Chi tiết</th></tr></thead><tbody id="monitorBody">' +
                logs.map(renderLogRow).join("") +
              '</tbody></table></div>'
            : '<div class="empty" style="padding:16px;text-align:center;">' +
                (monitorSource || monitorStatus || monitorQuery ? 'Không tìm thấy log nào khớp với bộ lọc hiện tại.' : 'Chưa có activity logs nào được ghi nhận. Các tool MCP, commit Git và test Playwright sẽ tự động xuất hiện tại đây.') +
              '</div>') +
        '</div>';

      ensureMonitorStream();
    }

    function toggleLiveMonitor() {
      monitorLive = !monitorLive;
      if (!monitorLive && monitorStream) {
        monitorStream.close();
        monitorStream = null;
      }
      renderMonitorTab();
    }

    function ensureMonitorStream() {
      if (!monitorLive || monitorStream) return;
      monitorStream = new EventSource("/viewer/api/stream");
      monitorStream.onmessage = (ev) => {
        if (!monitorLive || activeTab !== "monitor") return;
        try {
          const log = JSON.parse(ev.data);
          if (monitorSource && log.source !== monitorSource) return;
          if (monitorStatus && log.status !== monitorStatus) return;
          const body = document.getElementById("monitorBody");
          if (body) {
            body.insertAdjacentHTML("afterbegin", renderLogRow(log));
          } else {
            renderMonitorTab();
          }
        } catch {}
      };
    }

    function renderProjectsTab() {
      const root = document.getElementById("content");
      root.innerHTML = overview.map(w =>
        '<div class="card">' +
          '<h2><span>Workspace: ' + esc(w.workspace.slug) + ' (' + esc(w.workspace.name) + ')</span><span class="badge tag">' + w.projects.length + ' projects</span></h2>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">' +
            '<div style="background:var(--panel-2);padding:8px 12px;border-radius:6px;border:1px solid var(--border);font-size:12px;"><strong>Manifest Path:</strong> <code>' + esc(w.workspace.manifest_path || "—") + '</code></div>' +
            '<div style="background:var(--panel-2);padding:8px 12px;border-radius:6px;border:1px solid var(--border);font-size:12px;"><strong>Deploy Order:</strong> ' + esc((w.workspace.deploy_order || []).join(" ➔ ") || "—") + '</div>' +
          '</div>' +
          '<div style="overflow-x:auto;"><table><thead><tr><th>Slug</th><th>Role</th><th>Repo Path</th><th>Default Branch</th></tr></thead><tbody>' +
            w.projects.map(p => '<tr><td><code>' + esc(p.slug) + '</code></td><td>' + esc(p.role || "—") + '</td><td><code>' + esc(p.repo_path || "—") + '</code></td><td><code>' + esc(p.default_branch || "—") + '</code></td></tr>').join("") +
          '</tbody></table></div>' +
        '</div>'
      ).join("") || '<div class="card"><div class="empty">No workspaces registered.</div></div>';
    }

    async function renderTablesTab(tableName) {
      const root = document.getElementById("content");
      const res = await fetch('/viewer/api/table?name=' + encodeURIComponent(tableName));
      const data = await res.json();
      const rows = data.rows || [];
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const btns = Object.keys(tableCounts).map(t =>
        '<button onclick="renderTablesTab(\\'' + esc(t) + '\\')" style="' + (t === tableName ? 'border-color:var(--accent);background:var(--panel-3);' : '') + '">' + esc(t) + ' (' + tableCounts[t] + ')</button>'
      ).join(" ");
      root.innerHTML = '<div class="card"><h2>Raw SQLite Tables</h2><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' + btns + '</div>' +
        (rows.length ? '<div style="overflow-x:auto;"><table><thead><tr>' + cols.map(c => '<th>' + esc(c) + '</th>').join("") + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + cols.map(c => '<td><code>' + esc(typeof r[c] === "string" ? r[c] : JSON.stringify(r[c])) + '</code></td>').join("") + '</tr>').join("") +
        '</tbody></table></div>' : '<div class="empty">Table is empty.</div>') +
      '</div>';
    }

    document.getElementById("refreshBtn").addEventListener("click", loadState);
    document.getElementById("wsFilter").addEventListener("change", () => { populateFilters(); renderTaskList(); });
    document.getElementById("projectFilter").addEventListener("change", renderTaskList);
    document.getElementById("statusFilter").addEventListener("change", renderTaskList);
    document.getElementById("syncBtn").addEventListener("click", async () => {
      const btn = document.getElementById("syncBtn");
      btn.disabled = true;
      btn.textContent = "Syncing...";
      try {
        await fetch("/viewer/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        await loadState();
      } finally {
        btn.disabled = false;
        btn.textContent = "Sync Workspace / Git";
      }
    });

    loadState();
  </script>
</body>
</html>`;

export function registerHandoffViewer(
  app: Express,
  db: SqliteDatabase,
  store: HandoffStore,
  dbPath: string
): void {
  app.get("/viewer", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(DASHBOARD_HTML);
  });

  app.get("/viewer/api/state", (_req: Request, res: Response) => {
    try {
      const data = buildOverview(db, store);
      res.json({ db_path: dbPath, ...data });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/viewer/api/task", (req: Request, res: Response) => {
    try {
      const workspace = String(req.query.workspace ?? "");
      const task = String(req.query.task ?? "");
      res.json(buildTaskDetail(db, store, workspace, task));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/viewer/api/table", (req: Request, res: Response) => {
    try {
      const name = String(req.query.name ?? "");
      if (!ALLOWED_TABLES.has(name)) {
        res.status(400).json({ error: `Invalid table: ${name}` });
        return;
      }
      const rows = db.prepare(`SELECT * FROM ${name} LIMIT 200`).all();
      res.json({ table: name, rows });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/viewer/api/sync", (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { repo_path?: string; manifest_path?: string };
      if (body.manifest_path) {
        res.json({ synced: [store.syncWorkspace({ manifest_path: body.manifest_path })] });
        return;
      }
      if (body.repo_path) {
        res.json({ synced: [store.syncGitState({ repo_path: body.repo_path })] });
        return;
      }
      const workspaces = store.listWorkspaces();
      const syncedWorkspaceIds = new Set<string>();
      const results: unknown[] = [];
      for (const ws of workspaces) {
        if (ws.manifest_path) {
          syncedWorkspaceIds.add(ws.id);
          results.push(store.syncWorkspace({ manifest_path: ws.manifest_path }));
        }
      }
      const projects = db
        .prepare(`SELECT workspace_id, repo_path FROM projects WHERE repo_path IS NOT NULL AND repo_path != ''`)
        .all() as Array<{ workspace_id: string; repo_path: string }>;
      for (const p of projects) {
        if (syncedWorkspaceIds.has(p.workspace_id)) continue;
        results.push(store.syncGitState({ repo_path: p.repo_path }));
      }
      res.json({ synced: results });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/viewer/api/logs", (req: Request, res: Response) => {
    try {
      const workspace_slug = req.query.workspace ? String(req.query.workspace) : undefined;
      const source = req.query.source ? String(req.query.source) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const q = req.query.q ? String(req.query.q) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 150;
      const logs = store.listActivityLogs({ workspace_slug, source, status, q, limit });
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/viewer/api/logs", (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.action !== "string" || typeof body.summary !== "string") {
        res.status(400).json({ error: "action and summary are required strings" });
        return;
      }
      const record = store.logActivity({
        workspace_slug: typeof body.workspace_slug === "string" ? body.workspace_slug : undefined,
        project_slug: typeof body.project_slug === "string" ? body.project_slug : undefined,
        task_slug: typeof body.task_slug === "string" ? body.task_slug : undefined,
        stage: typeof body.stage === "string" ? body.stage : undefined,
        source: typeof body.source === "string" ? body.source : "agent",
        action: body.action,
        status:
          body.status === "info" ||
          body.status === "running" ||
          body.status === "success" ||
          body.status === "error"
            ? body.status
            : "info",
        duration_ms: typeof body.duration_ms === "number" ? body.duration_ms : undefined,
        commit_hash: typeof body.commit_hash === "string" ? body.commit_hash : undefined,
        files_changed: Array.isArray(body.files_changed)
          ? body.files_changed.filter((x): x is string => typeof x === "string")
          : undefined,
        summary: body.summary,
        details:
          body.details && typeof body.details === "object" && !Array.isArray(body.details)
            ? (body.details as Record<string, unknown>)
            : undefined,
        ts: typeof body.ts === "string" ? body.ts : undefined
      });
      res.status(201).json(record);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/viewer/api/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const unsubscribe = store.onActivityLog((log) => {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    });

    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}

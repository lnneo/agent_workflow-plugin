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

  const perProjectHistory = targetLinks.map((lp) =>
    store.getBranchHistory({
      workspace_slug: workspaceSlug,
      project_slug: lp.slug,
      branch: task.target_branch ?? task.slug,
      task_slug: task.slug
    })
  );

  const events: EventView[] = store.getTimeline(workspaceSlug, taskSlug);
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
  <title>Handoff MCP Viewer</title>
  <style>
    :root {
      --bg: #0b1020; --panel: #121931; --panel-2: #192242; --border: #27345e;
      --text: #e6ebf5; --muted: #93a1c2; --accent: #60a5fa;
      --green: #22c55e; --red: #ef4444; --yellow: #eab308; --purple: #a78bfa;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
    aside { border-right: 1px solid var(--border); background: var(--panel); padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    main { padding: 18px 22px; overflow-y: auto; }
    h1 { font-size: 16px; margin: 0; }
    .sub { font-size: 11px; color: var(--muted); word-break: break-all; }
    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    select, button { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; cursor: pointer; }
    button:hover { border-color: var(--accent); }
    .full-btn { grid-column: span 2; }
    .task-item { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); cursor: pointer; margin-bottom: 8px; }
    .task-item.active { border-color: var(--accent); background: #1e2a52; }
    .task-title { font-weight: 600; font-size: 13px; margin-bottom: 5px; }
    .task-meta { display: flex; gap: 5px; flex-wrap: wrap; font-size: 11px; color: var(--muted); align-items: center; }
    .badge { padding: 2px 6px; border-radius: 999px; font-size: 10px; font-weight: 600; text-transform: uppercase; border: 1px solid var(--border); }
    .badge.in_progress { color: var(--accent); border-color: var(--accent); }
    .badge.blocked { color: var(--red); border-color: var(--red); }
    .badge.shipped_local, .badge.closed { color: var(--green); border-color: var(--green); }
    .badge.open { color: var(--yellow); border-color: var(--yellow); }
    .badge.sync { color: var(--purple); border-color: #4c1d95; text-transform: none; }
    .tabs { display: flex; gap: 8px; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .tab-btn { background: transparent; border: 1px solid transparent; padding: 6px 12px; border-radius: 6px; color: var(--muted); font-weight: 600; }
    .tab-btn.active { background: var(--panel-2); border-color: var(--border); color: var(--text); }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
    .card h2 { font-size: 14px; margin: 0 0 10px; color: var(--accent); display: flex; justify-content: space-between; align-items: center; }
    .matrix { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px; }
    .env-box { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
    .env-box.ok { border-color: #166534; }
    .env-box.fail { border-color: #991b1b; }
    .env-name { font-weight: 700; margin-bottom: 4px; text-transform: uppercase; font-size: 10px; color: var(--muted); }
    .kv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; font-size: 12px; margin-bottom: 10px; }
    .kv-item { background: var(--panel-2); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border); }
    .kv-label { color: var(--muted); font-size: 10px; text-transform: uppercase; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: var(--panel-2); padding: 2px 5px; border-radius: 4px; }
    ul { margin: 4px 0 8px; padding-left: 18px; font-size: 13px; }
    .empty { color: var(--muted); font-size: 13px; font-style: italic; }
    pre { background: var(--panel-2); padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 11px; border: 1px solid var(--border); margin: 4px 0 0; }
    details summary { cursor: pointer; color: var(--accent); font-size: 11px; }
  </style>
</head>
<body>
  <aside>
    <h1>Handoff MCP Viewer</h1>
    <div class="sub" id="dbPath">Loading...</div>
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
    <div id="taskList"></div>
  </aside>
  <main>
    <div class="tabs">
      <button class="tab-btn active" data-tab="monitor" onclick="switchTab('monitor')">Live Monitor</button>
      <button class="tab-btn" data-tab="task" onclick="switchTab('task')">Task Detail (Spec / Build)</button>
      <button class="tab-btn" data-tab="projects" onclick="switchTab('projects')">Workspaces & Projects</button>
      <button class="tab-btn" data-tab="tables" onclick="switchTab('tables')">Raw DB Tables</button>
    </div>
    <div id="content">Loading...</div>
  </main>
  <script>
    let overview = [];
    let tableCounts = {};
    let selected = null;
    let activeTab = "monitor";
    let monitorLive = true;
    let monitorSource = "";
    let monitorStatus = "";
    let monitorQuery = "";
    let monitorStream = null;

    function esc(s) {
      return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
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
      const root = document.getElementById("taskList");
      const items = [];

      for (const ws of overview) {
        if (wsFilter && ws.workspace.slug !== wsFilter) continue;
        for (const t of ws.tasks) {
          if (statusFilter && t.status !== statusFilter) continue;
          const linked = (t.linked_projects || []).map(lp => lp.slug);
          if (projFilter && t.project_slug !== projFilter && !linked.includes(projFilter)) continue;
          const active = selected && selected.ws === ws.workspace.slug && selected.slug === t.slug ? "active" : "";
          const badges = (t.project_sync_matrix || []).map(ps =>
            '<span class="badge sync">' + esc(ps.project_slug) + ': ' + esc(ps.synced_status) + '</span>'
          ).join(" ");

          items.push(
            '<div class="task-item ' + active + '" onclick="selectTask(\\'' + esc(ws.workspace.slug) + '\\',\\'' + esc(t.slug) + '\\')">' +
              '<div class="task-title">' + esc(t.slug) + ' — ' + esc(t.title) + '</div>' +
              '<div class="task-meta">' +
                '<span class="badge ' + esc(t.status) + '">' + esc(t.status) + '</span>' +
                badges +
                '<span>' + esc(ws.workspace.slug) + ' • ' + t.commits_count + ' commits</span>' +
              '</div>' +
            '</div>'
          );
        }
      }
      root.innerHTML = items.length ? items.join("") : '<div class="empty">No tasks match filter.</div>';
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

    function formatTime(iso) {
      if (!iso) return "—";
      const d = new Date(iso);
      return isNaN(d.getTime()) ? esc(iso) : d.toLocaleTimeString([], { hour12: false }) + " (" + d.toISOString().slice(0, 10) + ")";
    }

    function renderLogRow(l) {
      let files = [];
      try { files = JSON.parse(l.files_changed || "[]"); } catch {}
      const commitBadge = l.commit_hash
        ? '<code title="' + esc(l.commit_hash) + '" style="color:#fbbf24;border:1px solid #78350f;">' + esc(l.commit_hash.slice(0, 7)) + '</code> '
        : '';
      const filesHtml = files.length
        ? '<div class="sub" style="margin-top:3px;">Files (' + files.length + '): ' + files.slice(0, 6).map(f => '<code>' + esc(f) + '</code>').join(" ") + (files.length > 6 ? ' +' + (files.length - 6) + ' more' : '') + '</div>'
        : '';
      const statusCls = l.status === "success" ? "closed" : (l.status === "error" ? "blocked" : (l.status === "running" ? "in_progress" : "open"));
      const scope = [l.workspace_slug, l.project_slug, l.task_slug].filter(Boolean).join(" / ") || "global";
      const detailsHtml = l.details_json
        ? '<details><summary>Details</summary><pre>' + esc(JSON.stringify(JSON.parse(l.details_json), null, 2)) + '</pre></details>'
        : '';
      return '<tr>' +
        '<td style="white-space:nowrap;"><code>' + esc(formatTime(l.ts)) + '</code></td>' +
        '<td><span class="badge sync">' + esc(l.source) + '</span>' + (l.stage ? ' <span class="badge">' + esc(l.stage) + '</span>' : '') + '</td>' +
        '<td><span class="badge ' + statusCls + '">' + esc(l.status) + '</span></td>' +
        '<td><div style="font-size:11px;color:var(--muted);">' + esc(scope) + '</div><code>' + esc(l.action) + '</code>' + (l.duration_ms != null ? ' <span class="sub">' + l.duration_ms + 'ms</span>' : '') + '</td>' +
        '<td>' + commitBadge + esc(l.summary) + filesHtml + '</td>' +
        '<td>' + detailsHtml + '</td>' +
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
          '<h2>Live Activity Monitor' +
            '<span style="display:flex;gap:6px;align-items:center;">' +
              '<button onclick="toggleLiveMonitor()">' + (monitorLive ? 'LIVE (SSE): ON' : 'PAUSED') + '</button>' +
              '<button onclick="renderMonitorTab()">Reload</button>' +
            '</span>' +
          '</h2>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
            '<select id="monSrc" onchange="monitorSource=this.value;renderMonitorTab()">' +
              '<option value="">All sources</option>' +
              ['git', 'playwright', 'agent', 'pg', 'redis', 'handoff'].map(s => '<option value="' + s + '"' + (monitorSource === s ? ' selected' : '') + '>' + s + '</option>').join("") +
            '</select>' +
            '<select id="monStat" onchange="monitorStatus=this.value;renderMonitorTab()">' +
              '<option value="">All statuses</option>' +
              ['running', 'success', 'error', 'info'].map(s => '<option value="' + s + '"' + (monitorStatus === s ? ' selected' : '') + '>' + s + '</option>').join("") +
            '</select>' +
            '<input id="monSearch" value="' + esc(monitorQuery) + '" placeholder="Search commit, file, action, summary..." style="flex:1;min-width:200px;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;" onkeydown="if(event.key===\\'Enter\\'){monitorQuery=this.value;renderMonitorTab();}" />' +
            '<button onclick="monitorQuery=document.getElementById(\\'monSearch\\').value;renderMonitorTab()">Filter</button>' +
          '</div>' +
          (logs.length
            ? '<div style="overflow-x:auto;"><table><thead><tr><th>Time</th><th>Source</th><th>Status</th><th>Scope / Action</th><th>Summary / Commit / Files</th><th>Details</th></tr></thead><tbody id="monitorBody">' +
                logs.map(renderLogRow).join("") +
              '</tbody></table></div>'
            : '<div class="empty">No activity logs recorded yet. MCP tool calls, commits, and Playwright runs appear here automatically.</div>') +
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

    async function renderTaskDetail() {
      const root = document.getElementById("content");
      if (!selected) {
        root.innerHTML = '<div class="card"><div class="empty">No task selected. Run /spec or /handoff-sync to populate handoff.sqlite.</div></div>';
        return;
      }
      const res = await fetch('/viewer/api/task?workspace=' + encodeURIComponent(selected.ws) + '&task=' + encodeURIComponent(selected.slug));
      const d = await res.json();
      const t = d.task;
      const spec = d.spec;
      const h = d.handoff;
      const events = d.events || [];
      const verifyEvents = events.filter(e => e.type === "test_passed" || e.type === "test_blocked");

      const stage1Html = spec
        ? '<p><strong>Objective:</strong> ' + esc(spec.objective) + '</p>' +
          '<div class="kv-grid">' +
            '<div class="kv-item"><div class="kv-label">Affected Projects</div>' + esc((spec.affected_projects || []).join(", ") || "—") + '</div>' +
            '<div class="kv-item"><div class="kv-label">Out of Scope</div>' + esc((spec.out_of_scope || []).join(", ") || "—") + '</div>' +
            '<div class="kv-item"><div class="kv-label">Deploy Order</div>' + esc((spec.deploy_order || d.workspace.deploy_order || []).join(" -> ") || "—") + '</div>' +
            '<div class="kv-item"><div class="kv-label">Target Branch</div><code>' + esc(t.target_branch || "—") + '</code></div>' +
          '</div>' +
          (spec.acceptance_criteria?.length ? '<strong>Acceptance Criteria</strong><ul>' + spec.acceptance_criteria.map(a => '<li>' + esc(a) + '</li>').join("") + '</ul>' : '') +
          (spec.verify_commands?.length ? '<div><strong>Verify Commands:</strong> ' + spec.verify_commands.map(c => '<code>' + esc(c) + '</code>').join(" ") + '</div>' : '') +
          (spec.e2e_checks?.length ? '<div style="margin-top:4px;"><strong>Playwright / E2E Checks:</strong> ' + spec.e2e_checks.map(c => '<code>' + esc(c) + '</code>').join(" ") + '</div>' : '')
        : '<div class="empty">Spec not confirmed yet (run /spec).</div>';

      const verifyHtml = verifyEvents.length
        ? '<table><thead><tr><th>Time</th><th>Status</th><th>Type</th><th>Summary</th></tr></thead><tbody>' +
            verifyEvents.map(v => {
              const p = v.payload || {};
              return '<tr><td><code>' + esc(v.ts) + '</code></td><td><span class="badge ' + (v.type === "test_passed" ? "closed" : "blocked") + '">' + esc(v.type) + '</span></td><td><code>' + esc(p.verify_type || "—") + '</code></td><td>' + esc(v.summary) + '</td></tr>';
            }).join("") +
          '</tbody></table>'
        : '<div class="empty">No verification events recorded yet.</div>';

      const handoffHtml = h
        ? '<p style="margin-top:10px;"><strong>Final Business Logic:</strong> ' + esc(h.final_business_logic) + '</p>' +
          (h.workspace_manifest_path ? '<div><strong>Workspace Manifest:</strong> <code>' + esc(h.workspace_manifest_path) + '</code> (' + esc((h.affected_projects || []).join(", ")) + ')</div>' : '') +
          (h.technical_flow?.length ? '<strong>Technical Flow</strong><ul>' + h.technical_flow.map(s => '<li>' + esc(s) + '</li>').join("") + '</ul>' : '') +
          (h.important_references?.length ? '<strong>Important References</strong><ul>' + h.important_references.map(r => '<li><code>' + esc(r.symbol) + '</code> — <code>' + esc(r.file) + '</code>' + (r.notes ? ' (' + esc(r.notes) + ')' : '') + '</li>').join("") + '</ul>' : '') +
          (h.next_ai_instructions?.length ? '<strong>Next AI Instructions</strong><ul>' + h.next_ai_instructions.map(s => '<li>' + esc(s) + '</li>').join("") + '</ul>' : '')
        : '<div class="empty" style="margin-top:8px;">No handoff snapshot saved yet (saved at end of /build).</div>';

      const projectMatrices = (d.per_project_history || []).map(ph => {
        const boxes = ["local", "develop", "staging", "main"].map(env => {
          const dep = ph.deploy_matrix?.[env];
          const cls = dep ? (dep.status === "success" ? "ok" : "fail") : "";
          return '<div class="env-box ' + cls + '"><div class="env-name">' + esc(env) + '</div>' +
            (dep ? '<div><strong>' + esc(dep.status) + '</strong></div><div class="sub">' + esc(dep.deployed_by) + ' @ ' + esc(dep.deployed_at) + '</div>' : '<div class="empty">not deployed</div>') +
          '</div>';
        }).join("");
        const commitRows = (ph.commits || []).map(c =>
          '<tr><td><code>' + esc(c.commit_hash.slice(0, 7)) + '</code></td><td><code>' + esc(c.branch) + '</code></td><td>' + esc(c.subject) + '</td><td>' + esc(c.committed_at) + '</td></tr>'
        ).join("");
        return '<div class="card"><h2>Project: ' + esc(ph.project.slug) + (ph.project.role ? ' (' + esc(ph.project.role) + ')' : '') + '<span>' + (ph.commits || []).length + ' commits</span></h2>' +
          '<div class="matrix">' + boxes + '</div>' +
          (commitRows ? '<table><thead><tr><th>SHA</th><th>Branch</th><th>Subject</th><th>Time</th></tr></thead><tbody>' + commitRows + '</tbody></table>' : '<div class="empty">No commits recorded for this project.</div>') +
        '</div>';
      }).join("");

      const eventsHtml = events.length
        ? '<table><thead><tr><th>Time</th><th>Type</th><th>Summary</th><th>Payload</th></tr></thead><tbody>' +
            events.map(e => '<tr><td><code>' + esc(e.ts) + '</code></td><td><span class="badge">' + esc(e.type) + '</span></td><td>' + esc(e.summary) + '</td><td><details><summary>JSON</summary><pre>' + esc(JSON.stringify(e.payload, null, 2)) + '</pre></details></td></tr>').join("") +
          '</tbody></table>'
        : '<div class="empty">No events yet.</div>';

      root.innerHTML =
        '<div class="card"><h2>' + esc(t.slug) + ' — ' + esc(t.title) + '<span class="badge ' + esc(t.status) + '">' + esc(t.status) + '</span></h2>' +
          '<div class="kv-grid">' +
            '<div class="kv-item"><div class="kv-label">Workspace</div>' + esc(d.workspace.slug) + (d.workspace.manifest_path ? ' (<code>' + esc(d.workspace.manifest_path) + '</code>)' : '') + '</div>' +
            '<div class="kv-item"><div class="kv-label">Linked Projects</div>' + esc((d.linked_projects || []).map(lp => lp.slug + (lp.role ? '[' + lp.role + ']' : '')).join(", ")) + '</div>' +
            '<div class="kv-item"><div class="kv-label">Fix Attempts</div>' + esc(t.fix_attempts) + ' / 3</div>' +
            '<div class="kv-item"><div class="kv-label">Base / Target Branch</div><code>' + esc(t.base_branch || "—") + '</code> -> <code>' + esc(t.target_branch || "—") + '</code></div>' +
          '</div>' +
        '</div>' +
        '<div class="card"><h2>Stage 1 — /spec</h2>' + stage1Html + '</div>' +
        '<div class="card"><h2>Stage 2 — /build (Verify & Handoff)</h2>' + verifyHtml + handoffHtml + '</div>' +
        projectMatrices +
        '<div class="card"><h2>Event Timeline (' + events.length + ')</h2>' + eventsHtml + '</div>';
    }

    function renderProjectsTab() {
      const root = document.getElementById("content");
      root.innerHTML = overview.map(w =>
        '<div class="card"><h2>Workspace: ' + esc(w.workspace.slug) + ' (' + esc(w.workspace.name) + ')<span>' + w.projects.length + ' projects</span></h2>' +
          '<div class="kv-grid">' +
            '<div class="kv-item"><div class="kv-label">Manifest Path</div><code>' + esc(w.workspace.manifest_path || "—") + '</code></div>' +
            '<div class="kv-item"><div class="kv-label">Deploy Order</div>' + esc((w.workspace.deploy_order || []).join(" -> ") || "—") + '</div>' +
          '</div>' +
          '<table><thead><tr><th>Slug</th><th>Role</th><th>Repo Path</th><th>Default Branch</th></tr></thead><tbody>' +
            w.projects.map(p => '<tr><td><code>' + esc(p.slug) + '</code></td><td>' + esc(p.role || "—") + '</td><td><code>' + esc(p.repo_path || "—") + '</code></td><td><code>' + esc(p.default_branch || "—") + '</code></td></tr>').join("") +
          '</tbody></table>' +
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
        '<button onclick="renderTablesTab(\\'' + esc(t) + '\\')" style="' + (t === tableName ? 'border-color:var(--accent);' : '') + '">' + esc(t) + ' (' + tableCounts[t] + ')</button>'
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

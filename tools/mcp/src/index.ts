import { config } from "dotenv";
import express from "express";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBacklogServer, type BacklogConfig } from "./modules/backlog/index.js";
import {
  closeDatabase,
  createHandoffServer,
  HandoffStore,
  openDatabase,
  registerHandoffViewer,
  resolveDatabasePath,
} from "./modules/handoff/index.js";
import { createPgServer, PgRegistry } from "./modules/pg/index.js";
import { createRedisServer, RedisRegistry } from "./modules/redis/index.js";
import { registerMcpEndpoint, type ToolCallLogEvent } from "./shared/http-transport.js";

config();

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["", "0", "false", "no", "off"].includes(normalized)) return false;
  console.error(
    `[Config] Unrecognized boolean value ${JSON.stringify(value)}; using default=${defaultValue}`,
  );
  return defaultValue;
}

const PORT = parseInt(process.env.PORT || "3030", 10);
const PG_URL = process.env.PG_URL || process.env.POSTGRES_URL;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const pgEnabled = parseBool(
  process.env.MCP_PG_ENABLED ?? process.env.MCP_POSTGRES_ENABLED,
  false,
);
const redisEnabled = parseBool(process.env.MCP_REDIS_ENABLED, false);
const handoffEnabled = parseBool(process.env.MCP_HANDOFF_ENABLED, true);
const backlogEnabled = parseBool(process.env.MCP_BACKLOG_ENABLED, false);

if (!pgEnabled && !redisEnabled && !handoffEnabled && !backlogEnabled) {
  console.error(
    "Error: no MCP service enabled. Set at least one of MCP_PG_ENABLED, MCP_REDIS_ENABLED, MCP_HANDOFF_ENABLED, MCP_BACKLOG_ENABLED to true in .env.",
  );
  process.exit(1);
}

if (pgEnabled && !PG_URL) {
  console.error("Error: PG_URL is required when MCP_PG_ENABLED=true");
  process.exit(1);
}

if (backlogEnabled && (!process.env.BACKLOG_DOMAIN || !process.env.BACKLOG_API_KEY)) {
  console.error("Error: BACKLOG_DOMAIN and BACKLOG_API_KEY are required when MCP_BACKLOG_ENABLED=true");
  process.exit(1);
}

const backlogConfig: BacklogConfig | null = backlogEnabled
  ? {
      domain: process.env.BACKLOG_DOMAIN!,
      apiKey: process.env.BACKLOG_API_KEY!,
      useFields: parseBool(process.env.BACKLOG_OPTIMIZE_RESPONSE, false),
      maxTokens: parseInt(process.env.BACKLOG_MAX_TOKENS || "50000", 10),
      prefix: process.env.BACKLOG_PREFIX || "",
      enabledToolsets: (process.env.BACKLOG_TOOLSETS || "all")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }
  : null;

const pgRegistry = pgEnabled ? new PgRegistry(PG_URL!) : null;
const redisRegistry = redisEnabled
  ? new RedisRegistry({
      url: REDIS_URL,
      reconnectStrategy: (retries) => {
        if (retries >= 5) {
          console.error(`[Redis Error] Max retries reached. Connection: ${REDIS_URL}`);
          return new Error("Max retries reached");
        }
        const delay = Math.min(Math.pow(2, retries) * 1000, 30000);
        console.error(`[Redis Retry] Attempt ${retries + 1}/5 failed, next in ${delay}ms`);
        return delay;
      },
    })
  : null;

const handoffDbPath = handoffEnabled ? resolveDatabasePath() : null;
const handoffDb = handoffDbPath ? openDatabase(handoffDbPath) : null;
const handoffStore = handoffDb ? new HandoffStore(handoffDb) : null;

const pgTransports = new Map<string, StreamableHTTPServerTransport>();
const redisTransports = new Map<string, StreamableHTTPServerTransport>();
const handoffTransports = new Map<string, StreamableHTTPServerTransport>();
const backlogTransports = new Map<string, StreamableHTTPServerTransport>();

const app = express();
app.use(localhostHostValidation());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    port: PORT,
    modules: {
      pg: Boolean(pgRegistry),
      redis: Boolean(redisRegistry),
      handoff: Boolean(handoffStore),
      backlog: Boolean(backlogConfig),
    },
  });
});

const logToolCall = handoffStore
  ? (ev: ToolCallLogEvent) => {
      if (ev.toolName === "handoff_log_activity" || ev.toolName === "handoff_record_commit") {
        return;
      }
      const args = ev.args ?? {};
      const ws = typeof args.workspace_slug === "string" ? args.workspace_slug : undefined;
      const proj = typeof args.project_slug === "string" ? args.project_slug : undefined;
      const task = typeof args.task_slug === "string" ? args.task_slug : undefined;
      const commitHash = typeof args.commit_hash === "string" ? args.commit_hash : undefined;
      const filesChanged = Array.isArray(args.files_changed)
        ? args.files_changed.filter((x): x is string => typeof x === "string")
        : undefined;
      handoffStore.logActivity({
        workspace_slug: ws,
        project_slug: proj,
        task_slug: task,
        source: ev.source,
        action: ev.toolName,
        status: ev.status,
        duration_ms: ev.durationMs,
        commit_hash: commitHash,
        files_changed: filesChanged,
        summary: `${ev.source}.${ev.toolName} (${ev.durationMs}ms)`,
        details: args,
      });
    }
  : undefined;

if (pgRegistry) {
  registerMcpEndpoint(app, "/pg", pgTransports, () => createPgServer(pgRegistry), {
    onToolCall: logToolCall,
  });
}
if (redisRegistry) {
  registerMcpEndpoint(
    app,
    "/redis",
    redisTransports,
    () => createRedisServer(redisRegistry),
    { onToolCall: logToolCall },
  );
}
if (handoffStore && handoffDb && handoffDbPath) {
  registerMcpEndpoint(
    app,
    "/handoff",
    handoffTransports,
    () => createHandoffServer(handoffStore),
    { onToolCall: logToolCall },
  );
  registerHandoffViewer(app, handoffDb, handoffStore, handoffDbPath);
}
if (backlogConfig) {
  registerMcpEndpoint(
    app,
    "/backlog",
    backlogTransports,
    () => createBacklogServer(backlogConfig),
    { onToolCall: logToolCall },
  );
}

async function start() {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.error(`[MCP Server] Listening on http://0.0.0.0:${PORT}`);
    console.error(`  HEALTH:  http://localhost:${PORT}/health`);
    if (pgEnabled) console.error(`  PG:      http://localhost:${PORT}/pg`);
    if (redisEnabled) console.error(`  REDIS:   http://localhost:${PORT}/redis`);
    if (handoffEnabled) {
      console.error(`  HANDOFF: http://localhost:${PORT}/handoff`);
      console.error(`  VIEWER:  http://localhost:${PORT}/viewer`);
    }
    if (backlogEnabled) console.error(`  BACKLOG: http://localhost:${PORT}/backlog`);
  });

  if (pgRegistry) {
    pgRegistry
      .discover()
      .then(() => {
        console.error(
          `[PG] Ready; databases=${JSON.stringify(pgRegistry.list().map((d) => d.name))} default=${pgRegistry.getDefault()}`,
        );
      })
      .catch((err) => {
        console.error(`[PG] Initial discover warning: ${(err as Error).message}`);
      });
  } else {
    console.error("[PG] Disabled (MCP_PG_ENABLED is not true)");
  }

  if (redisRegistry) {
    redisRegistry
      .discover()
      .then(() => {
        console.error(
          `[Redis] Connected to ${REDIS_URL}; databases=${redisRegistry.list().length}`,
        );
      })
      .catch((err) => {
        console.error(`[Redis] Initial discover warning: ${(err as Error).message}`);
      });
  } else {
    console.error("[Redis] Disabled (MCP_REDIS_ENABLED is not true)");
  }

  if (handoffEnabled) {
    console.error(`[Handoff] Ready; db=${handoffDbPath}`);
  } else {
    console.error("[Handoff] Disabled (MCP_HANDOFF_ENABLED is not true)");
  }

  async function shutdown() {
    console.error("\n[Shutdown] Closing...");
    const cleanup = Promise.all([
      ...Array.from(pgTransports.values()).map((t) => t.close().catch(() => {})),
      ...Array.from(redisTransports.values()).map((t) => t.close().catch(() => {})),
      ...Array.from(handoffTransports.values()).map((t) => t.close().catch(() => {})),
      ...Array.from(backlogTransports.values()).map((t) => t.close().catch(() => {})),
      pgRegistry ? pgRegistry.shutdown().catch(() => {}) : Promise.resolve(),
      redisRegistry ? redisRegistry.shutdown().catch(() => {}) : Promise.resolve(),
    ]);
    await Promise.race([cleanup, new Promise((r) => setTimeout(r, 1500))]);
    if (handoffDb) closeDatabase(handoffDb);
    server.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("[Fatal] Server startup failed:", err);
  process.exit(1);
});

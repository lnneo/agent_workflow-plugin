import crypto from "node:crypto";
import type { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

export type ExpressApp = ReturnType<typeof createMcpExpressApp>;

export type ToolCallLogEvent = {
  source: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "success" | "error";
  durationMs: number;
};

export type McpEndpointOptions = {
  onToolCall?: (event: ToolCallLogEvent) => void;
};

export function registerMcpEndpoint(
  app: ExpressApp,
  path: string,
  transports: Map<string, StreamableHTTPServerTransport>,
  createServer: () => McpServer,
  options: McpEndpointOptions = {},
): void {
  const endpointTag = path.replace(/^\//, "") || "mcp";

  app.post(path, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const server = createServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
          console.error(`[MCP][${endpointTag}] session_initialized sessionId=${id}`);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
          console.error(`[MCP][${endpointTag}] session_closed sessionId=${id}`);
        },
      });
      await server.connect(transport);
    } else {
      res.status(400).json({ error: "Invalid request: missing session or initialize" });
      return;
    }

    const rpcBody = req.body as
      | { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
      | undefined;
    const isToolCall = rpcBody?.method === "tools/call" && typeof rpcBody?.params?.name === "string";
    const startMs = isToolCall ? Date.now() : 0;

    if (isToolCall && options.onToolCall) {
      const toolName = rpcBody.params!.name!;
      const args = rpcBody.params?.arguments ?? {};
      res.on("finish", () => {
        options.onToolCall?.({
          source: endpointTag,
          toolName,
          args,
          status: res.statusCode >= 400 ? "error" : "success",
          durationMs: Date.now() - startMs,
        });
      });
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get(path, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  app.delete(path, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });
}

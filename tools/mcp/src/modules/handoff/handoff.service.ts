import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HandoffStore } from "./store.js";
import { registerTools } from "./tools.js";

export function createHandoffServer(store: HandoffStore): McpServer {
  const server = new McpServer({
    name: "handoff",
    version: "1.0.0",
  });
  registerTools(server, store);
  return server;
}

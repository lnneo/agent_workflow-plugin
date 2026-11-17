import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  allTools,
  backlogErrorHandler,
  composeNativeContentToolHandler,
  composeToolHandler,
  createBacklogClient,
  createDescriptionHelper,
  toolAnnotationsFor,
} from "backlog-mcp-server";

export type BacklogConfig = {
  domain: string;
  apiKey: string;
  useFields?: boolean;
  maxTokens?: number;
  prefix?: string;
  enabledToolsets?: string[];
};

export function createBacklogServer(cfg: BacklogConfig): McpServer {
  const server = new McpServer(
    { name: "backlog", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const backlog = createBacklogClient({
    host: cfg.domain,
    apiKey: cfg.apiKey,
  });
  const descriptionHelper = createDescriptionHelper();
  const group = allTools(backlog, descriptionHelper);

  const useFields = cfg.useFields ?? false;
  const maxTokens = cfg.maxTokens ?? 50000;
  const prefix = cfg.prefix ?? "";
  const enabledSet = new Set(cfg.enabledToolsets ?? ["all"]);
  const enableAll = enabledSet.has("all");

  for (const toolset of group.toolsets) {
    if (!enableAll && !enabledSet.has(toolset.name)) {
      continue;
    }

    for (const tool of toolset.tools) {
      const { schema, handler } = composeToolHandler(tool, {
        useFields,
        errorHandler: backlogErrorHandler,
        maxTokens,
        useOrganization: false,
      });
      server.registerTool(
        `${prefix}${tool.name}`,
        {
          description: tool.description,
          inputSchema: schema as unknown as Record<string, never>,
          annotations: toolAnnotationsFor(tool.name),
        },
        handler as unknown as () => never,
      );
    }

    for (const tool of toolset.nativeContentTools ?? []) {
      const { schema, handler } = composeNativeContentToolHandler(tool, {
        errorHandler: backlogErrorHandler,
        useOrganization: false,
      });
      server.registerTool(
        `${prefix}${tool.name}`,
        {
          description: tool.description,
          inputSchema: schema as unknown as Record<string, never>,
          annotations: toolAnnotationsFor(tool.name),
        },
        handler as unknown as () => never,
      );
    }
  }

  return server;
}

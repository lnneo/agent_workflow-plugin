import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PgRegistry } from "./pg.registry.js";

const SCHEMA_PATH = "schema";

export function createPgServer(registry: PgRegistry): McpServer {
  const server = new McpServer(
    { name: "pg", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );

  const databases = registry.list();
  const defaultDb = registry.getDefault();
  const availableList = databases.map((d) => (d.isDefault ? `${d.name} (default)` : d.name)).join(", ");
  const resourceBaseUrl = registry.buildResourceBaseUrl();

  const tableSchemaTemplate = new ResourceTemplate(
    `${resourceBaseUrl.href}{database}/{table}/${SCHEMA_PATH}`,
    {
      list: async () => {
        const resources: { uri: string; name: string }[] = [];
        for (const info of registry.list()) {
          try {
            const pool = await registry.getPool(info.name);
            const client = await pool.connect();
            try {
              const result = await client.query<{ table_name: string }>(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
              );
              for (const row of result.rows) {
                resources.push({
                  uri: new URL(
                    `${encodeURIComponent(info.name)}/${encodeURIComponent(row.table_name)}/${SCHEMA_PATH}`,
                    resourceBaseUrl,
                  ).href,
                  name: `"${info.name}"."${row.table_name}" database schema`,
                });
              }
            } finally {
              client.release();
            }
          } catch (error) {
            console.error(
              `[PG][schema list] failed for database=${info.name}: ${(error as Error).message}`,
            );
          }
        }
        return { resources };
      },
    },
  );

  server.registerResource(
    "table-schema",
    tableSchemaTemplate,
    { mimeType: "application/json" },
    async (uri, variables) => {
      const databaseName = Array.isArray(variables.database) ? variables.database[0] : variables.database;
      const tableName = Array.isArray(variables.table) ? variables.table[0] : variables.table;
      if (databaseName && !registry.has(databaseName)) {
        await registry.refresh();
      }
      if (!databaseName || !registry.has(databaseName)) {
        throw new Error(
          `Unknown database ${JSON.stringify(databaseName)}. Available: ${registry.list().map((d) => d.name).join(", ")}`,
        );
      }
      const pool = await registry.getPool(databaseName);
      const client = await pool.connect();
      try {
        const result = await client.query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1",
          [tableName],
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(result.rows, null, 2),
            },
          ],
        };
      } finally {
        client.release();
      }
    },
  );

  server.registerTool(
    "query",
    {
      description:
        `Primary tool for all PostgreSQL operations (read and write: SELECT, INSERT, UPDATE, DELETE, DDL). Prefer over psql or bash. ` +
        `You MUST pass the target 'database' on every call. Available databases: ${availableList}. Default: ${defaultDb}.`,
      inputSchema: {
        database: z
          .string()
          .min(1)
          .describe(`Target database name. Available: ${availableList}. Default: ${defaultDb}.`),
        sql: z.string().min(1).describe("SQL statement to execute (read or write)."),
      },
    },
    async ({ database, sql }) => {
      if (!registry.has(database)) {
        await registry.refresh();
      }
      if (!registry.has(database)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: unknown database ${JSON.stringify(database)}. Available: ${registry.list().map((d) => d.name).join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      const pool = await registry.getPool(database);
      const client = await pool.connect();
      try {
        const result = await client.query(sql);
        const payload =
          result.rows && result.rows.length > 0
            ? result.rows
            : { command: result.command, rowCount: result.rowCount };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      } finally {
        client.release();
      }
    },
  );

  server.registerTool(
    "list_databases",
    {
      description:
        "List all databases available on this Postgres server. Re-discovered on every call so newly created databases appear immediately. Use the returned name as the 'database' argument for the 'query' tool.",
      inputSchema: {},
    },
    async () => {
      await registry.refresh();
      const rows = registry.list().map((d) => ({ name: d.name, isDefault: d.isDefault }));
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    },
  );

  return server;
}

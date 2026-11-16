import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RedisRegistry } from "./redis.registry.js";

export function createRedisServer(registry: RedisRegistry): McpServer {
  const server = new McpServer(
    { name: "redis", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  const dbs = registry.list();
  const availableList = dbs.map((d) => `${d.db} (${d.keys} keys)`).join(", ");
  const dbNote = `You MUST pass 'database' (Redis DB index) on every call. Available: ${availableList}.`;

  const databaseField = () =>
    z
      .number()
      .int()
      .min(0)
      .describe(`Redis DB index to target. Available: ${availableList}.`);

  type RedisClient = Awaited<ReturnType<typeof registry.getClient>>;
  type Resolved =
    | { ok: false; error: string }
    | { ok: true; client: RedisClient };

  async function resolveClient(database: number): Promise<Resolved> {
    if (!registry.has(database)) {
      await registry.refresh();
    }
    if (!registry.has(database)) {
      const available = registry.list().map((d) => d.db).join(", ");
      return { ok: false, error: `Error: unknown Redis DB ${database}. Available: ${available}` };
    }
    const client = await registry.getClient(database);
    return { ok: true, client };
  }

  server.registerTool(
    "set",
    {
      description: `Primary tool to write Redis key-value pairs. Prefer over redis-cli. ${dbNote}`,
      inputSchema: {
        database: databaseField(),
        key: z.string().describe("Redis key"),
        value: z.string().describe("Value to store"),
        expireSeconds: z.number().optional().describe("Optional expiration time in seconds"),
      },
    },
    async ({ database, key, value, expireSeconds }) => {
      const resolved = await resolveClient(database);
      if (!resolved.ok) {
        return { content: [{ type: "text", text: resolved.error }], isError: true };
      }
      const { client } = resolved;
      if (expireSeconds) {
        await client.setEx(key, expireSeconds, value);
      } else {
        await client.set(key, value);
      }
      return {
        content: [{ type: "text", text: `Successfully set key on db ${database}: ${key}` }],
      };
    },
  );

  server.registerTool(
    "get",
    {
      description: `Primary tool to read Redis values. Prefer over redis-cli. ${dbNote}`,
      inputSchema: {
        database: databaseField(),
        key: z.string().describe("Redis key to retrieve"),
      },
    },
    async ({ database, key }) => {
      const resolved = await resolveClient(database);
      if (!resolved.ok) {
        return { content: [{ type: "text", text: resolved.error }], isError: true };
      }
      const value = await resolved.client.get(key);
      if (value === null) {
        return {
          content: [{ type: "text", text: `Key not found on db ${database}: ${key}` }],
        };
      }
      return {
        content: [{ type: "text", text: value }],
      };
    },
  );

  server.registerTool(
    "delete",
    {
      description: `Primary tool to delete Redis keys. Prefer over redis-cli. ${dbNote}`,
      inputSchema: {
        database: databaseField(),
        key: z
          .string()
          .describe("Comma-separated keys to delete (single key or comma-separated for multiple)"),
      },
    },
    async ({ database, key }) => {
      const resolved = await resolveClient(database);
      if (!resolved.ok) {
        return { content: [{ type: "text", text: resolved.error }], isError: true };
      }
      const { client } = resolved;
      const keys = key
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
      if (keys.length === 1) {
        await client.del(keys[0]);
        return {
          content: [{ type: "text", text: `Successfully deleted key on db ${database}: ${keys[0]}` }],
        };
      }
      await client.del(keys);
      return {
        content: [{ type: "text", text: `Successfully deleted ${keys.length} keys on db ${database}` }],
      };
    },
  );

  server.registerTool(
    "list",
    {
      description: `List all keys matching a pattern. For large datasets use 'scan' instead. ${dbNote}`,
      inputSchema: {
        database: databaseField(),
        pattern: z.string().default("*").describe("Pattern to match keys (default: *)"),
      },
    },
    async ({ database, pattern }) => {
      const resolved = await resolveClient(database);
      if (!resolved.ok) {
        return { content: [{ type: "text", text: resolved.error }], isError: true };
      }
      const { client } = resolved;
      const keys: string[] = [];
      let cursor = "0";
      do {
        const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        keys.push(...result.keys);
      } while (cursor !== "0");

      return {
        content: [
          {
            type: "text",
            text:
              keys.length > 0
                ? `Found ${keys.length} keys on db ${database}:\n${keys.join("\n")}`
                : `No keys found matching pattern on db ${database}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "scan",
    {
      description: `Browse large Redis keyspaces by cursor. Returns keys with type and TTL. Prefer over redis-cli. ${dbNote}`,
      inputSchema: {
        database: databaseField(),
        cursor: z.string().default("0").describe("Cursor from previous scan, use '0' to start"),
        pattern: z.string().default("*").describe("Pattern to match keys (default: *)"),
        count: z.number().default(20).describe("Max keys per batch (default: 20)"),
      },
    },
    async ({ database, cursor, pattern, count }) => {
      const resolved = await resolveClient(database);
      if (!resolved.ok) {
        return { content: [{ type: "text", text: resolved.error }], isError: true };
      }
      const { client } = resolved;
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: count });

      if (result.keys.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                result.cursor === "0"
                  ? `No keys found on db ${database}`
                  : `End of scan on db ${database}. Next cursor: ${result.cursor}`,
            },
          ],
        };
      }

      const pipe = client.multi();
      for (const k of result.keys) {
        pipe.type(k);
        pipe.ttl(k);
      }
      const pipeResults = await pipe.exec();

      const items = result.keys.map((k, i) => {
        const type = pipeResults[i * 2] as unknown as string;
        const ttl = pipeResults[i * 2 + 1] as unknown as number;
        return {
          key: k,
          type,
          ttl: ttl === -1 ? "no expiry" : `${ttl}s`,
        };
      });

      const output = [
        `Database: ${database}`,
        `Cursor: ${result.cursor} (${result.cursor === "0" ? "done" : "call again with this cursor"})`,
        `Keys: ${result.keys.length}`,
        "",
        ...items.map((item) => `${item.key}  [${item.type}, TTL: ${item.ttl}]`),
      ];

      return {
        content: [{ type: "text", text: output.join("\n") }],
      };
    },
  );

  server.registerTool(
    "list_databases",
    {
      description:
        "List all Redis DB indexes available on this server. Re-discovered on every call so key counts and DB config changes are always current. Use the returned 'db' number as the 'database' argument for other tools.",
      inputSchema: {},
    },
    async () => {
      await registry.refresh();
      return {
        content: [{ type: "text", text: JSON.stringify(registry.list(), null, 2) }],
      };
    },
  );

  return server;
}

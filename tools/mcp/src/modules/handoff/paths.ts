import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** Default DB: package-local data/handoff.sqlite unless HANDOFF_MCP_DB overrides. */
export function resolveDatabasePath(): string {
  if (process.env.HANDOFF_MCP_DB) {
    return process.env.HANDOFF_MCP_DB;
  }
  return join(packageRoot, "data", "handoff.sqlite");
}

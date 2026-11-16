import pg from "pg";

export type PgDbInfo = {
  name: string;
  isDefault: boolean;
};

export class PgRegistry {
  private readonly baseUrl: URL;
  private readonly defaultDatabase: string;
  private databases: string[] = [];
  private readonly pools = new Map<string, Promise<pg.Pool>>();
  private inflightDiscover: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.baseUrl = new URL(connectionString);
    const pathDb = decodeURIComponent(this.baseUrl.pathname.replace(/^\//, ""));
    if (!pathDb) {
      throw new Error(
        "PG_URL must include a database name in the path (e.g. postgresql://user:pass@host:5432/mydb)",
      );
    }
    this.defaultDatabase = pathDb;
    this.databases = [pathDb];
  }

  async discover(): Promise<void> {
    const bootstrapPool = await this.getPool(this.defaultDatabase);
    const client = await bootstrapPool.connect();
    try {
      const result = await client.query<{ datname: string }>(
        "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname",
      );
      const names = result.rows.map((r) => r.datname);
      if (names.length > 0) {
        this.databases = names;
      }
      console.error(
        `[PG][discover] databases=${JSON.stringify(this.databases)} default=${JSON.stringify(this.defaultDatabase)}`,
      );
    } catch (error) {
      console.error(
        `[PG][discover] failed (${(error as Error).message}); falling back to default=${JSON.stringify(this.defaultDatabase)}`,
      );
      this.databases = [this.defaultDatabase];
    } finally {
      client.release();
    }
  }

  async refresh(): Promise<void> {
    if (this.inflightDiscover) {
      return this.inflightDiscover;
    }
    this.inflightDiscover = this.discover().finally(() => {
      this.inflightDiscover = null;
    });
    return this.inflightDiscover;
  }

  list(): PgDbInfo[] {
    return this.databases.map((name) => ({ name, isDefault: name === this.defaultDatabase }));
  }

  has(name: string): boolean {
    return this.databases.includes(name);
  }

  getDefault(): string {
    return this.defaultDatabase;
  }

  buildResourceBaseUrl(): URL {
    const url = new URL(this.baseUrl.href);
    url.protocol = "postgres:";
    url.password = "";
    url.pathname = "/";
    return url;
  }

  async getPool(name: string): Promise<pg.Pool> {
    const existing = this.pools.get(name);
    if (existing) return existing;

    const connectionString = this.buildConnectionString(name);
    const promise = Promise.resolve().then(() => {
      const pool = new pg.Pool({ connectionString });
      pool.on("error", (err) => {
        console.error(`[PG][pool:${name}] error: ${err.message}`);
      });
      return pool;
    });
    this.pools.set(name, promise);
    return promise;
  }

  private buildConnectionString(database: string): string {
    const url = new URL(this.baseUrl.href);
    url.pathname = `/${encodeURIComponent(database)}`;
    return url.href;
  }

  async shutdown(): Promise<void> {
    const pools = Array.from(this.pools.values());
    await Promise.all(
      pools.map(async (p) => {
        try {
          const pool = await p;
          await pool.end();
        } catch {
          // swallow shutdown errors
        }
      }),
    );
    this.pools.clear();
  }
}

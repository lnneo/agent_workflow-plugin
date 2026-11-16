import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;
type RedisClientOptionsArg = Parameters<typeof createClient>[0];

export type RedisDbInfo = {
  db: number;
  keys: number;
};

export type RedisRegistryOptions = {
  url: string;
  reconnectStrategy?: (retries: number) => number | Error;
};

export class RedisRegistry {
  private readonly url: string;
  private readonly reconnectStrategy?: (retries: number) => number | Error;
  private databases: RedisDbInfo[] = [{ db: 0, keys: 0 }];
  private readonly clients = new Map<number, Promise<RedisClient>>();
  private inflightDiscover: Promise<void> | null = null;

  constructor(options: RedisRegistryOptions) {
    this.url = options.url;
    this.reconnectStrategy = options.reconnectStrategy;
  }

  async discover(): Promise<void> {
    const probe = await this.getClient(0);
    let count = 16;
    try {
      const res = (await probe.sendCommand(["CONFIG", "GET", "databases"])) as unknown;
      if (Array.isArray(res) && res.length >= 2) {
        const parsed = Number(res[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
          count = parsed;
        }
      }
    } catch (error) {
      console.error(
        `[Redis][discover] CONFIG GET databases failed (${(error as Error).message}); assuming ${count}`,
      );
    }

    const keysPerDb = new Map<number, number>();
    try {
      const info = (await probe.info("keyspace")) as string;
      for (const line of info.split(/\r?\n/)) {
        const match = /^db(\d+):keys=(\d+)/.exec(line);
        if (match) {
          keysPerDb.set(Number(match[1]), Number(match[2]));
        }
      }
    } catch (error) {
      console.error(`[Redis][discover] INFO keyspace failed (${(error as Error).message})`);
    }

    const list: RedisDbInfo[] = [];
    for (let i = 0; i < count; i++) {
      list.push({ db: i, keys: keysPerDb.get(i) ?? 0 });
    }
    this.databases = list;
    console.error(
      `[Redis][discover] databases=${count} active=${JSON.stringify(Array.from(keysPerDb.entries()))}`,
    );
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

  list(): RedisDbInfo[] {
    return this.databases.slice();
  }

  has(db: number): boolean {
    return this.databases.some((entry) => entry.db === db);
  }

  async getClient(db: number): Promise<RedisClient> {
    const cached = this.clients.get(db);
    if (cached) return cached;

    const options: RedisClientOptionsArg = {
      url: this.url,
      database: db,
      socket: this.reconnectStrategy ? { reconnectStrategy: this.reconnectStrategy } : undefined,
    };

    const promise = (async () => {
      const client = createClient(options);
      client.on("error", (err: Error) => {
        console.error(`[Redis][client:${db}] ${err.name}: ${err.message}`);
      });
      await client.connect();
      console.error(`[Redis][client:${db}] connected`);
      return client;
    })();

    this.clients.set(db, promise);
    try {
      return await promise;
    } catch (error) {
      this.clients.delete(db);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    const clients = Array.from(this.clients.values());
    await Promise.all(
      clients.map(async (p) => {
        try {
          const client = await p;
          await client.quit();
        } catch {
          // swallow shutdown errors
        }
      }),
    );
    this.clients.clear();
  }
}

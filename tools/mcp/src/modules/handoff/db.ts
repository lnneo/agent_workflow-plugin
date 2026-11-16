import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import { SCHEMA_SQL } from "./schema.js";

export type SqliteDatabase = Database.Database;

const TASK_COLUMN_MIGRATIONS: Array<{ name: string; sql: string }> = [
  { name: "target_branch", sql: "ALTER TABLE tasks ADD COLUMN target_branch TEXT" },
  { name: "base_branch", sql: "ALTER TABLE tasks ADD COLUMN base_branch TEXT" },
  { name: "base_commit", sql: "ALTER TABLE tasks ADD COLUMN base_commit TEXT" },
  { name: "spec_json", sql: "ALTER TABLE tasks ADD COLUMN spec_json TEXT" },
  { name: "handoff_json", sql: "ALTER TABLE tasks ADD COLUMN handoff_json TEXT" },
  {
    name: "fix_attempts",
    sql: "ALTER TABLE tasks ADD COLUMN fix_attempts INTEGER NOT NULL DEFAULT 0"
  }
];

const WORKSPACE_COLUMN_MIGRATIONS: Array<{ name: string; sql: string }> = [
  { name: "manifest_path", sql: "ALTER TABLE workspaces ADD COLUMN manifest_path TEXT" },
  { name: "deploy_order_json", sql: "ALTER TABLE workspaces ADD COLUMN deploy_order_json TEXT" }
];

const PROJECT_COLUMN_MIGRATIONS: Array<{ name: string; sql: string }> = [
  { name: "role", sql: "ALTER TABLE projects ADD COLUMN role TEXT" }
];

function migrateTable(
  db: SqliteDatabase,
  table: string,
  migrations: Array<{ name: string; sql: string }>
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  const existing = new Set(columns.map((c) => c.name));
  for (const col of migrations) {
    if (!existing.has(col.name)) {
      db.exec(col.sql);
    }
  }
}

function runMigrations(db: SqliteDatabase): void {
  migrateTable(db, "tasks", TASK_COLUMN_MIGRATIONS);
  migrateTable(db, "workspaces", WORKSPACE_COLUMN_MIGRATIONS);
  migrateTable(db, "projects", PROJECT_COLUMN_MIGRATIONS);
}

export function openDatabase(databasePath: string): SqliteDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  return db;
}

export function closeDatabase(db: SqliteDatabase): void {
  db.close();
}

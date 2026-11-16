import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { HandoffStore } from "./store.js";

export interface ManifestProjectEntry {
  slug: string;
  name: string;
  role?: string;
  repo_path: string;
  default_branch?: string;
}

export interface ParsedWorkspaceManifest {
  manifest_path: string;
  base_dir: string;
  workspace_slug: string;
  workspace_name: string;
  deploy_order: string[];
  projects: ManifestProjectEntry[];
  raw_markdown: string;
  body_markdown: string;
}

const MANIFEST_CANDIDATE_REL_PATHS = [
  ".ai/workspace.md",
  "WORKSPACE.md"
] as const;

function stripQuotes(val: string): string {
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseInlineArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((s) => stripQuotes(s))
    .filter(Boolean);
}

function resolveBaseDir(manifestPath: string): string {
  const abs = realpathSync(manifestPath);
  const parent = dirname(abs);
  if (basename(parent) === ".ai") {
    return dirname(parent);
  }
  return parent;
}

function applyProjectField(
  proj: Partial<ManifestProjectEntry>,
  key: string,
  val: string
): void {
  if (key === "slug") proj.slug = val;
  else if (key === "name") proj.name = val;
  else if (key === "role") proj.role = val;
  else if (key === "repo_path" || key === "path") proj.repo_path = val;
  else if (key === "default_branch") proj.default_branch = val;
}

export function parseWorkspaceManifestFile(
  manifestPath: string
): ParsedWorkspaceManifest {
  const absPath = realpathSync(manifestPath);
  const raw = readFileSync(absPath, "utf8");
  const baseDir = resolveBaseDir(absPath);

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fmText = fmMatch?.[1] ?? "";
  const body = fmMatch ? (fmMatch[2] ?? "").trim() : raw.trim();

  let workspaceSlug = "";
  let workspaceName = "";
  const deployOrder: string[] = [];
  const projects: ManifestProjectEntry[] = [];

  let section: "root" | "deploy_order" | "projects" = "root";
  let currentProject: Partial<ManifestProjectEntry> | null = null;

  const flushProject = () => {
    if (currentProject && currentProject.slug && currentProject.repo_path) {
      const resolvedRepo = isAbsolute(currentProject.repo_path)
        ? currentProject.repo_path
        : resolve(baseDir, currentProject.repo_path);
      projects.push({
        slug: currentProject.slug,
        name: currentProject.name || currentProject.slug,
        role: currentProject.role,
        repo_path: existsSync(resolvedRepo)
          ? realpathSync(resolvedRepo)
          : resolvedRepo,
        default_branch: currentProject.default_branch
      });
    }
    currentProject = null;
  };

  for (const rawLine of fmText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = rawLine.length - rawLine.trimStart().length;

    if (indent === 0) {
      flushProject();
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();

      if (key === "workspace" || key === "workspace_slug") {
        section = "root";
        workspaceSlug = stripQuotes(val);
      } else if (key === "name" || key === "workspace_name") {
        section = "root";
        workspaceName = stripQuotes(val);
      } else if (key === "deploy_order") {
        if (val.startsWith("[")) {
          deployOrder.push(...parseInlineArray(val));
          section = "root";
        } else {
          section = "deploy_order";
        }
      } else if (key === "projects") {
        section = "projects";
      } else {
        section = "root";
      }
      continue;
    }

    if (section === "deploy_order" && trimmed.startsWith("-")) {
      const item = stripQuotes(trimmed.slice(1));
      if (item) deployOrder.push(item);
      continue;
    }

    if (section === "projects") {
      if (trimmed.startsWith("-")) {
        flushProject();
        currentProject = {};
        const rest = trimmed.slice(1).trim();
        if (rest.includes(":")) {
          const idx = rest.indexOf(":");
          const k = rest.slice(0, idx).trim();
          const v = stripQuotes(rest.slice(idx + 1));
          applyProjectField(currentProject, k, v);
        }
      } else if (currentProject && trimmed.includes(":")) {
        const idx = trimmed.indexOf(":");
        const k = trimmed.slice(0, idx).trim();
        const v = stripQuotes(trimmed.slice(idx + 1));
        applyProjectField(currentProject, k, v);
      }
    }
  }
  flushProject();

  if (!workspaceSlug) {
    workspaceSlug = basename(baseDir).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  }
  if (!workspaceName) {
    workspaceName = workspaceSlug;
  }

  return {
    manifest_path: absPath,
    base_dir: baseDir,
    workspace_slug: workspaceSlug,
    workspace_name: workspaceName,
    deploy_order: deployOrder,
    projects,
    raw_markdown: raw,
    body_markdown: body
  };
}

export function discoverWorkspaceManifest(
  searchPaths: string[],
  store?: HandoffStore,
  explicitManifestPath?: string
): ParsedWorkspaceManifest | null {
  if (explicitManifestPath && existsSync(explicitManifestPath)) {
    return parseWorkspaceManifestFile(explicitManifestPath);
  }

  if (store) {
    for (const p of searchPaths) {
      const ctx = store.findProjectAcrossWorkspaces(p);
      if (ctx?.workspace.manifest_path && existsSync(ctx.workspace.manifest_path)) {
        return parseWorkspaceManifestFile(ctx.workspace.manifest_path);
      }
    }
  }

  const checkedDirs = new Set<string>();
  for (const p of searchPaths) {
    let cur = existsSync(p) ? realpathSync(p) : resolve(p);
    for (let depth = 0; depth < 3; depth++) {
      if (!checkedDirs.has(cur)) {
        checkedDirs.add(cur);
        for (const rel of MANIFEST_CANDIDATE_REL_PATHS) {
          const candidate = join(cur, rel);
          if (existsSync(candidate)) {
            return parseWorkspaceManifestFile(candidate);
          }
        }
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  return null;
}

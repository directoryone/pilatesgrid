#!/usr/bin/env npx tsx
/**
 * Sync route stub files for the spawned directory from the platform's
 * published manifest. Runs after `pnpm update @directoryone/*` so that
 * any new platform routes get a stub here without manual intervention.
 *
 * Behavior:
 *   - Reads node_modules/@directoryone/app/src/route-manifest.json
 *   - For each entry, ensures src/app/<path> exists
 *   - If the file is missing, writes the standard re-export
 *   - If the file exists and matches our standard re-export pattern, no-op
 *   - If the file exists and looks customized (custom wrapper), leaves it
 *     alone — only the missing-file case is auto-healed
 *
 * Also merges the platform's cron manifest into vercel.json. Cron registration
 * has to happen HERE rather than in the prebuild (scripts/post-update.ts):
 * Vercel reads vercel.json when the deployment is CREATED, before the build
 * runs, and a prebuild's writes live in an ephemeral build checkout that is
 * never committed. This script runs inside platform-update.yml, which commits
 * and pushes whatever it changes, so a vercel.json edit here lands in the repo
 * and takes effect on the next deployment.
 *
 * The script is idempotent and safe to run on every update.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";

interface RouteEntry {
  path: string;
  from: string;
  exports?: string[];
  body?: string;
}

const REPO_ROOT = process.cwd();
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "node_modules/@directoryone/app/src/route-manifest.json"
);
const APP_DIR = path.join(REPO_ROOT, "src/app");
const CRON_MANIFEST_PATH = path.join(
  REPO_ROOT,
  "node_modules/@directoryone/app/dist/cron-manifest.json"
);
const VERCEL_JSON_PATH = path.join(REPO_ROOT, "vercel.json");

/**
 * Merge the platform's crons into vercel.json. Add-only: a cron the spawn
 * already lists keeps its own schedule, and a spawn-specific cron that isn't
 * in the manifest is never removed. Reading the list from the installed
 * package (rather than hardcoding it) is what lets a FUTURE platform cron
 * reach every spawn on its next update — but only once each spawn has this
 * version of the script, because scripts/sync-routes.ts is copied in at spawn
 * time and never refreshed. Spawns created before this existed need one direct
 * push of this file first.
 *
 * Never throws: a missing manifest or an unparseable vercel.json must not fail
 * the update run.
 */
function syncCrons(): void {
  try {
    if (!existsSync(CRON_MANIFEST_PATH)) {
      console.warn(
        `[sync-crons] manifest not found at ${CRON_MANIFEST_PATH} — skipping`
      );
      return;
    }
    const cronManifest: Array<{ path: string; schedule: string }> = JSON.parse(
      readFileSync(CRON_MANIFEST_PATH, "utf-8")
    );
    const vercel: {
      crons?: { path: string; schedule: string }[];
      [k: string]: unknown;
    } = existsSync(VERCEL_JSON_PATH)
      ? JSON.parse(readFileSync(VERCEL_JSON_PATH, "utf-8"))
      : { installCommand: "pnpm install --no-frozen-lockfile" };
    const crons = Array.isArray(vercel.crons) ? vercel.crons : [];
    const added: string[] = [];
    for (const entry of cronManifest) {
      if (!entry?.path || !entry?.schedule) continue;
      if (crons.some((c) => c.path === entry.path)) continue;
      crons.push({ path: entry.path, schedule: entry.schedule });
      added.push(entry.path);
    }
    if (added.length === 0) return;
    vercel.crons = crons;
    writeFileSync(VERCEL_JSON_PATH, JSON.stringify(vercel, null, 2) + "\n");
    console.log(`[sync-crons] registered ${added.length}: ${added.join(", ")}`);
  } catch (err) {
    console.warn("[sync-crons] could not sync vercel.json crons:", err);
  }
}

// Before the route-manifest check below, which exits the process when the
// manifest is missing.
syncCrons();

if (!existsSync(MANIFEST_PATH)) {
  console.warn(
    `[sync-routes] manifest not found at ${MANIFEST_PATH} — skipping`
  );
  process.exit(0);
}

const manifest: RouteEntry[] = JSON.parse(
  readFileSync(MANIFEST_PATH, "utf-8")
);

function buildStubContent(entry: RouteEntry): string {
  // Custom wrappers ship their full content in `body`. If the file exists
  // but drifted, looksLikeStandardStub() won't match a multi-line body, so
  // customized copies are left alone — bodies are create/exact-match only.
  if (entry.body) return entry.body;
  const exportList = (entry.exports ?? []).join(", ");
  const needsInit =
    entry.path.endsWith("route.ts") ||
    entry.path === "auth/callback/page.tsx";
  const initLine = needsInit ? `import "@/lib/init";\n` : "";
  return `${initLine}export { ${exportList} } from "${entry.from}";\n`;
}

/**
 * Heuristic: a file is a "standard stub" if it contains exactly the
 * import "@/lib/init" line (when applicable) plus a single re-export
 * from a "@directoryone/app/..." path. Whitespace is normalized before
 * comparison so trivial formatting differences don't trigger overwrites.
 */
function looksLikeStandardStub(content: string): boolean {
  const normalized = content.trim().replace(/\s+/g, " ");
  return /^(?:import\s+"@\/lib\/init";\s+)?export\s*\{[^}]*\}\s*from\s*"@directoryone\/app\/[^"]+";?$/.test(
    normalized
  );
}

let written = 0;
let skippedCustom = 0;
let unchanged = 0;

for (const entry of manifest) {
  const target = path.join(APP_DIR, entry.path);
  const dir = path.dirname(target);
  const desiredContent = buildStubContent(entry);

  if (!existsSync(target)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, desiredContent);
    written++;
    console.log(`[sync-routes] created ${entry.path}`);
    continue;
  }

  const current = readFileSync(target, "utf-8");
  if (current === desiredContent) {
    unchanged++;
    continue;
  }

  if (looksLikeStandardStub(current)) {
    // Stub-shaped but content drifted (export list changed). Update it.
    writeFileSync(target, desiredContent);
    written++;
    console.log(`[sync-routes] refreshed ${entry.path}`);
  } else {
    // Custom wrapper — leave alone.
    skippedCustom++;
  }
}

console.log(
  `[sync-routes] ${written} written, ${unchanged} unchanged, ${skippedCustom} custom (left alone)`
);

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
  exports: string[];
}

const REPO_ROOT = process.cwd();
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "node_modules/@directoryone/app/src/route-manifest.json"
);
const APP_DIR = path.join(REPO_ROOT, "src/app");

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
  const exportList = entry.exports.join(", ");
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

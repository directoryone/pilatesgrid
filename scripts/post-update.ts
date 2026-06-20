#!/usr/bin/env npx tsx
/**
 * Post-update script — runs after `pnpm update @directoryone/*` in a spawned directory.
 *
 * 1. Syncs globals.css from the @directoryone/core reference.
 * 2. Backfills idempotent seed data (default legal pages).
 * 3. Updates `platformVersion` (and stamps `platformUpdatedAt`) in the directory config.
 *
 * Usage: npx tsx scripts/post-update.ts "1.2.3"
 */

import { resolve, relative, dirname } from "path";
import { fileURLToPath } from "url";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
  mkdirSync,
  readdirSync,
  rmSync,
  rmdirSync,
} from "fs";

// __dirname is Node 21.2+; fall back for Node 20 (Vercel default)
const __dirname =
  (import.meta as Record<string, unknown>).dirname as string | undefined
  ?? dirname(fileURLToPath(import.meta.url));

async function main() {
  const newVersion = process.argv[2];
  if (!newVersion) {
    console.error("Usage: npx tsx scripts/post-update.ts <version>");
    process.exit(1);
  }

  // Load .env.local for DATABASE_URL when running locally. On Vercel, env vars are
  // injected directly into process.env, so dotenv isn't installed and isn't needed.
  // Wrapped in try/catch so the script no-ops gracefully if dotenv is unavailable.
  try {
    const { config } = await import("dotenv");
    config({ path: resolve(__dirname, "../.env.local") });
  } catch {
    // dotenv not installed (e.g. Vercel build) — env vars come from the platform.
  }

  // Sync globals.css @theme variables from the reference in @directoryone/core
  try {
    const refCssPath = resolve(
      __dirname,
      "../node_modules/@directoryone/core/src/theme/globals-reference.css"
    );
    const localCssPath = resolve(__dirname, "../src/app/globals.css");
    if (existsSync(refCssPath)) {
      let refCss = readFileSync(refCssPath, "utf-8");
      // Resolve real pnpm store paths — pnpm symlinks at node_modules/@directoryone/* point to
      // .pnpm virtual store directories. Tailwind's Oxide scanner doesn't follow directory
      // symlinks, so using the resolved real paths ensures it finds the .tsx source files.
      const sourceLines: string[] = [];
      for (const pkg of ["app", "ui"]) {
        const symlinkPath = resolve(__dirname, `../node_modules/@directoryone/${pkg}`);
        try {
          const realPath = realpathSync(symlinkPath);
          const relPath = relative(dirname(localCssPath), realPath);
          sourceLines.push(`@source "${relPath}";`);
        } catch {
          // Package not installed, skip
        }
      }
      refCss = refCss.replace(
        '@import "tailwindcss";',
        sourceLines.length > 0
          ? `@import "tailwindcss";\n${sourceLines.join("\n")}`
          : '@import "tailwindcss";\n@source "../../node_modules/@directoryone";'
      );
      writeFileSync(localCssPath, refCss);
      console.log("Synced globals.css theme variables from @directoryone/core");
    }
  } catch (err) {
    console.warn("Could not sync globals.css:", err);
  }

  // Sync route shims from @directoryone/app's route manifest. New platform
  // routes only ship as package exports; each spawn needs a thin re-export at
  // src/app/<path> or the route 404s. Creating any missing shim here lets new
  // routes self-heal on the next update instead of needing a manual push per
  // spawn. (Format mirrors the spawn-time generator, incl. the init import for
  // route handlers and the auth callback page.)
  try {
    const manifestPath = resolve(
      __dirname,
      "../node_modules/@directoryone/app/dist/route-manifest.json"
    );
    if (existsSync(manifestPath)) {
      const manifest: Array<{ path: string; from: string; exports: string[] }> =
        JSON.parse(readFileSync(manifestPath, "utf-8"));
      const appDir = resolve(__dirname, "../src/app");

      // Inventory existing generated shims first (file → its re-export source).
      // Spawns may relocate a shim to a config-driven custom path (e.g.
      // case-studies served at /great-work), so a shim's PATH is not what makes
      // it valid — its import target is. Only files named page.tsx/route.ts
      // whose ENTIRE content matches the generated shim shape (a re-export from
      // @directoryone/app, optionally preceded by the init import) count;
      // anything customized, app-local, or re-exporting from a different
      // package (e.g. error.tsx → @directoryone/ui) is never touched.
      const shimRe =
        /^(?:import "@\/lib\/init";\s*)?export \{[^}]*\} from "(@directoryone\/app\/[^"]+)";\s*$/;
      const shimFiles: Array<{ full: string; source: string }> = [];
      const collect = (dir: string) => {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const full = resolve(dir, ent.name);
          if (ent.isDirectory()) {
            collect(full);
          } else if (
            ent.isFile() &&
            (ent.name === "page.tsx" || ent.name === "route.ts")
          ) {
            let body = "";
            try {
              body = readFileSync(full, "utf-8").trim();
            } catch {
              continue;
            }
            const m = body.match(shimRe);
            if (m) shimFiles.push({ full, source: m[1] });
          }
        }
      };
      if (existsSync(appDir)) collect(appDir);
      const shimmedSources = new Set(shimFiles.map((s) => s.source));

      // Create missing shims — but skip routes already shimmed at a custom
      // path, so we don't resurrect the default-path twin of a renamed route.
      const created: string[] = [];
      for (const entry of manifest) {
        const target = resolve(appDir, entry.path);
        if (existsSync(target)) continue;
        if (shimmedSources.has(entry.from)) continue;
        const needsInit =
          entry.path.endsWith("route.ts") ||
          entry.path === "auth/callback/page.tsx";
        const initLine = needsInit ? `import "@/lib/init";\n` : "";
        const content = `${initLine}export { ${entry.exports.join(", ")} } from "${entry.from}";\n`;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        created.push(entry.path);
      }
      if (created.length > 0) {
        console.log(
          `Created ${created.length} missing route shim(s): ${created.join(", ")}`
        );
      }

      // Prune orphaned shims: a shim is orphaned only when its re-export
      // TARGET left the manifest (the package no longer exports that route, so
      // the build would fail with "Module not found"). A shim at a non-manifest
      // path whose target still exists is a deliberate path customization and
      // is kept.
      const manifestSources = new Set(manifest.map((e) => e.from));
      const removed: string[] = [];
      for (const { full, source } of shimFiles) {
        if (manifestSources.has(source)) continue;
        try {
          rmSync(full);
          removed.push(relative(appDir, full));
        } catch {
          // best-effort
        }
        // Sweep now-empty parent directories up to appDir.
        let parent = dirname(full);
        while (parent.startsWith(appDir) && parent !== appDir) {
          try {
            if (readdirSync(parent).length > 0) break;
            rmdirSync(parent);
          } catch {
            break;
          }
          parent = dirname(parent);
        }
      }
      if (removed.length > 0) {
        console.log(
          `Removed ${removed.length} orphaned route shim(s): ${removed.join(", ")}`
        );
      }
    }
  } catch (err) {
    console.warn("Could not sync route shims (non-fatal):", err);
  }

  // Ensure the daily draft-reminder cron is registered in vercel.json. Spawns
  // were created before this cron existed, so merge it in without clobbering
  // installCommand or any spawn-specific config. Idempotent — only writes when
  // the entry is missing.
  try {
    const vercelJsonPath = resolve(__dirname, "../vercel.json");
    const cronPath = "/api/cron/draft-reminder";
    const vercel: {
      crons?: { path: string; schedule: string }[];
      [k: string]: unknown;
    } = existsSync(vercelJsonPath)
      ? JSON.parse(readFileSync(vercelJsonPath, "utf-8"))
      : { installCommand: "pnpm install --no-frozen-lockfile" };
    const crons = Array.isArray(vercel.crons) ? vercel.crons : [];
    if (!crons.some((c) => c.path === cronPath)) {
      crons.push({ path: cronPath, schedule: "0 14 * * *" });
      vercel.crons = crons;
      writeFileSync(vercelJsonPath, JSON.stringify(vercel, null, 2) + "\n");
      console.log("Registered draft-reminder cron in vercel.json");
    }
  } catch (err) {
    console.warn("Could not sync vercel.json crons (non-fatal):", err);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not found in .env.local");
    process.exit(1);
  }

  // Dynamic imports so the database connection is established after env is loaded
  const { createDb } = await import("@directoryone/core/db");
  const { setPlatformVersion, getPlatformVersion } = await import(
    "@directoryone/core/actions"
  );

  const db = createDb(databaseUrl);

  // Idempotent data backfills — run on every deploy so existing directories
  // pick up new defaults without re-seeding. Each helper is responsible for
  // skipping rows that already exist.
  try {
    const { ensureDefaultLegalPages } = await import(
      "@directoryone/core/db/seed-pages"
    );
    const { inserted } = await ensureDefaultLegalPages(db);
    if (inserted.length > 0) {
      console.log(`Seeded missing pages: ${inserted.join(", ")}`);
    }
  } catch (err) {
    console.warn("ensureDefaultLegalPages failed (non-fatal):", err);
  }

  const oldVersion = await getPlatformVersion(db);
  if (oldVersion === newVersion) {
    console.log(`Already on version ${newVersion}, nothing further to do.`);
    process.exit(0);
  }

  // Update platform version (also stamps platformUpdatedAt). The current version
  // and update timestamp are surfaced in /admin/notifications, so per-update
  // notifications are not created here.
  await setPlatformVersion(db, newVersion);
  console.log(`Updated platformVersion: ${oldVersion} → ${newVersion}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Post-update failed:", err);
  process.exit(1);
});

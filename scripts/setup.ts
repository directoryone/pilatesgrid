#!/usr/bin/env npx tsx
/**
 * Interactive setup wizard for spawned Directory Platform projects.
 *
 * Usage: pnpm setup
 *
 * Guides through:
 *   Phase 0 — Create GitHub repo (directoryone/<name>)
 *   Phase 1 — GitHub Packages auth + pnpm install
 *   Phase 2 — Supabase / .env.local configuration
 *   Phase 3 — Database migration + seed
 *   Phase 4 — Optional Vercel deployment
 *   Phase 5 — Optional Cloudflare DNS (gated on CLOUDFLARE_API_TOKEN)
 *
 * Uses only Node built-ins so it works before `pnpm install`.
 */

import * as readline from "readline";
import { execSync, spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// __dirname is Node 21.2+; fall back when tsx transpiles to CJS
const __dirname =
  (import.meta as Record<string, unknown>).dirname as string | undefined
  ?? dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ────── Readline helpers ──────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await ask(`${question} (${hint})`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

function banner(phase: string) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${phase}`);
  console.log(`${"─".repeat(50)}\n`);
}

function run(cmd: string, opts?: { cwd?: string; stdio?: "inherit" | "pipe" }) {
  execSync(cmd, {
    cwd: opts?.cwd || PROJECT_ROOT,
    stdio: opts?.stdio || "inherit",
    env: { ...process.env },
  });
}

// ────── PAT validation + package access ──────

/** Validate a PAT has the read:packages scope GitHub Packages requires for
 *  installs. With only `repo`, GitHub may allow some operations but
 *  `pnpm install` against private @scope packages returns 403 on Vercel. */
async function ensureTokenHasPackageRead(
  token: string,
  exitOnFail = true
): Promise<boolean> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`Token check failed (HTTP ${res.status}).`);
      if (exitOnFail) process.exit(1);
      return false;
    }
    const scopes = (res.headers.get("x-oauth-scopes") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ok =
      scopes.includes("read:packages") ||
      scopes.includes("write:packages") ||
      scopes.includes("admin:packages");
    if (!ok) {
      console.error(
        `Token is missing read:packages scope. Found scopes: ${scopes.join(", ") || "(none)"}`
      );
      if (exitOnFail) process.exit(1);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Token validation error: ${(err as Error).message}`);
    if (exitOnFail) process.exit(1);
    return false;
  }
}

/** GitHub Packages doesn't have a REST endpoint to grant a repo access to a
 *  scoped package. Even with a valid PAT, installs return 403 until each
 *  consumer repo is added in the package's "Manage Actions access" UI.
 *  Print the three URLs and pause. */
async function ensurePackageAccessGranted(): Promise<void> {
  let repoName = "";
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf-8")
    );
    repoName = String(pkg.name || "").replace(/^@directoryone\//, "");
  } catch {
    // Best-effort; URL list still works without the name.
  }
  console.log("\nGrant THIS repo access to each @directoryone package");
  console.log("(otherwise pnpm install on Vercel will return 403):");
  for (const p of ["core", "app", "ui"]) {
    console.log(`  https://github.com/orgs/directoryone/packages/npm/${p}/settings`);
  }
  console.log(
    "On each: scroll to 'Manage Actions access' → Add repository → " +
      (repoName ? `select '${repoName}'` : "select your new repo") +
      " → Save."
  );
  await confirm("Done granting access? (y to continue)", false);
}

// ────── Phase 0: Create GitHub Repo ──────

async function createGithubRepo(): Promise<void> {
  banner("Phase 0: Create GitHub Repo");

  let repoName = "";
  try {
    const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf-8"));
    const name = String(pkg.name || "");
    repoName = name.startsWith("@directoryone/") ? name.slice("@directoryone/".length) : name;
  } catch {
    // ignore
  }
  if (!repoName) {
    console.log("Could not determine repo name from package.json — skipping.\n");
    return;
  }
  const fullName = `directoryone/${repoName}`;

  // Detect existing git repo + matching origin remote
  const isGitRepo = existsSync(resolve(PROJECT_ROOT, ".git"));
  let hasMatchingRemote = false;
  if (isGitRepo) {
    try {
      const remoteUrl = execSync("git remote get-url origin 2>/dev/null", {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      }).trim();
      hasMatchingRemote = remoteUrl.includes(`directoryone/${repoName}`);
    } catch {
      // No origin remote configured
    }
  }
  if (hasMatchingRemote) {
    console.log(`✓ GitHub repo already configured (${fullName})\n`);
    return;
  }

  const shouldCreate = await confirm(`Create GitHub repo \`${fullName}\` now?`);
  if (!shouldCreate) {
    console.log("Skipping GitHub repo creation.\n");
    return;
  }

  const ghCheck = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
  if (ghCheck.status !== 0) {
    console.error("\nGitHub CLI (`gh`) is missing or not authenticated.");
    console.error("Install: https://cli.github.com/  then `gh auth login`");
    console.error(`Or create manually: gh repo create ${fullName} --private --source . --remote origin --push\n`);
    return;
  }

  if (!isGitRepo) {
    console.log("Initialising git repo...\n");
    try {
      run("git init");
      run("git add .");
      run('git commit -m "Initial commit"');
    } catch {
      console.error("git init / initial commit failed. Skipping repo creation.\n");
      return;
    }
  }

  console.log(`\nCreating ${fullName} on GitHub...\n`);
  try {
    run(`gh repo create ${fullName} --private --source . --remote origin --push`);
    console.log(`\nGitHub repo ${fullName} created and pushed.\n`);
  } catch {
    console.error(`\nFailed. Create manually: gh repo create ${fullName} --private --source . --remote origin --push\n`);
  }
}

// ────── Phase 1: GitHub Packages Auth + Install ──────

async function checkAndInstallPackages(): Promise<void> {
  banner("Phase 1: GitHub Packages Auth + Install");

  const npmrcPath = resolve(PROJECT_ROOT, ".npmrc");
  const npmrcContent = existsSync(npmrcPath)
    ? readFileSync(npmrcPath, "utf-8")
    : "";

  const hasToken = npmrcContent.includes(":_authToken=");

  let githubToken = "";

  if (hasToken) {
    console.log("GitHub Packages auth token already configured in .npmrc");
    // Extract existing token for reuse as GITHUB_TOKEN
    const match = npmrcContent.match(/:_authToken=(.+)/);
    if (match) githubToken = match[1].trim();
    // Even existing tokens may lack read:packages — validate now.
    await ensureTokenHasPackageRead(githubToken);
  } else {
    console.log("To install @directoryone packages and enable auto-updates,");
    console.log("you need a GitHub Personal Access Token (classic) with BOTH:");
    console.log("  - repo (private repo access for push/pull)");
    console.log("  - read:packages (download @directoryone packages from GitHub Packages)\n");
    console.log("Create one at: https://github.com/settings/tokens/new?scopes=repo,read:packages\n");

    while (true) {
      const token = await askSecret("Enter your GitHub Personal Access Token");
      if (!token) {
        console.error("Token is required. Aborting.");
        process.exit(1);
      }
      const ok = await ensureTokenHasPackageRead(token, /* exitOnFail */ false);
      if (ok) {
        githubToken = token;
        break;
      }
      console.log("\nThat token won't work. Generate a new one with read:packages and try again.\n");
    }

    const trimmed = npmrcContent.trimEnd();
    const newNpmrc =
      (trimmed ? trimmed + "\n" : "") +
      `//npm.pkg.github.com/:_authToken=${githubToken}\n`;
    writeFileSync(npmrcPath, newNpmrc);
    console.log("Token written to .npmrc\n");
  }

  // Remind operator to grant the new repo access to each @directoryone package.
  // GitHub Packages doesn't expose a REST API for this — UI only — so the best
  // we can do is print the URLs and pause.
  await ensurePackageAccessGranted();

  // Store the token for Phase 4 (Vercel env vars)
  (globalThis as any).__githubToken = githubToken;

  // Check if already installed
  const coreExists = existsSync(
    resolve(PROJECT_ROOT, "node_modules/@directoryone/core")
  );

  if (coreExists) {
    const reinstall = await confirm("Packages already installed. Re-install?", false);
    if (!reinstall) {
      console.log("Skipping install.");
      return;
    }
  }

  console.log("\nRunning pnpm install...\n");
  try {
    run("pnpm install");
  } catch {
    console.error("\npnpm install failed. Check your GitHub token and try again.");
    process.exit(1);
  }

  // Verify
  if (
    !existsSync(resolve(PROJECT_ROOT, "node_modules/@directoryone/core"))
  ) {
    console.error("Install appeared to succeed but @directoryone/core not found.");
    process.exit(1);
  }

  console.log("\nPackages installed successfully.");
}

// ────── Phase 2: Environment Configuration ──────

async function configureEnvironment(): Promise<Record<string, string>> {
  banner("Phase 2: Supabase Configuration");

  const envPath = resolve(PROJECT_ROOT, ".env.local");

  if (existsSync(envPath)) {
    const overwrite = await confirm(".env.local already exists. Overwrite?", false);
    if (!overwrite) {
      console.log("Keeping existing .env.local\n");
      // Parse existing values
      const existing = readFileSync(envPath, "utf-8");
      const vars: Record<string, string> = {};
      for (const line of existing.split("\n")) {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) vars[match[1].trim()] = match[2].trim();
      }
      return vars;
    }
  }

  console.log("Enter your Supabase project credentials.");
  console.log("Find these in: Supabase Dashboard > Project Settings > API\n");

  const supabaseUrl = await ask("Supabase project URL (e.g. https://xxx.supabase.co)");
  const supabaseAnonKey = await ask("Supabase anon/public key");
  const serviceRoleKey = await askSecret("Supabase service role key");

  console.log("");
  console.log("IMPORTANT: Use the Transaction Pooler URL (port 6543) from Supabase, not the Direct connection or Session pooler.");
  console.log("Go to: Supabase Dashboard > Connect (top button) > Transaction pooler");
  console.log("The URL looks like: postgresql://postgres.PROJECT_REF:PASSWORD@aws-N-REGION.pooler.supabase.com:6543/postgres");
  console.log("(Direct connections use IPv6 which doesn't work on Vercel; Session pooler at 5432 has too few connections for serverless.)\n");

  const databaseUrl = await ask("Database URL (Transaction pooler, port 6543)");

  const siteUrl = await ask("Site URL", "http://localhost:3001");
  const resendKey = await ask("Resend API key for email (optional, press Enter to skip)");

  // Default User-Agent for the Nominatim geocode proxy. OSM's TOS asks
  // production traffic to identify itself with an app-specific UA. Derive
  // a reasonable default from the site URL; admin can edit later.
  let geocodeDefault = "directoryone-platform (admin@directoryone.local)";
  try {
    const host = new URL(siteUrl).host.replace(/^www\./, "");
    if (host && !host.startsWith("localhost")) {
      geocodeDefault = `${host} (admin@${host})`;
    }
  } catch {
    // Keep platform default if URL parsing fails.
  }
  console.log("");
  console.log(
    "GEOCODE_USER_AGENT identifies your site to OpenStreetMap's Nominatim"
  );
  console.log(
    "geocoder (used by the city autocomplete on listing forms). Their TOS"
  );
  console.log(
    "asks for an app-specific User-Agent on production traffic. Use a real"
  );
  console.log('contact email — e.g. "your-domain.com (admin@your-domain.com)".\n');
  const geocodeUserAgent = await ask("GEOCODE_USER_AGENT", geocodeDefault);

  // Stable Server Actions encryption key, baked at build + read at runtime.
  // Without this, Vercel auto-rotates the key per deploy and any browser
  // tab open from a previous build hits "Server Action ... not found" on
  // submit until the user hard-refreshes.
  const serverActionsKey = randomBytes(32).toString("base64");

  // AES-256-GCM key used by packages/core encryption to store admin-entered
  // integration API keys (OpenAI/Anthropic/Resend/etc.) encrypted at rest.
  // Must be a 64-char hex string (32 bytes) — see packages/core/src/utils/encryption.ts.
  // Without it, saving Integrations in admin Settings throws
  // "ENCRYPTION_KEY environment variable is not set".
  const encryptionKey = randomBytes(32).toString("hex");

  const vars: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_SITE_URL: siteUrl,
    GEOCODE_USER_AGENT: geocodeUserAgent,
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: serverActionsKey,
    ENCRYPTION_KEY: encryptionKey,
  };
  if (resendKey) vars.RESEND_API_KEY = resendKey;

  const envContent = Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
  writeFileSync(envPath, envContent);
  console.log("\n.env.local written.\n");

  // Test database connection
  console.log("Testing database connection...");
  try {
    const { createDb } = await import("@directoryone/core/db");
    const db = createDb(databaseUrl);
    // Simple query to verify connection
    await (db as any).execute({ sql: "SELECT 1" });
    console.log("Database connection successful.\n");
  } catch (err: any) {
    console.warn(`Warning: Could not connect to database — ${err.message}`);
    console.warn("You can continue, but migration/seed may fail.\n");
  }

  // Configure Supabase auth URLs (site_url + redirect allow-list) and SMTP.
  // Both call PATCH /v1/projects/{ref}/config/auth so we collect the
  // Management API token once and reuse it.
  const projectRef = extractSupabaseRef(supabaseUrl);
  const managementToken = projectRef
    ? await promptManagementToken(projectRef, siteUrl)
    : null;
  if (projectRef && managementToken) {
    await configureSupabaseAuthUrls(projectRef, siteUrl, managementToken);
    await configureSupabaseSMTP(projectRef, siteUrl, managementToken, resendKey);
  } else if (projectRef) {
    console.log(
      `\nManual setup needed: https://supabase.com/dashboard/project/${projectRef}/auth/url-configuration`
    );
    console.log(`  Site URL: ${siteUrl}`);
    console.log(`  Redirect URLs: ${siteUrl}/**\n`);
  }

  return vars;
}

function extractSupabaseRef(supabaseUrl: string): string | null {
  const m = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

async function promptManagementToken(
  projectRef: string,
  siteUrl: string
): Promise<string | null> {
  console.log("");
  console.log("Configure Supabase project (auth URLs + SMTP for auth emails)?");
  console.log("Without this, signup confirmation emails resolve to localhost and");
  console.log("come from a Supabase domain instead of your directory's domain.");
  console.log("Get a token at: https://supabase.com/dashboard/account/tokens");
  console.log("(Press Enter to skip — you can configure manually in the dashboard.)\n");
  const token = await askSecret("Supabase Management API token (optional)");
  if (!token) {
    console.log(
      `\nSkipped. Set manually at: https://supabase.com/dashboard/project/${projectRef}/auth/url-configuration`
    );
    console.log(`  Site URL: ${siteUrl}`);
    console.log(`  Redirect URLs: ${siteUrl}/**\n`);
    return null;
  }
  return token;
}

/** Set site_url + redirect allow-list so the deployed URL works for signup. */
async function configureSupabaseAuthUrls(
  projectRef: string,
  siteUrl: string,
  token: string
): Promise<void> {
  const uriAllowList = [`${siteUrl}/**`].join(",");
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          site_url: siteUrl,
          uri_allow_list: uriAllowList,
          // Default is 2/hour project-wide — too low for any active
          // directory. Recipients beyond the first 2 in any rolling hour
          // get an opaque "Could not send the sign-in email" error
          // (claim, login, password reset, all of it). 30 is safe; the
          // upstream Resend tier supplies plenty of headroom.
          rate_limit_email_sent: 30,
        }),
      }
    );
    if (res.ok) {
      console.log("Supabase auth URLs + rate limit configured.");
    } else {
      const body = await res.text();
      console.error(`Auth URL config failed (${res.status}): ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`Auth URL request failed: ${(err as Error).message}`);
  }
}

/** Point Supabase's auth emails at Resend SMTP so signup confirmation,
 *  magic-link, and password-recovery emails come from the directory's
 *  domain with branded subjects instead of generic Supabase ones. Needs
 *  a Resend API key with sending access and a verified sender domain. */
async function configureSupabaseSMTP(
  projectRef: string,
  siteUrl: string,
  token: string,
  resendKey: string | undefined
): Promise<void> {
  if (!resendKey) {
    console.log(
      "No Resend key provided — auth emails will use Supabase's default sender."
    );
    console.log(
      "  Add one later via: https://supabase.com/dashboard/project/" +
        projectRef +
        "/settings/auth\n"
    );
    return;
  }

  // Derive sender email + display name from the site URL. Admin can edit
  // both later from /admin/settings/email (sender) and the Supabase
  // dashboard (the auth email subjects + body).
  let domain = "example.com";
  let display = "Directory";
  try {
    domain = new URL(siteUrl).host.replace(/^www\./, "");
    display = domain
      .split(".")[0]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    // fall through to defaults
  }
  const senderEmail = `auth@${domain}`;

  console.log("");
  console.log("Customize the SMTP sender for Supabase auth emails:");
  const finalSenderEmail = await ask("Sender email", senderEmail);
  const finalSenderName = await ask("Sender display name", display);

  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          smtp_admin_email: finalSenderEmail,
          smtp_host: "smtp.resend.com",
          smtp_port: "587",
          smtp_user: "resend",
          smtp_pass: resendKey,
          smtp_sender_name: finalSenderName,
          smtp_max_frequency: 60,
          mailer_subjects_confirmation: `Confirm your ${finalSenderName} account`,
          mailer_subjects_magic_link: `Your sign-in link for ${finalSenderName}`,
          mailer_subjects_recovery: `Reset your ${finalSenderName} password`,
          mailer_subjects_invite: `You've been invited to ${finalSenderName}`,
        }),
      }
    );
    if (res.ok) {
      console.log(
        `Supabase SMTP configured. Auth emails will send from "${finalSenderName}" <${finalSenderEmail}>.\n`
      );
      console.log(
        `Make sure the domain (${domain}) is verified in your Resend dashboard,`
      );
      console.log(`otherwise sends will silently fail.\n`);
    } else {
      const body = await res.text();
      console.error(
        `SMTP config failed (${res.status}): ${body.slice(0, 200)}`
      );
    }
  } catch (err) {
    console.error(`SMTP request failed: ${(err as Error).message}`);
  }
}

// ────── Phase 3: Migration + Seed ──────

async function migrateAndSeed(envVars: Record<string, string>): Promise<void> {
  banner("Phase 3: Database Migration + Seed");

  const databaseUrl = envVars.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set. Skipping migration and seed.");
    return;
  }

  // Run migrations
  console.log("Running database migrations...\n");
  try {
    run(`npx drizzle-kit migrate`, {
      cwd: PROJECT_ROOT,
    });
    console.log("\nMigrations applied successfully.\n");
  } catch {
    console.error("Migration failed. Check your DATABASE_URL and try again.");
    return;
  }

  // Seed
  const templatePath = resolve(PROJECT_ROOT, "template.json");
  if (!existsSync(templatePath)) {
    console.log("No template.json found — skipping seed.");
    return;
  }

  const shouldSeed = await confirm("Seed the database with template data?");
  if (!shouldSeed) {
    console.log("Skipping seed.");
    return;
  }

  console.log("\nSeeding database...\n");

  try {
    const template = JSON.parse(readFileSync(templatePath, "utf-8"));
    const { createDb } = await import("@directoryone/core/db");
    const { seedFromTemplate } = await import("@directoryone/core/db/seed");

    const db = createDb(databaseUrl);
    const { apiKey } = await seedFromTemplate(db, template);

    console.log(`\n  API Key: ${apiKey}`);
    console.log("  Save this key — you'll need it to use the ingest API.\n");
  } catch (err: any) {
    console.error(`Seed failed: ${err.message}`);
    console.error("You can re-run: pnpm setup (and skip to the seed step)");
  }
}

// ────── Vercel env helpers ──────

interface VercelLink {
  projectId: string;
  orgId: string;
}

function readVercelAuth(): string | null {
  const candidates = [
    `${process.env.HOME}/Library/Application Support/com.vercel.cli/auth.json`,
    `${process.env.HOME}/.local/share/com.vercel.cli/auth.json`,
    `${process.env.HOME}/.config/com.vercel.cli/auth.json`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8")).token || null;
      } catch {
        // Try next location
      }
    }
  }
  return null;
}

function readVercelLink(): VercelLink | null {
  const p = resolve(PROJECT_ROOT, ".vercel/project.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/** Set Vercel env vars via REST API. Replaces `echo | vercel env add`, which
 *  silently stores empty values for multi-line inputs (NPM_RC). */
async function setVercelEnvVars(
  vars: Record<string, string>
): Promise<void> {
  const token = readVercelAuth();
  const link = readVercelLink();
  if (!token || !link) {
    console.error("Could not locate Vercel auth or project link. Skipping env var setup.");
    return;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = `https://api.vercel.com`;
  const teamQuery = `?teamId=${link.orgId}`;

  // List existing so we can replace cleanly (avoid duplicate-key 409s).
  const listRes = await fetch(
    `${base}/v9/projects/${link.projectId}/env${teamQuery}`,
    { headers }
  );
  if (!listRes.ok) {
    console.error(`Failed to list Vercel env vars: ${listRes.status}`);
    return;
  }
  const existing: { id: string; key: string }[] = (
    (await listRes.json()) as { envs: { id: string; key: string }[] }
  ).envs;
  const byKey = Object.fromEntries(existing.map((e) => [e.key, e.id]));

  console.log("\nSetting Vercel environment variables via REST API...");
  for (const [key, value] of Object.entries(vars)) {
    if (byKey[key]) {
      await fetch(
        `${base}/v9/projects/${link.projectId}/env/${byKey[key]}${teamQuery}`,
        { method: "DELETE", headers }
      );
    }
    const res = await fetch(
      `${base}/v10/projects/${link.projectId}/env${teamQuery}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          key,
          value,
          type: "encrypted",
          target: ["production"],
        }),
      }
    );
    console.log(`  ${res.ok ? "✓" : "✗"} ${key}`);
  }
}

// ────── Phase 4: Optional Vercel Deployment ──────

async function deployToVercel(envVars: Record<string, string>): Promise<void> {
  banner("Phase 4: Deploy to Vercel (Optional)");

  const shouldDeploy = await confirm("Deploy to Vercel?", false);
  if (!shouldDeploy) {
    console.log("Skipping Vercel deployment.\n");
    return;
  }

  // Check if vercel CLI is installed
  const vercelCheck = spawnSync("which", ["vercel"], { encoding: "utf-8" });
  if (vercelCheck.status !== 0) {
    console.log("Vercel CLI not found. Install it with: npm i -g vercel");
    const install = await confirm("Install vercel CLI now?");
    if (install) {
      try {
        run("npm i -g vercel");
      } catch {
        console.error("Failed to install Vercel CLI. Skipping deployment.");
        return;
      }
    } else {
      console.log("Skipping deployment.");
      return;
    }
  }

  // Link to Vercel project
  console.log("\nLinking to Vercel project...\n");
  try {
    run("vercel link");
  } catch {
    console.error("Failed to link Vercel project. Skipping deployment.");
    return;
  }

  // Set environment variables via Vercel REST API (the CLI's `vercel env add`
  // via stdin reliably stores empty values for multi-line content like NPM_RC,
  // which is what bit us during the souwesterarts-artists spawn).
  const npmrcPath = resolve(PROJECT_ROOT, ".npmrc");
  const allVars: Record<string, string> = { ...envVars };
  if (existsSync(npmrcPath)) {
    allVars.NPM_RC = readFileSync(npmrcPath, "utf-8");
  }
  await setVercelEnvVars(allVars);

  // Deploy
  console.log("\nDeploying to production...\n");
  try {
    run("vercel --prod");
    console.log("\nDeployment complete!");
  } catch {
    console.error("Deployment failed. You can retry with: vercel --prod");
  }
}

// ────── Phase 5: Cloudflare DNS (Optional) ──────

async function cfFetch(path: string, token: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: init?.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  return res.json() as Promise<any>;
}

async function configureCloudflareDns(envVars: Record<string, string>): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    // Print clear manual instructions instead of silently skipping. The
    // operator needs to know what DNS values to set so the deployed site
    // is reachable on the production URL.
    banner("Phase 5: DNS Setup");
    const siteUrl = envVars.NEXT_PUBLIC_SITE_URL || "";
    let host = "";
    try {
      if (siteUrl) host = new URL(siteUrl).host;
    } catch {}
    if (!host || host.startsWith("localhost")) {
      console.log("No production site URL set — skipping DNS instructions.\n");
      return;
    }
    const isApex = host.split(".").length <= 2;
    const isSubdomain = !isApex;
    const sub = isSubdomain ? host.split(".")[0] : "@";
    console.log(`To make ${siteUrl} resolve to your Vercel deploy:\n`);
    console.log(`1. At your DNS provider for ${host.split(".").slice(-2).join(".")}, add:`);
    if (isSubdomain) {
      console.log(`     Type:   CNAME`);
      console.log(`     Name:   ${sub}`);
      console.log(`     Target: cname.vercel-dns.com.`);
    } else {
      console.log(`     Type:   A`);
      console.log(`     Name:   @`);
      console.log(`     Target: 76.76.21.21`);
    }
    console.log(`     Proxy:  off / DNS-only (don't proxy through Cloudflare)\n`);
    console.log(`2. In Vercel project Settings → Domains, add: ${host}`);
    console.log(`3. Wait for the TLS cert to issue (usually <2 min).\n`);
    console.log(`Skip the Cloudflare automation? Set CLOUDFLARE_API_TOKEN env`);
    console.log(`var with a token scoped to the zone, then re-run setup.\n`);
    return;
  }

  banner("Phase 5: Cloudflare DNS (Optional)");

  // Resolve apex domain — prefer NEXT_PUBLIC_SITE_URL, else ask
  let domain = "";
  const siteUrl = envVars.NEXT_PUBLIC_SITE_URL || "";
  try {
    if (siteUrl) {
      const host = new URL(siteUrl).host;
      if (host && !host.startsWith("localhost")) domain = host.replace(/^www\./, "");
    }
  } catch {
    // ignore
  }
  if (!domain) domain = await ask("Domain to configure (e.g. example.com)");
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!domain) {
    console.log("No domain provided. Skipping DNS.\n");
    return;
  }

  const shouldConfigure = await confirm(`Configure DNS for ${domain}?`);
  if (!shouldConfigure) {
    console.log("Skipping DNS configuration.\n");
    return;
  }

  let zoneId = "";
  try {
    const zones = await cfFetch(`/zones?name=${encodeURIComponent(domain)}`, token);
    if (!zones.success || !zones.result?.length) {
      console.error(`Cloudflare zone for ${domain} not found. Add the domain to Cloudflare first.\n`);
      return;
    }
    zoneId = zones.result[0].id;
  } catch (err: any) {
    console.error(`Cloudflare zone lookup failed: ${err.message}\n`);
    return;
  }

  // Vercel handles SSL termination; CF proxy on apex needs CNAME flattening
  // which adds latency, so leave proxy off for both records.
  const records = [domain, `www.${domain}`];
  for (const name of records) {
    try {
      const existing = await cfFetch(
        `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`,
        token
      );
      if (existing.success && existing.result?.length > 0) {
        console.log(`  ${name} — already exists, skipping`);
        continue;
      }
      const created = await cfFetch(`/zones/${zoneId}/dns_records`, token, {
        method: "POST",
        body: { type: "CNAME", name, content: "cname.vercel-dns.com", proxied: false, ttl: 1 },
      });
      if (created.success) {
        console.log(`  ${name} — created (CNAME → cname.vercel-dns.com)`);
      } else {
        console.log(`  ${name} — failed: ${created.errors?.[0]?.message || "unknown error"}`);
      }
    } catch (err: any) {
      console.log(`  ${name} — failed: ${err.message}`);
    }
  }

  // Alias the deployment to the custom domain so Vercel issues the cert.
  // Without this, `vercel domains add` only registers the domain at the
  // project level — it doesn't bind to the active deployment, so HTTPS
  // never becomes serving and the apex returns SSL_ERROR_SYSCALL.
  await aliasVercelDeployment(domain);
}

async function aliasVercelDeployment(domain: string): Promise<void> {
  const projectFile = resolve(PROJECT_ROOT, ".vercel/project.json");
  if (!existsSync(projectFile)) {
    console.log(
      `\nSkipping Vercel alias for ${domain} — no .vercel/project.json found.`
    );
    console.log(`  Manual: vercel alias set <project>.vercel.app ${domain}\n`);
    return;
  }
  let projectName = "";
  try {
    const project = JSON.parse(readFileSync(projectFile, "utf-8"));
    projectName = String(project.projectName || "");
  } catch {
    // ignore
  }
  if (!projectName) {
    console.log(`\nSkipping Vercel alias — could not read projectName.\n`);
    return;
  }
  const source = `${projectName}.vercel.app`;

  console.log(`\nAliasing Vercel deployment to ${domain} (and www)...`);

  // Vercel issues the cert via an HTTP-01 ACME challenge when alias is set,
  // which only succeeds once DNS resolves to Vercel's anycast IP. CF DNS
  // updates propagate fast (proxy off → ~30s globally), but be patient.
  for (const target of [domain, `www.${domain}`]) {
    await waitForVercelDns(target);
    try {
      execSync(`vercel alias set ${source} ${target}`, {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
      });
    } catch {
      console.log(
        `  ${target} — alias failed. Retry once DNS settles:\n` +
        `    vercel alias set ${source} ${target}`
      );
    }
  }
}

async function waitForVercelDns(name: string): Promise<void> {
  const VERCEL_IP = "76.76.21.21";
  const MAX_TRIES = 18; // ~3 minutes at 10s each
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      const out = execSync(
        `dig +short +time=2 +tries=1 @1.1.1.1 ${name} A`,
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      if (out.split("\n").some((line) => line === VERCEL_IP)) return;
      // CNAME pointing at vercel-dns.com is also good — pooler will resolve it.
      if (out.includes("vercel-dns.com")) return;
    } catch {
      // `dig` not on PATH — just wait a bit and proceed.
      await new Promise((r) => setTimeout(r, 10000));
      return;
    }
    if (i === 0) console.log(`  ${name} — waiting for DNS to point at Vercel...`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  console.log(
    `  ${name} — DNS not pointing at Vercel after 3 min; trying alias anyway.`
  );
}

// ────── Main ──────

async function main() {
  console.log("\n  Directory Platform Setup Wizard\n");
  console.log("This wizard will guide you through setting up your directory.\n");
  console.log("Prerequisites:");
  console.log("  1. A GitHub Personal Access Token with `repo` scope");
  console.log("  2. A Supabase project (https://supabase.com/dashboard)\n");

  await createGithubRepo();
  await checkAndInstallPackages();
  const envVars = await configureEnvironment();
  await migrateAndSeed(envVars);
  await deployToVercel(envVars);
  await configureCloudflareDns(envVars);

  banner("Setup Complete!");
  console.log("Start your development server with:\n");
  console.log("  pnpm dev\n");
  console.log("Your directory will be available at: http://localhost:3001\n");

  rl.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  rl.close();
  process.exit(1);
});

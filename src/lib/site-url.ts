/**
 * Returns the canonical site URL.
 *
 * Priority:
 *  1. NEXT_PUBLIC_SITE_URL — if set to a non-Vercel domain (i.e. custom domain)
 *  2. VERCEL_PROJECT_PRODUCTION_URL — Vercel auto-sets this to the first custom
 *     domain, so it catches the case where NEXT_PUBLIC_SITE_URL was never
 *     updated after adding a custom domain in Vercel.
 *  3. Falls back to NEXT_PUBLIC_SITE_URL even if it's a Vercel URL.
 */
export function getSiteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL || "";

  if (envUrl && !envUrl.includes(".vercel.app")) {
    return envUrl;
  }

  const vercelProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProdUrl && !vercelProdUrl.includes(".vercel.app")) {
    return `https://${vercelProdUrl}`;
  }

  return envUrl;
}

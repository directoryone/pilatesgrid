import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sanitize-html"],
  experimental: {
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async rewrites() {
    return [
      { source: "/:key([a-zA-Z0-9\\-]{8,128}).txt", destination: "/api/indexnow-key" },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

// Sentry is gated on the SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN env vars (set per
// project in Vercel), so this is a no-op until a DSN is provided. Source-map
// upload only runs when SENTRY_AUTH_TOKEN is present.
export default withSentryConfig(nextConfig, {
  org: "chris-bolton",
  project: "directoryone",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Avoid allocating source maps when this deployment cannot upload them.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  disableLogger: true,
});

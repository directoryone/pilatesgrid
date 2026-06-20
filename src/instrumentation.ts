// Runs once per Node.js worker, before any request is handled. Eager-loads
// @/lib/init so initApp() has set the AppContext before any page or layout
// calls getAppContext(). Without this, page stubs that don't transitively
// import @/lib/init can throw "App context not initialized".
//
// Also initializes Sentry per-runtime. The sentry.*.config files are
// DSN-gated, so this is a no-op on directories without a SENTRY_DSN.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/init");
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures unhandled server-side request errors (Server Components, route
// handlers, Server Actions). Requires @sentry/nextjs >= 8.28.0.
export { captureRequestError as onRequestError } from "@sentry/nextjs";

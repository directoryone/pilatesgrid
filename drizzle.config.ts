import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./node_modules/@directoryone/core/src/db/schema/index.ts",
  out: "./node_modules/@directoryone/core/src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

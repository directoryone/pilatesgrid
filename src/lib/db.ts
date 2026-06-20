import { createDb } from "@directoryone/core/db";

export const db = createDb(process.env.DATABASE_URL!);

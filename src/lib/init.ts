import { initApp } from "@directoryone/core/app-context";
import { db } from "./db";
import { createClient } from "./supabase-server";
import { getSiteUrl } from "./site-url";
import { getAdminEmails } from "./get-admin-emails";
import { getUserEmail } from "./get-user-email";

initApp({
  db,
  createClient,
  getSiteUrl,
  getAdminEmails,
  getUserEmail,
});

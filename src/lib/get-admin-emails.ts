import { db } from "@/lib/db";
import { userProfiles } from "@directoryone/core/db/schema";
import { eq } from "drizzle-orm";
import { getUserEmail } from "./get-user-email";

export async function getAdminEmails(): Promise<
  { userId: string; email: string; displayName: string | null }[]
> {
  const admins = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.role, "admin"));

  const results: { userId: string; email: string; displayName: string | null }[] = [];
  for (const admin of admins) {
    const email = await getUserEmail(admin.id);
    if (email) {
      results.push({
        userId: admin.id,
        email,
        displayName: admin.displayName,
      });
    }
  }
  return results;
}

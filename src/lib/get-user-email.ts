import { createSupabaseServiceClient } from "@directoryone/core/auth";

export async function getUserEmail(userId: string): Promise<string | null> {
  const supabase = createSupabaseServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await supabase.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

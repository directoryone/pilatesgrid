import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@directoryone/core/auth";

export async function createClient() {
  const cookieStore = await cookies();
  return createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookieStore
  );
}

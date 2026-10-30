import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

let client: ReturnType<typeof createClient<Database>> | undefined;

export function supabaseBrowser() {
  client ??= createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}

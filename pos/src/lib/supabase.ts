import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/** Browser client with the public (publishable/anon) key. Everything privileged runs in the database or Edge Functions. */
export function sb() {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export class RpcError extends Error {
  hint: string | null;
  code: string | null;
  constructor(message: string, hint: string | null, code: string | null) {
    super(message);
    this.hint = hint;
    this.code = code;
  }
}

/** Calls a pos_* database function; failures come back as RpcError with the database's message and hint. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) {
    const offline = !navigator.onLine || /fetch|network/i.test(error.message);
    throw new RpcError(offline ? "No connection. Nothing was saved; try again when you're back online." : error.message,
      offline ? "offline" : error.hint ?? null, error.code ?? null);
  }
  return data as T;
}

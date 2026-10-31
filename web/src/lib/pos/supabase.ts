import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loginPath } from "@/lib/paths";

/**
 * The Hub's browser client (one login, one session). POS tables and functions are not in the Hub's generated
 * Database types yet, so the till uses it untyped. Everything privileged runs in the database or Edge Functions.
 */
export function sb() {
  return supabaseBrowser() as unknown as SupabaseClient;
}

/** The login page the till sends people to: clinic staff use the retailer page, Frido ops the team page. */
export const tillLogin = (isOps?: boolean) => `${loginPath(isOps ? "admin" : "retailer")}?next=/till/`;

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

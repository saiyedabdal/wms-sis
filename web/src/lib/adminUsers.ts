import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg } from "@/lib/format";

/** Calls the admin-create-user Edge Function; non-2xx responses carry the reason in the JSON body. */
export async function adminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseBrowser().functions.invoke("admin-create-user", {
    body: { redirect_to: `${window.location.origin}/reset-password/`, ...body },
  });
  if (error) {
    const reason = (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error;
    throw new Error(reason ?? errMsg(error));
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

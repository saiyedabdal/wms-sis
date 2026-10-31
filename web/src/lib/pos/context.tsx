"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { rpc, sb, tillLogin, RpcError } from "./supabase";
import type { PosContext, Register, StaffSession } from "./types";

/**
 * Till state shared by every POS screen: the signed-in device user, the facility and till (register) this device is,
 * who is selling right now (PIN-switch token), the open shift, and the connection state.
 */
interface Pos {
  session: Session | null;
  ctx: PosContext | null;
  loading: boolean;
  error: string | null;
  facilityId: number | null;
  register: Register | null;
  staff: StaffSession | null;
  online: boolean;
  setFacility: (id: number) => void;
  setRegister: (id: number | null) => void;
  setStaff: (s: StaffSession | null) => void;
  refresh: () => Promise<void>;
  /** rpc() that drops the staff session when the database says the PIN token has expired */
  call: <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  signOut: () => Promise<void>;
}

const PosCtx = createContext<Pos | null>(null);
export const usePos = () => {
  const v = useContext(PosCtx);
  if (!v) throw new Error("usePos outside PosProvider");
  return v;
};

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function PosProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [ctx, setCtx] = useState<PosContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [registerId, setRegisterId] = useState<number | null>(null);
  const [staff, setStaffState] = useState<StaffSession | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    sb().auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = sb().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // quiet reloads (after a sale, opening/closing a shift) keep the current screen mounted
  const load = useCallback(async (fac: number | null, quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const c = await rpc<PosContext>("pos_context", fac ? { p_facility_id: fac } : {});
      const chosen = c.facility?.id ?? (c.facilities.length === 1 ? c.facilities[0].id : null);
      if (!c.facility && chosen) {
        setCtx(await rpc<PosContext>("pos_context", { p_facility_id: chosen }));
        setFacilityId(chosen);
      } else {
        setCtx(c);
        setFacilityId(c.facility?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // boot: restore this device's facility / till / staff
  useEffect(() => {
    if (!authReady) return;
    if (!session) { setLoading(false); return; }
    // Outward → "Open till" passes the Hub's facility as ?facility=; it becomes this device's till facility
    const url = new URL(window.location.href);
    const fromHub = Number(url.searchParams.get("facility")) || null;
    if (fromHub) {
      ls.set("pos.facility", String(fromHub));
      url.searchParams.delete("facility");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    const fac = fromHub ?? (Number(ls.get("pos.facility")) || null);
    setRegisterId(Number(ls.get("pos.register")) || null);
    load(fac);
  }, [authReady, session, load]);

  useEffect(() => {
    if (!facilityId) return;
    const raw = ls.get(`pos.staff.${facilityId}`);
    const s = raw ? (JSON.parse(raw) as StaffSession) : null;
    setStaffState(s && new Date(s.expires_at) > new Date() ? s : null);
  }, [facilityId]);

  const register = useMemo(() => ctx?.registers.find((r) => r.id === registerId) ?? (ctx?.registers.length === 1 ? ctx.registers[0] : null),
    [ctx, registerId]);

  const setStaff = useCallback((s: StaffSession | null) => {
    setStaffState(s);
    if (facilityId) ls.set(`pos.staff.${facilityId}`, s ? JSON.stringify(s) : null);
  }, [facilityId]);

  const call = useCallback(async <T,>(fn: string, args: Record<string, unknown> = {}) => {
    try {
      return await rpc<T>(fn, args);
    } catch (e) {
      if (e instanceof RpcError && e.hint === "pin_required") setStaff(null);
      throw e;
    }
  }, [setStaff]);

  // ---------------------------------------------------------------- connectivity (Decision 7: log every outage)
  const outageStart = useRef<string | null>(null);
  useEffect(() => {
    const flush = async () => {
      const q = JSON.parse(ls.get("pos.outages") || "[]");
      if (!q.length || !facilityId) return;
      try {
        await rpc("pos_log_connectivity", { p_facility_id: facilityId, p_register_id: register?.id ?? null, p_events: q });
        ls.set("pos.outages", "[]");
      } catch { /* try again next time */ }
    };
    const up = () => {
      setOnline(true);
      if (outageStart.current) {
        const q = JSON.parse(ls.get("pos.outages") || "[]");
        q.push({ started_at: outageStart.current, ended_at: new Date().toISOString(), context: location.pathname });
        ls.set("pos.outages", JSON.stringify(q.slice(-200)));
        outageStart.current = null;
      }
      flush();
    };
    const down = () => { setOnline(false); outageStart.current ??= new Date().toISOString(); };
    setOnline(navigator.onLine);
    if (!navigator.onLine) down();
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    flush();
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [facilityId, register?.id]);

  const value: Pos = {
    session, ctx, loading: loading || !authReady, error, facilityId, register, staff, online,
    setFacility: (id) => { ls.set("pos.facility", String(id)); load(id); },
    setRegister: (id) => { ls.set("pos.register", id ? String(id) : null); setRegisterId(id); },
    setStaff,
    refresh: () => load(facilityId, true),
    call,
    signOut: async () => {
      if (staff) await rpc("pos_pin_logout", { p_token: staff.token }).catch(() => {});
      setStaff(null);
      await sb().auth.signOut();
      location.href = tillLogin(ctx?.user.is_ops);
    },
  };
  return <PosCtx.Provider value={value}>{children}</PosCtx.Provider>;
}

/** Limits that apply to whoever is selling right now. */
export function discountAllowance(ctx: PosContext | null, staff: StaffSession | null) {
  if (!ctx?.settings || !staff) return 0;
  return staff.staff.pos_role === "cashier" ? ctx.settings.cashier_max_disc_pct
    : staff.staff.pos_role === "manager" ? ctx.settings.manager_max_disc_pct : 100;
}

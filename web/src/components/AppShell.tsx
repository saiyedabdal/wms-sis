"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RiArchiveLine,
  RiArrowGoBackLine,
  RiBarChartBoxLine,
  RiBuilding2Line,
  RiClipboardLine,
  RiCloseLine,
  RiDashboardLine,
  RiGiftLine,
  RiInboxArchiveLine,
  RiListCheck3,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiPriceTag3Line,
  RiShoppingBag3Line,
  RiTeamLine,
} from "@remixicon/react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Facility, Profile } from "@/lib/types";
import { cx } from "./ui";

interface AppCtx {
  profile: Profile;
  facilities: Facility[];
  isOps: boolean;
  isAdmin: boolean;
  /** Facility the user is working in (ops can switch; staff are fixed to theirs). */
  facility: Facility | null;
  setFacilityId: (id: number) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppShell");
  return v;
}

const NAV: { href: string; label: string; icon: typeof RiDashboardLine; ops?: boolean; admin?: boolean }[] = [
  { href: "/", label: "Dashboard", icon: RiDashboardLine },
  { href: "/requests", label: "Order requests", icon: RiClipboardLine, ops: true },
  { href: "/receive", label: "Receive", icon: RiInboxArchiveLine },
  { href: "/sales", label: "Sales", icon: RiShoppingBag3Line },
  { href: "/stock", label: "Stock", icon: RiArchiveLine },
  { href: "/stock/count", label: "Stock count", icon: RiListCheck3 },
  { href: "/stock/issue", label: "Issue (training/demo)", icon: RiGiftLine },
  { href: "/returns", label: "Returns to WH", icon: RiArrowGoBackLine },
  { href: "/reports", label: "Reports", icon: RiBarChartBoxLine },
  { href: "/facilities", label: "Facilities", icon: RiBuilding2Line, ops: true },
  { href: "/items", label: "Item master", icon: RiPriceTag3Line, ops: true },
  { href: "/users", label: "Users", icon: RiTeamLine, admin: true },
];

export function AppShell({ profile, facilities, children }: { profile: Profile; facilities: Facility[]; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = profile.role === "admin";
  const isOps = isAdmin || profile.role === "ops";
  const [open, setOpen] = useState(false);
  const stockFacilities = useMemo(() => facilities.filter((f) => f.type !== "warehouse" && f.is_active), [facilities]);
  const [facilityId, setFacilityIdState] = useState<number | null>(isOps ? null : profile.facility_id);

  useEffect(() => {
    if (!isOps) return;
    let saved: number | null = null;
    try {
      saved = Number(localStorage.getItem("wms.facility")) || null;
    } catch {}
    const valid = stockFacilities.find((f) => f.id === saved) ?? stockFacilities[0];
    setFacilityIdState(valid?.id ?? null);
  }, [isOps, stockFacilities]);

  const setFacilityId = (id: number) => {
    setFacilityIdState(id);
    try {
      localStorage.setItem("wms.facility", String(id));
    } catch {}
  };

  useEffect(() => setOpen(false), [pathname]);

  const facility = facilities.find((f) => f.id === facilityId) ?? null;
  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || (pathname.startsWith(href + "/") && !NAV.some((n) => n.href !== href && n.href.startsWith(href + "/") && pathname.startsWith(n.href)));

  return (
    <Ctx.Provider value={{ profile, facilities, isOps, isAdmin, facility, setFacilityId }}>
      <div className="min-h-screen md:flex">
        <aside
          className={cx(
            "no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-ink text-white transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-5 py-5">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-2xl font-bold lowercase tracking-tight">frido</span>
              <span className="rounded-xs bg-yellow px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink">WMS</span>
            </Link>
            <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
              <RiCloseLine />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3">
            {NAV.filter((n) => (!n.ops || isOps) && (!n.admin || isAdmin)).map((n) => {
              const active = isActive(n.href);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cx(
                    "mb-0.5 flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                    active ? "bg-yellow font-semibold text-ink" : "text-n500 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon size={18} />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-white/10 p-4">
            <p className="truncate text-sm font-medium">{profile.full_name || profile.email}</p>
            <p className="text-xs capitalize text-n700">{profile.role.replace("_", " ")}</p>
            <button onClick={signOut} className="mt-3 flex items-center gap-2 text-xs text-n600 hover:text-white">
              <RiLogoutBoxRLine size={14} /> Sign out
            </button>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-ink/40 md:hidden" onClick={() => setOpen(false)} />}

        <div className="min-w-0 flex-1">
          <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-n300 bg-white/95 px-5 backdrop-blur md:px-8">
            <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <RiMenuLine />
            </button>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-n800">Facility</span>
            {isOps ? (
              <select
                value={facilityId ?? ""}
                onChange={(e) => setFacilityId(Number(e.target.value))}
                className="h-9 min-w-0 max-w-[60vw] rounded-xs border border-n500 bg-white px-2 text-sm font-medium focus:border-ink focus:outline-none"
              >
                {stockFacilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · {f.code}
                  </option>
                ))}
              </select>
            ) : (
              <span className="truncate text-sm font-semibold">{facility ? `${facility.name} · ${facility.code}` : "No facility assigned"}</span>
            )}
          </header>
          <main className="mx-auto max-w-7xl px-5 py-8 md:px-8">
            {!isOps && !facility ? (
              <div className="rounded-lg border border-y75 bg-y50 p-6 text-sm">
                Your login is not linked to a facility yet. Ask an admin to assign you on the Users page.
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RiAddBoxLine,
  RiArchiveLine,
  RiArrowGoBackLine,
  RiBarChartBoxLine,
  RiBuilding2Line,
  RiCheckboxCircleLine,
  RiCloseLine,
  RiDashboardLine,
  RiGiftLine,
  RiInboxArchiveLine,
  RiLineChartLine,
  RiListCheck3,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiPriceTag3Line,
  RiRouteLine,
  RiShoppingBag3Line,
  RiTeamLine,
  RiUserAddLine,
  RiTruckLine,
} from "@remixicon/react";
import { loginPath } from "@/lib/paths";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Facility, Profile, Role } from "@/lib/types";
import { Brand } from "./Brand";
import { cx } from "./ui";

/** Who is looking: Frido (admin / manager / ops), a retailer's staff, or a super stockist's staff. */
export type Audience = "frido" | "retailer" | "ss";

/** The screens a super admin can switch to. Only what is shown changes; their data access stays super admin. */
export type View = "admin" | "manager" | "ops" | "retailer" | "ss";
const VIEWS: { value: View; label: string; role: Role }[] = [
  { value: "admin", label: "Admin", role: "super_admin" },
  { value: "manager", label: "Manager", role: "manager" },
  { value: "ops", label: "Frido ops", role: "ops" },
  { value: "retailer", label: "Retailer", role: "facility_staff" },
  { value: "ss", label: "Super stockist", role: "facility_staff" },
];

interface AppCtx {
  profile: Profile;
  facilities: Facility[];
  isOps: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isSuperAdmin: boolean;
  /** The view a super admin picked; "admin" for everyone else. */
  view: View;
  audience: Audience;
  /** Facility the user is working in (Frido can switch; staff are fixed to theirs). */
  facility: Facility | null;
  setFacilityId: (id: number) => void;
  /** Re-read facilities after one is created or edited. */
  reloadFacilities: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppShell");
  return v;
}

type Badge = "approvals" | "fulfilment" | "onboarding";
interface NavItem {
  href: string;
  label: string;
  icon: typeof RiDashboardLine;
  step?: number;
  who: Audience[];
  admin?: boolean;
  badge?: Badge;
}

const ALL: Audience[] = ["frido", "retailer", "ss"];

// The left nav follows a product's lifecycle (steps 1-8), then supporting modules.
const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: "/", label: "Overview", icon: RiDashboardLine, who: ALL }] },
  {
    title: "Product flow",
    items: [
      { step: 1, href: "/receive", label: "Inward", icon: RiInboxArchiveLine, who: ALL },
      { step: 2, href: "/reports", label: "Inward analytics", icon: RiBarChartBoxLine, who: ["frido"] },
      { step: 3, href: "/sales", label: "Outward", icon: RiShoppingBag3Line, who: ALL },
      { step: 4, href: "/stock", label: "Stock & reconcile", icon: RiArchiveLine, who: ALL },
      { step: 5, href: "/demand", label: "Demand planning", icon: RiLineChartLine, who: ["frido"] },
      { step: 5, href: "/requests/new", label: "Request stock", icon: RiAddBoxLine, who: ["retailer", "ss"] },
      { step: 6, href: "/approvals", label: "Approvals", icon: RiCheckboxCircleLine, who: ["frido"], badge: "approvals" },
      { step: 7, href: "/fulfilment", label: "Fulfilment", icon: RiTruckLine, who: ["frido", "ss"], badge: "fulfilment" },
      { step: 8, href: "/requests", label: "Tracking", icon: RiRouteLine, who: ALL },
    ],
  },
  {
    title: "Modules",
    items: [
      { href: "/stock/count", label: "Stock count", icon: RiListCheck3, who: ALL },
      { href: "/returns", label: "Returns", icon: RiArrowGoBackLine, who: ALL },
      { href: "/stock/issue", label: "Issue", icon: RiGiftLine, who: ALL },
      { href: "/items", label: "Categorisation", icon: RiPriceTag3Line, who: ["frido"] },
      { href: "/reports", label: "Reports", icon: RiBarChartBoxLine, who: ["retailer", "ss"] },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/facilities", label: "Facilities", icon: RiBuilding2Line, who: ["frido"] },
      { href: "/onboarding", label: "Onboarding", icon: RiUserAddLine, who: ["frido"], admin: true, badge: "onboarding" },
      { href: "/users", label: "Users", icon: RiTeamLine, who: ["frido"], admin: true },
    ],
  },
];

const ALL_HREFS = NAV.flatMap((g) => g.items.map((i) => i.href));

export function AppShell({
  profile,
  facilities,
  reloadFacilities,
  children,
}: {
  profile: Profile;
  facilities: Facility[];
  reloadFacilities: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isSuperAdmin = profile.role === "super_admin";
  // the shell only renders in the browser (after the session check), so localStorage is safe to read here
  const [view, setViewState] = useState<View>(() => {
    if (!isSuperAdmin) return "admin";
    try {
      const saved = localStorage.getItem("wms.view");
      if (VIEWS.some((v) => v.value === saved)) return saved as View;
    } catch {}
    return "admin";
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem("wms.view", v);
    } catch {}
    // start each view from its Overview: the page open now may not exist in the other role's menu
    if (pathname !== "/") router.push("/");
  };

  // everything below works off the role being viewed, so a super admin sees exactly what that role sees
  const role = isSuperAdmin ? VIEWS.find((v) => v.value === view)!.role : profile.role;
  const isAdmin = role === "super_admin" || role === "admin";
  const isManager = isAdmin || role === "manager";
  const isOps = isManager || role === "ops";
  // field sales switch between the retailers / SS assigned to them (Facilities → Details → Assigned Frido team)
  const isFieldSales = profile.role === "field_sales";
  const [assigned, setAssigned] = useState<number[]>([]);
  useEffect(() => {
    if (!isFieldSales) return;
    supabaseBrowser()
      .from("facility_ops")
      .select("facility_id")
      .eq("user_id", profile.id)
      .then(({ data }) => setAssigned((data ?? []).map((x) => x.facility_id)));
  }, [isFieldSales, profile.id]);
  const canPickFacility = isOps || isSuperAdmin || isFieldSales;
  const [open, setOpen] = useState(false);
  const stockFacilities = useMemo(() => {
    const active = facilities.filter((f) => f.type !== "warehouse" && f.is_active);
    if (isOps) return active;
    if (isFieldSales) return active.filter((f) => assigned.includes(f.id));
    return active.filter((f) => (view === "ss" ? f.type === "super_stockist" : f.type !== "super_stockist"));
  }, [facilities, isOps, isFieldSales, assigned, view]);
  const [facilityId, setFacilityIdState] = useState<number | null>(canPickFacility ? null : profile.facility_id);

  useEffect(() => {
    if (!canPickFacility) return;
    let saved: number | null = null;
    try {
      saved = Number(localStorage.getItem("wms.facility")) || null;
    } catch {}
    const valid = stockFacilities.find((f) => f.id === saved) ?? stockFacilities[0];
    setFacilityIdState(valid?.id ?? null);
  }, [canPickFacility, stockFacilities]);

  const setFacilityId = (id: number) => {
    setFacilityIdState(id);
    try {
      localStorage.setItem("wms.facility", String(id));
    } catch {}
  };

  useEffect(() => setOpen(false), [pathname]);

  const facility = facilities.find((f) => f.id === facilityId) ?? null;
  const audience: Audience = isOps ? "frido" : facility?.type === "super_stockist" ? "ss" : "retailer";
  const [badges, setBadges] = useState<Record<Badge, number>>({ approvals: 0, fulfilment: 0, onboarding: 0 });

  // counts shown next to Approvals / Fulfilment, refreshed on navigation
  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const next: Record<Badge, number> = { approvals: 0, fulfilment: 0, onboarding: 0 };
      if (isAdmin) {
        const { count } = await sb.from("vendor_applications").select("id", { count: "exact", head: true }).eq("status", "pending");
        next.onboarding = count ?? 0;
      }
      if (isOps) {
        const statuses = isManager ? ["pending_approval"] : ["submitted"];
        const { count } = await sb.from("order_requests").select("id", { count: "exact", head: true }).in("status", statuses as never);
        next.approvals = count ?? 0;
      }
      let fo = sb.from("fulfilment_orders").select("id", { count: "exact", head: true }).in("status", ["open", "partially_dispatched"]);
      if (!isOps && facility) fo = fo.eq("fulfiller_id", facility.id);
      if (isOps || audience === "ss") {
        const { count } = await fo;
        next.fulfilment = count ?? 0;
      }
      setBadges(next);
    })();
  }, [pathname, isOps, isManager, isAdmin, audience, facility]);
  // back to the login page this person uses (the app layout reads it when the session ends)
  const signOut = async () => {
    const own = facilities.find((f) => f.id === profile.facility_id);
    const portal = profile.role !== "facility_staff" ? "admin" : own?.type === "super_stockist" ? "super_stockist" : "retailer";
    try {
      sessionStorage.setItem("wms.loginPath", loginPath(portal));
    } catch {}
    await supabaseBrowser().auth.signOut();
  };

  // the most specific nav href that matches the current path wins
  const path = pathname.replace(/\/$/, "") || "/";
  const activeHref = ALL_HREFS.filter((h) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/"))).sort((a, b) => b.length - a.length)[0];

  return (
    <Ctx.Provider value={{ profile, facilities, isOps, isAdmin, isManager, isSuperAdmin, view, audience, facility, setFacilityId, reloadFacilities }}>
      <div className="min-h-screen md:flex">
        <aside
          className={cx(
            "no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-ink text-white transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-5 py-5">
            <Link href="/">
              <Brand />
            </Link>
            <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
              <RiCloseLine />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-4">
            {NAV.map((group, gi) => {
              const items = group.items.filter((n) => n.who.includes(audience) && (!n.admin || isAdmin));
              if (!items.length) return null;
              return (
                <div key={gi} className={gi ? "mt-4" : ""}>
                  {group.title && <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-n800">{group.title}</p>}
                  {items.map((n) => {
                    const active = n.href === activeHref;
                    const Icon = n.icon;
                    const count = n.badge ? badges[n.badge] : 0;
                    return (
                      <Link
                        key={n.href + n.label}
                        href={n.href}
                        className={cx(
                          "mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                          active ? "bg-yellow font-semibold text-ink" : "text-n500 hover:bg-white/10 hover:text-white",
                        )}
                      >
                        {n.step ? (
                          <span
                            className={cx(
                              "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                              active ? "bg-ink text-yellow" : "bg-white/10 text-n500",
                            )}
                          >
                            {n.step}
                          </span>
                        ) : (
                          <Icon size={18} className="shrink-0" />
                        )}
                        <span className="flex-1 truncate">{n.label}</span>
                        {count > 0 && (
                          <span className={cx("rounded-full px-1.5 text-[11px] font-bold", active ? "bg-ink text-yellow" : "bg-yellow text-ink")}>{count}</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <div className="border-t border-white/10 p-4">
            <p className="truncate text-sm font-medium">{profile.full_name || profile.email}</p>
            <p className="text-xs capitalize text-n700">
              {profile.role.replace("_", " ")}
              {isSuperAdmin && view !== "admin" && ` · viewing as ${VIEWS.find((v) => v.value === view)!.label.toLowerCase()}`}
            </p>
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
            {isSuperAdmin && (
              <>
                <span className="hidden text-[11px] font-semibold uppercase tracking-wider text-n800 sm:inline">View as</span>
                <select
                  value={view}
                  onChange={(e) => setView(e.target.value as View)}
                  aria-label="View as"
                  className={cx(
                    "h-9 min-w-0 max-w-[40vw] rounded-xs border px-2 text-sm font-medium focus:border-ink focus:outline-none",
                    view === "admin" ? "border-n500 bg-white" : "border-ink bg-yellow",
                  )}
                >
                  {VIEWS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            <span className="hidden text-[11px] font-semibold uppercase tracking-wider text-n800 sm:inline">Facility</span>
            {canPickFacility && stockFacilities.length > 0 ? (
              <select
                value={facilityId ?? ""}
                onChange={(e) => setFacilityId(Number(e.target.value))}
                aria-label="Facility"
                className="h-9 min-w-0 max-w-[60vw] rounded-xs border border-n500 bg-white px-2 text-sm font-medium focus:border-ink focus:outline-none"
              >
                {stockFacilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · {f.code}
                  </option>
                ))}
              </select>
            ) : (
              <span className="truncate text-sm font-semibold">{facility ? `${facility.name} · ${facility.code}` : "No facility"}</span>
            )}
          </header>
          {isSuperAdmin && view !== "admin" && (
            <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-y75 bg-y50 px-5 py-2 text-sm md:px-8">
              <span>
                You&apos;re seeing the <span className="font-semibold">{VIEWS.find((v) => v.value === view)!.label}</span> screens
                {facility && !isOps ? ` for ${facility.name}` : ""}. Anything you do is still saved under your own login.
              </span>
              <button onClick={() => setView("admin")} className="font-semibold underline">
                Back to admin view
              </button>
            </div>
          )}
          <main className="mx-auto max-w-7xl px-5 py-8 md:px-8">
            {!isOps && !facility ? (
              <div className="rounded-lg border border-y75 bg-y50 p-6 text-sm">
                {isSuperAdmin
                  ? `There is no active ${view === "ss" ? "super stockist" : "retailer or store"} facility yet. Create one under Facilities in the admin view, then come back.`
                  : isFieldSales
                    ? "No retailers are assigned to you yet. Ask an admin to add you under Facilities → a facility → Details → Assigned Frido team."
                    : "Your login is not linked to a facility yet. Ask an admin to assign you on the Users page."}
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

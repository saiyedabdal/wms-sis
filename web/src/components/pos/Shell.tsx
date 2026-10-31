"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { RiApps2Line, RiBarChartBoxLine, RiFileList3Line, RiLogoutBoxRLine, RiMoneyRupeeCircleLine, RiSettings3Line, RiShoppingBag3Line,
  RiStore2Line, RiUserSharedLine, RiWifiOffLine } from "@remixicon/react";
import { usePos } from "@/lib/pos/context";
import { time } from "@/lib/pos/format";
import { PinPad } from "./PinPad";
import { Alert, Button, Card, Spinner, ToastHost, cx } from "./ui";
import type { StaffSession } from "@/lib/pos/types";
import { tillLogin } from "@/lib/pos/supabase";

const NAV = [
  { href: "/till/", label: "Sell", icon: RiShoppingBag3Line },
  { href: "/till/invoices/", label: "Invoices", icon: RiFileList3Line },
  { href: "/till/cash/", label: "Cash", icon: RiMoneyRupeeCircleLine },
  { href: "/till/reports/", label: "Reports", icon: RiBarChartBoxLine },
  { href: "/till/admin/", label: "Admin", icon: RiSettings3Line },
];

/** Where "exit till" goes: the Outward module of the Frido CDN. */
export const HUB_HOME = "/sales/";

export function Logo({ className }: { className?: string }) {
  return <span className={cx("text-2xl font-bold lowercase tracking-tight", className)}>frido<span className="text-yellow">.</span></span>;
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-n100 p-6">
      <Logo className="text-4xl" />
      {children}
      <Link href={HUB_HOME} className="text-sm font-medium text-n800 hover:text-ink">← Back to Frido CDN</Link>
    </div>
  );
}

export function useSwitchStaff() {
  const { ctx, register, facilityId, call, setStaff } = usePos();
  return async (userId: string, pin: string) => {
    const r = await call<{ ok: boolean; error?: string } & StaffSession>("pos_pin_login",
      { p_facility_id: facilityId, p_register_id: register?.id ?? null, p_user_id: userId, p_pin: pin });
    if (!r.ok) return r.error ?? "Could not sign in";
    setStaff({ token: r.token, expires_at: r.expires_at, staff: r.staff });
    void ctx;
    return null;
  };
}

export function Shell({ children }: { children: ReactNode }) {
  const pos = usePos();
  const router = useRouter();
  const path = usePathname();
  const [switching, setSwitching] = useState(false);
  const switchStaff = useSwitchStaff();
  const adminWithoutTill = path.startsWith("/till/admin") && pos.ctx?.user.is_ops;

  useEffect(() => {
    if (!pos.loading && !pos.session) router.replace(tillLogin());
  }, [pos.loading, pos.session, router]);

  if (pos.loading || !pos.session) return <Splash><Spinner className="h-8 w-8" /></Splash>;
  if (pos.error || !pos.ctx)
    return (
      <Splash>
        <Card className="w-full max-w-md">
          <Alert>{pos.error ?? "Could not load the till"}</Alert>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => pos.refresh()}>Try again</Button>
            <Button variant="ghost" onClick={() => pos.signOut()}>Sign out</Button>
          </div>
        </Card>
      </Splash>
    );
  const { ctx } = pos;

  if (!ctx.facility && !adminWithoutTill)
    return (
      <Splash>
        <Card title="Which clinic is this till at?" className="w-full max-w-md">
          {ctx.facilities.length === 0 ? (
            <p className="text-sm text-n800">No clinic is on the POS yet. {ctx.user.is_ops ? <Link className="font-semibold underline" href="/till/admin/">Set one up</Link> : "Ask Frido to set yours up."}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {ctx.facilities.map((f) => (
                <Button key={f.id} variant="secondary" size="lg" className="justify-start" onClick={() => pos.setFacility(f.id)}>
                  <RiStore2Line /> {f.name} <span className="ml-auto text-xs text-n800">{f.code}</span>
                </Button>
              ))}
            </div>
          )}
        </Card>
      </Splash>
    );

  if (ctx.facility && !ctx.settings && !adminWithoutTill)
    return (
      <Splash>
        <Card className="w-full max-w-md">
          <p className="font-semibold">{ctx.facility.name} is not on the POS yet.</p>
          <p className="mt-1 text-sm text-n800">A Frido admin sets the invoicing entity, invoice series and payment modes first.</p>
          <div className="mt-4 flex gap-2">
            {ctx.user.is_ops && <Button onClick={() => router.push("/till/admin/")}>Open setup</Button>}
            <Button variant="ghost" onClick={() => pos.signOut()}>Sign out</Button>
          </div>
        </Card>
      </Splash>
    );

  if (ctx.settings && !pos.register && !adminWithoutTill)
    return (
      <Splash>
        <Card title={`Which till is this? · ${ctx.facility?.name}`} className="w-full max-w-md">
          {ctx.registers.length === 0 ? <p className="text-sm text-n800">No tills yet. A Frido admin adds them under Admin → Setup.</p> : (
            <div className="flex flex-col gap-2">
              {ctx.registers.map((r) => (
                <Button key={r.id} variant="secondary" size="lg" className="justify-start" onClick={() => pos.setRegister(r.id)}>
                  {r.name} <span className="ml-auto text-xs normal-case text-n800">{r.open_shift ? "shift open" : "closed"}</span>
                </Button>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-n800">This device remembers its till.</p>
        </Card>
      </Splash>
    );

  const needStaff = !pos.staff && !adminWithoutTill;
  const shift = pos.register?.open_shift;

  return (
    <ToastHost>
      <div className="flex min-h-screen flex-col pb-16 md:pb-0">
        <header className="no-print sticky top-0 z-40 bg-ink text-white">
          <div className="flex h-16 items-center gap-3 px-4 lg:px-6">
            <Link href="/till/" className="flex items-baseline gap-2"><Logo className="text-white" /><span className="hidden text-xs font-semibold uppercase tracking-wider text-yellow sm:inline">POS</span></Link>
            <div className="ml-2 hidden min-w-0 border-l border-white/20 pl-4 sm:block">
              <div className="truncate text-sm font-semibold">{ctx.facility?.name ?? "Frido admin"}</div>
              <div className="truncate text-xs text-n600">
                {pos.register?.name ?? "No till"}{shift ? ` · shift open since ${time(shift.opened_at)}` : pos.register ? " · shift closed" : ""}
              </div>
            </div>
            <nav className="ml-4 hidden flex-1 items-center gap-1 md:flex">
              {NAV.map((n) => {
                const active = n.href === "/till/" ? path === "/till" || path === "/till/" : path.startsWith(n.href.slice(0, -1));
                return (
                  <Link key={n.href} href={n.href}
                    className={cx("flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition",
                      active ? "bg-yellow text-ink" : "text-n500 hover:bg-white/10 hover:text-white")}>
                    <n.icon className="h-4 w-4" /> {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {!pos.online && <span className="flex items-center gap-1 rounded-full bg-red-b px-3 py-1 text-xs font-semibold"><RiWifiOffLine className="h-4 w-4" /> Offline</span>}
              {pos.staff && (
                <button onClick={() => setSwitching(true)} className="flex h-11 items-center gap-2 rounded-full bg-white/10 pl-1 pr-3 text-left hover:bg-white/20">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow text-sm font-bold text-ink">{pos.staff.staff.display_name.slice(0, 1)}</span>
                  <span className="hidden leading-tight lg:block">
                    <span className="block text-sm font-semibold">{pos.staff.staff.display_name}</span>
                    <span className="block text-[11px] capitalize text-n600">{pos.staff.staff.pos_role} · switch</span>
                  </span>
                  <RiUserSharedLine className="h-4 w-4 lg:hidden" />
                </button>
              )}
              <Link href={HUB_HOME} title="Exit till mode and go back to Frido CDN" aria-label="Exit till"
                className="flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-n500 hover:bg-white/10 hover:text-white">
                <RiApps2Line className="h-5 w-5" /><span className="hidden xl:inline">Frido CDN</span></Link>
              <button onClick={() => pos.signOut()} title="Sign out this device" aria-label="Sign out"
                className="flex h-11 w-11 items-center justify-center rounded-md text-n500 hover:bg-white/10 hover:text-white"><RiLogoutBoxRLine className="h-5 w-5" /></button>
            </div>
          </div>
          {!pos.online && (
            <div className="bg-yellow px-4 py-2 text-center text-sm font-medium text-ink">
              No connection. Keep building the cart; checkout waits until you&apos;re back online. Nothing is lost.
            </div>
          )}
        </header>

        <main className="flex-1">{needStaff ? null : children}</main>

        <nav className="no-print fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-n300 bg-white md:hidden">
          {NAV.map((n) => {
            const active = n.href === "/till/" ? path === "/till" || path === "/till/" : path.startsWith(n.href.slice(0, -1));
            return (
              <Link key={n.href} href={n.href} className={cx("flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-ink" : "text-n800")}>
                <n.icon className={cx("h-5 w-5", active && "text-ink")} />{n.label}
                {active && <span className="h-1 w-6 rounded-full bg-yellow" />}
              </Link>
            );
          })}
        </nav>
      </div>

      <PinPad open={needStaff || switching} dismissable={!needStaff} onClose={() => setSwitching(false)}
        title={needStaff ? "Who's at the till?" : "Switch staff"}
        subtitle={needStaff ? <>Every sale is recorded against the person who makes it. Pick your name and enter your PIN.</> : "The next sale will be recorded against the person who signs in."}
        staff={ctx.staff}
        emptyText={ctx.user.is_ops
          ? <>Nobody is on {ctx.facility?.name ?? "this clinic"}&apos;s POS staff list yet.{" "}
              <button type="button" className="font-semibold underline" onClick={() => router.push("/till/admin/")}>Add people in Admin → Staff &amp; PINs</button></>
          : <>You&apos;re not on this clinic&apos;s POS staff list yet. Ask a Frido admin to add you under Admin → Staff &amp; PINs.</>}
        onSubmit={async (u, p) => { const e = await switchStaff(u, p); if (!e) setSwitching(false); return e; }}>
        {needStaff && (
          <div className="-mt-2 mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-n800">
            <span>Device signed in as {ctx.user.email}.</span>
            <Link href={HUB_HOME} className="font-semibold text-ink underline">Back to Frido CDN</Link>
          </div>
        )}
      </PinPad>
    </ToastHost>
  );
}

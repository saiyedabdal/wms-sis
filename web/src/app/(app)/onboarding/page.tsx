"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/components/AppShell";
import { Alert, Badge, Button, Card, CopyBlock, Empty, Field, Input, PageHeader, Select, Tabs } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { adminUsers } from "@/lib/adminUsers";
import { dateTime, errMsg } from "@/lib/format";
import { loginPath, paths } from "@/lib/paths";
import type { Database } from "@/lib/database.types";

type App = Database["public"]["Tables"]["vendor_applications"]["Row"];
type Status = "pending" | "approved" | "removed";
interface Approved {
  email: string;
  email_sent: boolean;
  email_note: string | null;
  subject: string;
  message: string;
}

/** Applications from the login page: approve (facility + login with a temporary password) or remove. */
export default function OnboardingPage() {
  const { facilities, reloadFacilities } = useApp();
  const [tab, setTab] = useState<Status>("pending");
  const [apps, setApps] = useState<App[]>([]);
  const [counts, setCounts] = useState<Record<Status, number>>({ pending: 0, approved: 0, removed: 0 });
  const [open, setOpen] = useState<{ id: number; action: "approve" | "remove" } | null>(null);
  const [result, setResult] = useState<Approved | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const { data } = await sb.from("vendor_applications").select("*").order("created_at", { ascending: false }).limit(300);
    const all = data ?? [];
    setApps(all);
    setCounts({
      pending: all.filter((a) => a.status === "pending").length,
      approved: all.filter((a) => a.status === "approved").length,
      removed: all.filter((a) => a.status === "removed").length,
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const shown = apps.filter((a) => a.status === tab);
  const fname = (id: number | null) => facilities.find((f) => f.id === id);

  return (
    <>
      <PageHeader
        title="Onboarding"
        subtitle="Retailers and super stockists who asked for Frido CDN access from their login page. Approving creates their facility and a login with a temporary password, sent to their email."
      />
      {result && (
        <div className="mb-6 flex flex-col gap-3">
          <Alert tone={result.email_sent ? "green" : "yellow"}>
            {result.email_sent ? `Approved. The login details were emailed to ${result.email}.` : `Approved. ${result.email_note}`} The temporary password is
            only shown here, now.
          </Alert>
          <CopyBlock title="Approval message" to={result.email} subject={result.subject} body={result.message} />
          <div>
            <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {err && (
        <div className="mb-4">
          <Alert>{err}</Alert>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "pending", label: `Waiting · ${counts.pending}` },
          { value: "approved", label: `Approved · ${counts.approved}` },
          { value: "removed", label: `Removed · ${counts.removed}` },
        ]}
      />
      {shown.length === 0 ? (
        <Card>
          <Empty title={tab === "pending" ? "No applications waiting" : `Nothing ${tab} yet`}>
            Retailers apply at /login/retailer and super stockists at /login/ss.
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((a) => (
            <Card
              key={a.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {a.business_name}
                  <Badge tone={a.applying_as === "super_stockist" ? "black" : "yellow"}>{a.applying_as === "super_stockist" ? "Super stockist" : "Retailer"}</Badge>
                </span>
              }
              actions={<span className="text-xs text-n800">#{a.id} · {dateTime(a.created_at)}</span>}
            >
              <Details a={a} />
              {a.status === "approved" && (
                <p className="mt-4 text-sm text-n800">
                  Approved {dateTime(a.decided_at)}
                  {fname(a.facility_id) && (
                    <>
                      {" · "}
                      <Link className="font-semibold text-ink hover:underline" href={paths.facility(a.facility_id!)}>
                        {fname(a.facility_id)!.name} · {fname(a.facility_id)!.code}
                      </Link>
                    </>
                  )}
                  {" · "}
                  {a.email_sent_at ? "login emailed" : "login shared by hand"}
                </p>
              )}
              {a.status === "removed" && (
                <p className="mt-4 text-sm text-n800">
                  Removed {dateTime(a.decided_at)}
                  {a.decision_note ? ` · ${a.decision_note}` : ""}
                </p>
              )}
              {a.status === "pending" &&
                (open?.id === a.id ? (
                  open.action === "approve" ? (
                    <ApprovePanel
                      a={a}
                      onCancel={() => setOpen(null)}
                      onDone={async (r) => {
                        setOpen(null);
                        setResult(r);
                        await Promise.all([load(), reloadFacilities()]);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    />
                  ) : (
                    <RemovePanel
                      a={a}
                      onCancel={() => setOpen(null)}
                      onDone={() => {
                        setOpen(null);
                        load();
                      }}
                      onError={setErr}
                    />
                  )
                ) : (
                  <div className="mt-5 flex gap-2 border-t border-n300 pt-4">
                    <Button onClick={() => setOpen({ id: a.id, action: "approve" })}>Approve</Button>
                    <Button variant="secondary" onClick={() => setOpen({ id: a.id, action: "remove" })}>
                      Remove
                    </Button>
                  </div>
                ))}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Details({ a }: { a: App }) {
  const Item = ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-n800">{label}</p>
      <div className="mt-1 text-sm">{children || "—"}</div>
    </div>
  );
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      <Item label="Business">
        {a.business_type}
        {a.legal_name && <div className="text-n800">{a.legal_name}</div>}
        {a.gstin && <div className="text-n800">GSTIN {a.gstin}</div>}
      </Item>
      <Item label="Address">
        {a.address}
        <div className="text-n800">
          {a.city}, {a.state} {a.pincode}
        </div>
      </Item>
      <Item label="Point of contact">
        {a.poc_name}
        {a.poc_designation && <span className="text-n800"> · {a.poc_designation}</span>}
        <div className="text-n800">{a.poc_phone}</div>
        <div className="break-all text-n800">{a.poc_email}</div>
      </Item>
      <Item label="Products">
        {a.product_categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {a.product_categories.map((c) => (
              <Badge key={c}>{c}</Badge>
            ))}
          </div>
        )}
        {a.products_other && <div className="mt-1 text-n800">{a.products_other}</div>}
      </Item>
      <Item label="Maintains stock?">
        {a.maintains_stock ? (
          <>
            <span className="font-semibold">Yes</span> · {a.stock_location}
            {a.stock_tracking && <div className="text-n800">Tracked in: {a.stock_tracking}</div>}
          </>
        ) : (
          <>
            <span className="font-semibold">No</span>
            <div className="text-n800">Frido to maintain it automatically: {a.frido_manage_stock ? "Yes" : "No"}</div>
          </>
        )}
      </Item>
      {a.maintains_stock && (
        <Item label="Stock contact">
          {a.stock_poc_name}
          <div className="text-n800">{a.stock_poc_phone}</div>
          {a.stock_poc_email && <div className="break-all text-n800">{a.stock_poc_email}</div>}
        </Item>
      )}
      <Item label="Referred by">{a.referred_by}</Item>
      <Item label="Notes">{a.notes}</Item>
    </div>
  );
}

function ApprovePanel({ a, onCancel, onDone }: { a: App; onCancel: () => void; onDone: (r: Approved) => void }) {
  const { facilities } = useApp();
  const ss = facilities.filter((f) => f.type === "super_stockist" && f.is_active);
  // next free FRIDO_#### as a starting point; use the POS store ID if they already have one
  const next = Math.max(0, ...facilities.map((f) => Number(/^FRIDO_(\d+)$/.exec(f.code)?.[1] ?? 0))) + 1;
  const [form, setForm] = useState({
    code: `FRIDO_${String(next).padStart(4, "0")}`,
    name: a.business_name,
    fulfiller_ss_id: "",
    margin_pct: a.applying_as === "retailer" ? "30" : "0",
    is_consignment: true,
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await adminUsers<Approved>({
        action: "approve_application",
        application_id: a.id,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        fulfiller_ss_id: Number(form.fulfiller_ss_id) || null,
        margin_pct: Number(form.margin_pct) || 0,
        is_consignment: form.is_consignment,
        note: form.note || null,
        login_url: window.location.origin + loginPath(a.applying_as === "super_stockist" ? "super_stockist" : "retailer"),
      });
      onDone(r);
    } catch (x) {
      setErr(errMsg(x));
    }
    setBusy(false);
  };

  return (
    <form onSubmit={approve} className="mt-5 grid gap-4 border-t border-n300 pt-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Facility code" hint="Their POS store ID, if they have one">
        <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required pattern="[A-Z0-9_\-]{2,20}" />
      </Field>
      <Field label="Facility name">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </Field>
      {a.applying_as === "retailer" ? (
        <Field label="Supplied by super stockist">
          <Select value={form.fulfiller_ss_id} onChange={(e) => setForm({ ...form, fulfiller_ss_id: e.target.value })}>
            <option value="">Frido WH only</option>
            {ss.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · {f.code}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div />
      )}
      <Field label="Default margin %">
        <Input type="number" min={0} max={100} step="0.5" value={form.margin_pct} onChange={(e) => setForm({ ...form, margin_pct: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[#131313]"
          checked={form.is_consignment}
          onChange={(e) => setForm({ ...form, is_consignment: e.target.checked })}
        />
        Consignment (stock stays Frido&apos;s until sold)
      </label>
      <Field label="Note (internal)">
        <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      {err && (
        <div className="sm:col-span-2 lg:col-span-3">
          <Alert>{err}</Alert>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Approving…" : "Approve & send login"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-n800 sm:col-span-2 lg:col-span-3">
        Creates the facility (margins, assortment and planning can be set later under Facilities) and a login for {a.poc_email} with a temporary password.
      </p>
    </form>
  );
}

function RemovePanel({ a, onCancel, onDone, onError }: { a: App; onCancel: () => void; onDone: () => void; onError: (e: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("remove_vendor_application", { p_id: a.id, p_note: (note || null) as string });
    setBusy(false);
    if (error) return onError(errMsg(error));
    onDone();
  };
  return (
    <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-n300 pt-4">
      <Field label="Reason (internal, optional)" className="min-w-64 flex-1">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Duplicate, not a fit, spam…" />
      </Field>
      <Button variant="secondary" onClick={remove} disabled={busy}>
        {busy ? "Removing…" : "Remove application"}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

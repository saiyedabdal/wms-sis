"use client";

import { useIdParam } from "@/lib/paths";
import { useEffect, useMemo, useState } from "react";
import { RiDeleteBinLine } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { SkuPicker, type PickedItem } from "@/components/SkuPicker";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Select, Table, Tabs, Td, Textarea, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { BUCKETS, NON_FG_CATEGORIES, facilityTypeLabel, type Bucket } from "@/lib/types";
import { errMsg, inr, priceSplit, suspiciousMrp } from "@/lib/format";
import { downloadXlsx } from "@/lib/export";
import { FacilityForm } from "../FacilityForm";

const COMMON_CATEGORIES = ["Orthotics", "Cushions", "Pillows", "Medical Cushions", "Socks", "Footwear", "Insole", "Mobility", "Wheelchairs", "Wheelchair Accessories", "Concentrator", "Ergo Furniture", "Chair", "Mattress Topper", "Ankle Support", "Health and wellness", "Mouse Wrist", "Mask", "Covers"];

interface Row {
  sku: string;
  default_bucket: Bucket;
  msp: number | null;
  margin_pct: number | null;
  min_qty: number;
  max_qty: number;
  is_active: boolean;
  items: { name: string; category_name: string | null; size: string | null; color: string | null; mrp: number | null; gst_pct: number | null; enabled: boolean };
}

export default function FacilityDetail() {
  const id = useIdParam();
  const facilityId = Number(id);
  const { facilities } = useApp();
  const facility = facilities.find((f) => f.id === facilityId);
  const [tab, setTab] = useState<"assortment" | "margins" | "details">("assortment");

  if (!facility) return <Empty title="Facility not found" />;
  const ss = facilities.find((f) => f.id === facility.fulfiller_ss_id);
  return (
    <>
      <PageHeader
        title={facility.name}
        subtitle={[facility.code, facilityTypeLabel(facility.type), facility.region, ss && `supplied by ${ss.name}`].filter(Boolean).join(" · ")}
        back={{ href: "/facilities", label: "Facilities" }}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "assortment", label: "Assortment & prices" },
          { value: "margins", label: "Category margins" },
          { value: "details", label: "Details" },
        ]}
      />
      {tab === "details" && (
        <div className="flex flex-col gap-6">
          <AssignedOps facilityId={facilityId} />
          <FacilityForm initial={facility} />
        </div>
      )}
      {tab === "margins" && <Margins facilityId={facilityId} defaultMargin={Number(facility.default_margin_pct)} />}
      {tab === "assortment" && <Assortment facilityId={facilityId} defaultMargin={Number(facility.default_margin_pct)} />}
    </>
  );
}

function Margins({ facilityId, defaultMargin }: { facilityId: number; defaultMargin: number }) {
  const [rows, setRows] = useState<{ category_name: string; margin_pct: number }[]>([]);
  const [cat, setCat] = useState("");
  const [pct, setPct] = useState("30");
  const [err, setErr] = useState<string | null>(null);
  const sb = supabaseBrowser();
  const load = async () => {
    const { data } = await sb.from("facility_category_margins").select("category_name,margin_pct").eq("facility_id", facilityId).order("category_name");
    setRows(data ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId]);

  const upsert = async (category_name: string, margin_pct: number) => {
    setErr(null);
    const { error } = await sb.from("facility_category_margins").upsert({ facility_id: facilityId, category_name, margin_pct });
    if (error) setErr(errMsg(error));
    load();
  };
  const remove = async (category_name: string) => {
    await sb.from("facility_category_margins").delete().eq("facility_id", facilityId).eq("category_name", category_name);
    load();
  };

  return (
    <Card title="Margin by item category" actions={<span className="text-xs text-n800">Other categories use the default {defaultMargin}%</span>}>
      <p className="mb-4 text-sm text-n800">Price to partner = MSP − margin, GST inclusive (“30 + GST on MSP”). A per-SKU margin in the assortment overrides these.</p>
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <Input list="cats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Category (as in Uniware)" className="max-w-xs" />
        <datalist id="cats">
          {COMMON_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Input type="number" value={pct} onChange={(e) => setPct(e.target.value)} className="w-28" min={0} max={100} step="0.01" />
        <Button
          size="sm"
          className="h-11"
          disabled={!cat.trim()}
          onClick={() => {
            upsert(cat.trim(), Number(pct));
            setCat("");
          }}
        >
          Add / update
        </Button>
      </div>
      {err && <Alert>{err}</Alert>}
      <Table>
        <thead>
          <tr>
            <Th>Category</Th>
            <Th right>Margin %</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.category_name}>
              <Td className="font-medium">{r.category_name}</Td>
              <Td right>
                <Input
                  type="number"
                  defaultValue={r.margin_pct}
                  className="ml-auto h-9 w-24 text-right"
                  onBlur={(e) => Number(e.target.value) !== Number(r.margin_pct) && upsert(r.category_name, Number(e.target.value))}
                />
              </Td>
              <Td right>
                <button className="text-n700 hover:text-red-a" onClick={() => remove(r.category_name)} aria-label="Remove">
                  <RiDeleteBinLine size={16} />
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Assortment({ facilityId, defaultMargin }: { facilityId: number; defaultMargin: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [margins, setMargins] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [bulk, setBulk] = useState("");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const sb = supabaseBrowser();

  const load = async () => {
    const [{ data }, { data: m }] = await Promise.all([
      sb
        .from("facility_assortment")
        .select("sku,default_bucket,msp,margin_pct,min_qty,max_qty,is_active,items(name,category_name,size,color,mrp,gst_pct,enabled)")
        .eq("facility_id", facilityId)
        .order("sku"),
      sb.from("facility_category_margins").select("category_name,margin_pct").eq("facility_id", facilityId),
    ]);
    setRows((data ?? []) as unknown as Row[]);
    setMargins(Object.fromEntries((m ?? []).map((x) => [x.category_name, Number(x.margin_pct)])));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId]);

  const add = async (skus: string[]) => {
    setMsg(null);
    const fresh = skus.filter((s) => !rows.some((r) => r.sku === s));
    if (!fresh.length) return setMsg({ tone: "red", text: "Already in the assortment" });
    const { error } = await sb
      .from("facility_assortment")
      .upsert(fresh.map((sku) => ({ facility_id: facilityId, sku })), { onConflict: "facility_id,sku", ignoreDuplicates: true });
    if (error) return setMsg({ tone: "red", text: errMsg(error) });
    setMsg({ tone: "green", text: `Added ${fresh.length} SKU${fresh.length > 1 ? "s" : ""}` });
    load();
  };

  const addBulk = async () => {
    const skus = [...new Set(bulk.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
    if (!skus.length) return;
    const { data } = await sb.from("items").select("sku").in("sku", skus);
    const found = new Set((data ?? []).map((d) => d.sku));
    const missing = skus.filter((s) => !found.has(s));
    await add([...found]);
    if (missing.length) setMsg({ tone: "red", text: `Not in item master: ${missing.join(", ")}` });
    setBulk("");
  };

  const update = async (sku: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.sku === sku ? { ...r, ...patch } : r)));
    const { error } = await sb.from("facility_assortment").update(patch).eq("facility_id", facilityId).eq("sku", sku);
    if (error) setMsg({ tone: "red", text: errMsg(error) });
  };

  const remove = async (sku: string) => {
    const { error } = await sb.from("facility_assortment").delete().eq("facility_id", facilityId).eq("sku", sku);
    // once a SKU has been requested it is referenced; deactivate instead
    if (error) await update(sku, { is_active: false });
    load();
  };

  const effMargin = (r: Row) => r.margin_pct ?? margins[r.items.category_name ?? ""] ?? defaultMargin;
  const effMsp = (r: Row) => r.msp ?? r.items.mrp ?? 0;
  const shown = useMemo(() => {
    const t = filter.toLowerCase();
    return t ? rows.filter((r) => r.sku.toLowerCase().includes(t) || r.items.name.toLowerCase().includes(t)) : rows;
  }, [rows, filter]);
  const needsPrice = rows.filter((r) => r.msp == null && suspiciousMrp(r.items.mrp)).length;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Add SKUs">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm text-n800">Search the item master (finished goods only)</p>
            <SkuPicker onPick={(it: PickedItem) => add([it.sku])} excludeCategories={NON_FG_CATEGORIES} />
          </div>
          <div>
            <p className="mb-2 text-sm text-n800">Or paste SKU codes (one per line / comma separated)</p>
            <div className="flex gap-2">
              <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={2} placeholder="FR-OKCS-BLK-M1, FR-OKCS-BLK-L1" />
              <Button variant="secondary" onClick={addBulk} disabled={!bulk.trim()}>
                Add
              </Button>
            </div>
          </div>
        </div>
        {msg && (
          <div className="mt-4">
            <Alert tone={msg.tone}>{msg.text}</Alert>
          </div>
        )}
      </Card>

      {needsPrice > 0 && (
        <Alert tone="yellow">
          {needsPrice} SKU{needsPrice > 1 ? "s have" : " has"} no MSP set and Uniware shows MRP ≤ ₹50 (placeholder). Enter the MSP so POs and settlements are priced correctly.
        </Alert>
      )}

      <Card
        title={`Assortment · ${rows.filter((r) => r.is_active).length} active SKUs`}
        pad={false}
        actions={
          <>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="h-9 w-48" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                downloadXlsx(`assortment-${facilityId}`, {
                  Assortment: rows.map((r) => ({
                    SKU: r.sku,
                    Product: r.items.name,
                    Category: r.items.category_name,
                    Purpose: BUCKETS.find((b) => b.value === r.default_bucket)?.label,
                    MSP: effMsp(r),
                    "Margin %": effMargin(r),
                    "Unit price to partner": priceSplit(effMsp(r), effMargin(r), r.items.gst_pct ?? 18).unit,
                    Min: r.min_qty,
                    Max: r.max_qty,
                    Active: r.is_active ? "Yes" : "No",
                  })),
                })
              }
            >
              Export
            </Button>
          </>
        }
      >
        {shown.length === 0 ? (
          <Empty title="No SKUs yet">Add the SKUs this facility may request and sell. Each size/colour is its own SKU.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>SKU / product</Th>
                <Th>Purpose</Th>
                <Th right>MSP (₹)</Th>
                <Th right>Margin %</Th>
                <Th right>Partner price</Th>
                <Th right>Min</Th>
                <Th right>Max</Th>
                <Th>Active</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const warn = r.msp == null && suspiciousMrp(r.items.mrp);
                return (
                  <tr key={r.sku} className={r.is_active ? "" : "opacity-50"}>
                    <Td>
                      <div className="font-medium">{r.items.name}</div>
                      <div className="text-xs text-n800">
                        {r.sku} · {r.items.category_name ?? "—"} {!r.items.enabled && <Badge tone="red">disabled in Uniware</Badge>}
                      </div>
                    </Td>
                    <Td>
                      <Select className="h-9 w-36" value={r.default_bucket} onChange={(e) => update(r.sku, { default_bucket: e.target.value as Bucket })}>
                        {BUCKETS.filter((b) => b.value !== "damaged").map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.label}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td right>
                      <Input
                        type="number"
                        step="0.01"
                        defaultValue={r.msp ?? ""}
                        placeholder={String(r.items.mrp ?? "")}
                        className={`ml-auto h-9 w-28 text-right ${warn ? "border-red-b" : ""}`}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== r.msp) update(r.sku, { msp: v });
                        }}
                      />
                    </Td>
                    <Td right>
                      <Input
                        type="number"
                        step="0.01"
                        defaultValue={r.margin_pct ?? ""}
                        placeholder={String(effMargin(r))}
                        className="ml-auto h-9 w-20 text-right"
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== r.margin_pct) update(r.sku, { margin_pct: v });
                        }}
                      />
                    </Td>
                    <Td right>{inr(priceSplit(effMsp(r), effMargin(r), r.items.gst_pct ?? 18).unit)}</Td>
                    <Td right>
                      <Input type="number" min={0} defaultValue={r.min_qty} className="ml-auto h-9 w-16 text-right" onBlur={(e) => Number(e.target.value) !== r.min_qty && update(r.sku, { min_qty: Number(e.target.value) })} />
                    </Td>
                    <Td right>
                      <Input type="number" min={0} defaultValue={r.max_qty} className="ml-auto h-9 w-16 text-right" onBlur={(e) => Number(e.target.value) !== r.max_qty && update(r.sku, { max_qty: Number(e.target.value) })} />
                    </Td>
                    <Td>
                      <input type="checkbox" className="size-4 accent-[#131313]" checked={r.is_active} onChange={(e) => update(r.sku, { is_active: e.target.checked })} />
                    </Td>
                    <Td right>
                      <button className="text-n700 hover:text-red-a" onClick={() => remove(r.sku)} aria-label="Remove">
                        <RiDeleteBinLine size={16} />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/** Frido people responsible for this facility: ops get its requests in their review queue, field sales get access to it. */
function AssignedOps({ facilityId }: { facilityId: number }) {
  const [people, setPeople] = useState<{ id: string; full_name: string | null; email: string | null; role: string }[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const sb = supabaseBrowser();

  const load = async () => {
    const [{ data: p }, { data: a }] = await Promise.all([
      sb.from("profiles").select("id,full_name,email,role").in("role", ["ops", "field_sales", "manager", "admin", "super_admin"]).eq("is_active", true).order("full_name"),
      sb.from("facility_ops").select("user_id").eq("facility_id", facilityId),
    ]);
    setPeople(p ?? []);
    setAssigned(new Set((a ?? []).map((x) => x.user_id)));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityId]);

  const toggle = async (userId: string, on: boolean) => {
    setErr(null);
    const { error } = on
      ? await sb.from("facility_ops").insert({ facility_id: facilityId, user_id: userId })
      : await sb.from("facility_ops").delete().eq("facility_id", facilityId).eq("user_id", userId);
    if (error) setErr(errMsg(error));
    load();
  };

  return (
    <Card title="Assigned Frido team" actions={<span className="text-xs text-n800">Ops review its requests · field sales can work in it</span>}>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {people.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[#131313]" checked={assigned.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
            {p.full_name || p.email} <span className="text-xs capitalize text-n800">({p.role.replace("_", " ")})</span>
          </label>
        ))}
        {people.length === 0 && <p className="text-sm text-n800">No Frido ops users yet. Create them under Users.</p>}
      </div>
      {err && (
        <div className="mt-3">
          <Alert>{err}</Alert>
        </div>
      )}
    </Card>
  );
}

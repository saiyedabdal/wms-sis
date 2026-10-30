"use client";

import { useCallback, useEffect, useState } from "react";
import { RiCheckLine, RiFileCopyLine, RiLinkM } from "@remixicon/react";
import { useApp } from "@/components/AppShell";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { facilityTypeLabel, type Profile, type Role } from "@/lib/types";
import { errMsg } from "@/lib/format";

const ROLES: { value: Role; label: string }[] = [
  { value: "facility_staff", label: "Facility staff (retailer / SS)" },
  { value: "ops", label: "Frido ops" },
  { value: "manager", label: "Manager (approves requests)" },
  { value: "admin", label: "Admin" },
];

/** Calls the admin-create-user Edge Function; non-2xx responses carry the reason in the JSON body. */
async function adminUsers(body: Record<string, unknown>) {
  const { data, error } = await supabaseBrowser().functions.invoke("admin-create-user", {
    body: { ...body, redirect_to: `${window.location.origin}/reset-password/` },
  });
  if (error) {
    const reason = (await (error as { context?: Response }).context?.json?.().catch(() => null))?.error;
    throw new Error(reason ?? errMsg(error));
  }
  if (data?.error) throw new Error(data.error);
  return data as { link: string; id?: string };
}

export default function UsersPage() {
  const { facilities, profile: me } = useApp();
  const stockFacilities = facilities.filter((f) => f.type !== "warehouse");
  const [users, setUsers] = useState<Profile[]>([]);
  const [form, setForm] = useState({ full_name: "", email: "", role: "facility_staff" as Role, facility_id: String(stockFacilities[0]?.id ?? "") });
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [link, setLink] = useState<{ who: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("profiles").select("*").order("created_at");
    setUsers((data ?? []) as Profile[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const update = async (id: string, patch: Partial<Profile>) => {
    setMsg(null);
    const { error } = await supabaseBrowser().from("profiles").update(patch).eq("id", id);
    if (error) setMsg({ tone: "red", text: errMsg(error) });
    load();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    setMsg(null);
    setLink(null);
    try {
      const res = await adminUsers({
        action: "create",
        ...form,
        facility_id: form.role === "facility_staff" ? Number(form.facility_id) || null : null,
      });
      setLink({ who: form.email, url: res.link });
      setForm({ ...form, full_name: "", email: "" });
      load();
    } catch (err) {
      setMsg({ tone: "red", text: errMsg(err) });
    }
    setBusy(null);
  };

  const getLink = async (u: Profile) => {
    setBusy(u.id);
    setMsg(null);
    try {
      const res = await adminUsers({ action: "link", user_id: u.id });
      setLink({ who: u.email ?? u.full_name ?? "", url: res.link });
    } catch (err) {
      setMsg({ tone: "red", text: errMsg(err) });
    }
    setBusy(null);
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Frido roles see every facility; the manager approves requests. Facility staff only see and post for their own retailer or super stockist."
      />
      {link && (
        <div className="mb-6 rounded-lg border border-y75 bg-y50 p-5">
          <p className="text-sm font-semibold">Sign-in link for {link.who}</p>
          <p className="mt-1 text-sm text-n900">
            Send this on WhatsApp or Slack. It opens a page where they set their own password. It works once and expires in 24 hours; get a new
            one from the list below any time.
          </p>
          <div className="mt-3 flex gap-2">
            <Input readOnly value={link.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="secondary" onClick={copy}>
              {copied ? <RiCheckLine size={16} /> : <RiFileCopyLine size={16} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Create login">
          <form onSubmit={create} className="grid gap-4">
            <Field label="Full name">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            {form.role === "facility_staff" && (
              <Field label="Facility">
                <Select value={form.facility_id} onChange={(e) => setForm({ ...form, facility_id: e.target.value })}>
                  {stockFacilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} · {facilityTypeLabel(f.type)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button type="submit" disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create login + get link"}
            </Button>
            <p className="text-xs text-n800">
              No email is sent: you get a one-time link to share. People who sign up themselves appear below as inactive until you activate them.
            </p>
          </form>
        </Card>
        <Card title={`${users.length} users`} pad={false} className="lg:col-span-2">
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Facility</Th>
                <Th>Access</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <div className="font-medium">{u.full_name}</div>
                    <div className="text-xs text-n800">{u.email}</div>
                  </Td>
                  <Td>
                    <Select value={u.role} disabled={u.id === me.id} onChange={(e) => update(u.id, { role: e.target.value as Role })} className="h-9 w-52">
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Select value={u.facility_id ?? ""} onChange={(e) => update(u.id, { facility_id: Number(e.target.value) || null })} className="h-9 w-48">
                      <option value="">—</option>
                      {stockFacilities.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" disabled={busy === u.id} onClick={() => getLink(u)} title="One-time link to set a password">
                        <RiLinkM size={14} /> {busy === u.id ? "…" : "Sign-in link"}
                      </Button>
                      {u.id === me.id ? (
                        <Badge tone="green">you</Badge>
                      ) : (
                        <Button variant={u.is_active ? "ghost" : "primary"} size="sm" onClick={() => update(u.id, { is_active: !u.is_active })}>
                          {u.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}

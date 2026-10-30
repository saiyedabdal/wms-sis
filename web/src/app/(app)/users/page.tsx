"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Profile, Role } from "@/lib/types";
import { errMsg } from "@/lib/format";
import { createUser } from "./actions";

const ROLES: { value: Role; label: string }[] = [
  { value: "facility_staff", label: "Facility staff" },
  { value: "ops", label: "Ops (all facilities)" },
  { value: "admin", label: "Admin" },
];

export default function UsersPage() {
  const { facilities, profile: me } = useApp();
  const stockFacilities = facilities.filter((f) => f.type !== "warehouse");
  const [users, setUsers] = useState<Profile[]>([]);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "facility_staff" as Role, facility_id: String(stockFacilities[0]?.id ?? "") });
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    setMsg(null);
    const res = await createUser({ ...form, facility_id: form.role === "facility_staff" ? Number(form.facility_id) || null : null });
    setBusy(false);
    if ("error" in res && res.error) return setMsg({ tone: "red", text: res.error });
    setMsg({ tone: "green", text: `Login created for ${form.email}. Share the password with them.` });
    setForm({ ...form, full_name: "", email: "", password: "" });
    load();
  };

  return (
    <>
      <PageHeader title="Users" subtitle="Ops see every facility. Facility staff only see and post for their own facility." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Create login">
          <form onSubmit={create} className="grid gap-4">
            <Field label="Full name">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Temporary password">
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
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
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create login"}
            </Button>
            <p className="text-xs text-n800">People who sign up themselves appear below as inactive until you activate them.</p>
          </form>
        </Card>
        <Card title={`${users.length} users`} pad={false} className="lg:col-span-2">
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Facility</Th>
                <Th>Status</Th>
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
                    <Select value={u.role} disabled={u.id === me.id} onChange={(e) => update(u.id, { role: e.target.value as Role })} className="h-9 w-44">
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
                    {u.id === me.id ? (
                      <Badge tone="green">you</Badge>
                    ) : (
                      <Button variant={u.is_active ? "ghost" : "primary"} size="sm" onClick={() => update(u.id, { is_active: !u.is_active })}>
                        {u.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    )}
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

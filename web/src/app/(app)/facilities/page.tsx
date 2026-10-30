"use client";

import Link from "next/link";
import { useApp } from "@/components/AppShell";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { FACILITY_TYPES } from "@/lib/types";

export default function FacilitiesPage() {
  const { facilities } = useApp();
  return (
    <>
      <PageHeader title="Facilities" subtitle="Clinics, stores and warehouses that hold or ship Frido stock" actions={<LinkButton href="/facilities/new">New facility</LinkButton>} />
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <Th>Facility</Th>
              <Th>Type</Th>
              <Th>City</Th>
              <Th right>Default margin</Th>
              <Th>Flags</Th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => (
              <tr key={f.id} className="hover:bg-n50">
                <Td>
                  <Link href={`/facilities/${f.id}`} className="font-semibold hover:underline">
                    {f.name}
                  </Link>
                  <div className="text-xs text-n800">{f.code}</div>
                </Td>
                <Td>{FACILITY_TYPES.find((t) => t.value === f.type)?.label}</Td>
                <Td>{f.city ?? "—"}</Td>
                <Td right>{Number(f.default_margin_pct)}%</Td>
                <Td>
                  <div className="flex gap-1">
                    {f.is_consignment && <Badge tone="blue">Consignment</Badge>}
                    {f.restrict_to_assortment && <Badge>Curated SKUs</Badge>}
                    {!f.is_active && <Badge tone="red">Inactive</Badge>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

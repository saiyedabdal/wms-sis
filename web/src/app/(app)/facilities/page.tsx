"use client";

import { paths } from "@/lib/paths";
import Link from "next/link";
import { useApp } from "@/components/AppShell";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { FACILITY_TYPES } from "@/lib/types";

export default function FacilitiesPage() {
  const { facilities } = useApp();
  return (
    <>
      <PageHeader title="Facilities" subtitle="Retailers, super stockists, Frido stores and warehouses. Map each retailer to the super stockist that supplies it." actions={<LinkButton href="/facilities/new">New facility</LinkButton>} />
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <Th>Facility</Th>
              <Th>Type</Th>
              <Th>Region</Th>
              <Th>Supplied by</Th>
              <Th right>Default margin</Th>
              <Th>Flags</Th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => (
              <tr key={f.id} className="hover:bg-n50">
                <Td>
                  <Link href={paths.facility(f.id)} className="font-semibold hover:underline">
                    {f.name}
                  </Link>
                  <div className="text-xs text-n800">{f.code}</div>
                </Td>
                <Td>{FACILITY_TYPES.find((t) => t.value === f.type)?.label}</Td>
                <Td>{f.region ?? f.city ?? "—"}</Td>
                <Td>{f.type === "warehouse" ? "—" : facilities.find((x) => x.id === f.fulfiller_ss_id)?.name ?? (f.type === "super_stockist" ? "Frido WH" : "Frido WH only")}</Td>
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

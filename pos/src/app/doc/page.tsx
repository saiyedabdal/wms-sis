"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RiPrinterLine, RiWhatsappLine } from "@remixicon/react";
import { sb } from "@/lib/supabase";
import type { PublicDoc } from "@/lib/types";
import { DocView } from "@/components/DocView";
import { Alert, Button, Segmented, Spinner } from "@/components/ui";

/** Public invoice / credit note page behind the WhatsApp/SMS link. The unguessable token is the only key. */
function Doc() {
  const q = useSearchParams();
  const token = q.get("t") ?? "";
  const [doc, setDoc] = useState<PublicDoc | null | undefined>(undefined);
  const [format, setFormat] = useState<"80mm" | "a4">((q.get("format") as "80mm" | "a4") || "a4");

  useEffect(() => {
    sb().rpc("pos_public_document", { p_token: token }).then(({ data }) => setDoc((data as PublicDoc | null) ?? null));
  }, [token]);
  useEffect(() => {
    if (doc && q.get("print") === "1") setTimeout(() => window.print(), 400);
  }, [doc, q]);

  if (doc === undefined) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  if (doc === null) return <div className="mx-auto max-w-md p-6"><Alert>This link is not valid. Ask the clinic to share the invoice again.</Alert></div>;

  return (
    <div className="min-h-screen bg-n100 print:bg-white">
      <style>{format === "80mm" ? "@page { size: 80mm auto; margin: 0 }" : "@page { size: A4; margin: 0 }"}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-n300 bg-white px-4 py-3">
        <span className="text-xl font-bold lowercase">frido<span className="text-yellow">.</span></span>
        <span className="text-sm text-n800">{doc.type === "invoice" ? "Invoice" : "Credit note"} {doc.number}</span>
        <Segmented className="ml-auto" value={format} onChange={setFormat} options={[{ value: "80mm", label: "80 mm" }, { value: "a4", label: "A4" }]} />
        <Button size="sm" onClick={() => window.print()}><RiPrinterLine className="h-4 w-4" /> Print / PDF</Button>
        <Button size="sm" variant="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(location.href.replace(/&print=1/, ""))}`)}><RiWhatsappLine className="h-4 w-4" /></Button>
      </div>
      <div className="overflow-x-auto py-6 print:py-0">
        <div className={format === "a4" ? "mx-auto w-fit shadow-[var(--shadow-card)] print:shadow-none" : "mx-auto w-fit shadow-[var(--shadow-card)] print:shadow-none"}>
          <DocView doc={doc} format={format} />
        </div>
      </div>
    </div>
  );
}

export default function DocPage() {
  return <Suspense><Doc /></Suspense>;
}

"use client";

import { PosProvider } from "@/lib/pos/context";
import { Shell } from "@/components/pos/Shell";

/** Till mode: full-screen POS with its own staff PIN layer, outside the Hub shell. */
export function TillRoot({ children }: { children: React.ReactNode }) {
  return (
    <PosProvider>
      <Shell>{children}</Shell>
    </PosProvider>
  );
}

"use client";

import { PosProvider } from "@/lib/pos";
import { Shell } from "@/components/Shell";

export default function TillLayout({ children }: { children: React.ReactNode }) {
  return (
    <PosProvider>
      <Shell>{children}</Shell>
    </PosProvider>
  );
}

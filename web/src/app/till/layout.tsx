import type { Metadata, Viewport } from "next";
import { TillRoot } from "@/components/pos/TillRoot";

// Till mode lives outside the Hub's (app) shell: same login, full screen, built for a counter tablet.
export const metadata: Metadata = { title: "Frido POS · Till" };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#131313",
};

export default function TillLayout({ children }: { children: React.ReactNode }) {
  return <TillRoot>{children}</TillRoot>;
}

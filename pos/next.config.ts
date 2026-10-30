import type { NextConfig } from "next";

// Static export like the Partner Hub: every page talks to Supabase from the browser.
// Record pages use ?id= / ?t= query strings instead of dynamic routes.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

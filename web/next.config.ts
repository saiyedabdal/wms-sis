import type { NextConfig } from "next";

// Static export: every page loads its data in the browser from Supabase, so the site is plain files
// on Netlify. Record pages use ?id= (see src/lib/paths.ts).
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

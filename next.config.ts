import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors are caught by `npm run typecheck`; keep dev/builds fast.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;

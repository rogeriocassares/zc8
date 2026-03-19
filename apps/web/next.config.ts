import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Elysia types from @repo/core are checked separately via Bun.
  // Next.js cannot resolve the duplicate pnpm virtual store entries
  // for elysia across the Bun/Node type boundary.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;

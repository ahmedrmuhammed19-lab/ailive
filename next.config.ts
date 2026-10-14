import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Vercel deployment (DL-21): `output: "standalone"` is a self-hosting/Docker
     mode — on Vercel it forces the function packager to walk the whole
     standalone tree and was the driver behind multi-GB per-deploy Functions
     Storage (same root cause translation-portal fixed: 2925MB -> 209MB).
     Vercel's own NFT tracing is smaller and route-scoped; let it do its job. */
  /* tesseract.js spawns a worker_threads script from node_modules at runtime —
     bundling it breaks the worker path (ModuleNotFound) and crashes the
     server; keep it external so the runtime resolves the real file. */
  serverExternalPackages: ["tesseract.js"],
  /* The schema-engine binary is CLI-only (migrate/push); lambdas only ever
     need the query engine. Keep it out of every traced function. */
  outputFileTracingExcludes: {
    "/api/**": ["./node_modules/@prisma/engines/schema-engine*", "./node_modules/prisma/**"],
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;

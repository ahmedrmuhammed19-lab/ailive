import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* tesseract.js spawns a worker_threads script from node_modules at runtime —
     bundling it breaks the worker path (ModuleNotFound) and crashes the
     server; keep it external so the standalone runtime resolves the real file. */
  serverExternalPackages: ["tesseract.js"],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;

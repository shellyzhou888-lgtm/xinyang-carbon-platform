import path from "node:path";
import type { NextConfig } from "next";

// apps/web links ../../packages/db-agent; the bundler root must include the whole repository to follow that link.
const repoRoot = path.resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // The database agent (pg, Pi, DeepSeek) runs in Node on the server and is loaded as-is, not bundled.
  serverExternalPackages: ["@xinyang/db-agent", "pg", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core"],
  async rewrites() {
    return [{ source: "/_AMapService/:path*", destination: "/api/amap-proxy/:path*" }];
  },
};

export default nextConfig;

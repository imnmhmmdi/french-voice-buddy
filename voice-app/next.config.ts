import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Parent folder has another lockfile; keep tracing scoped to this app for faster builds and deploys.
  outputFileTracingRoot: path.join(process.cwd()),
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Prisma 7 client is generated as TypeScript source under generated/.
  // Keeping it external stops the bundler from trying to trace its engine
  // binaries into the server build.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  typedRoutes: false,
};

export default nextConfig;

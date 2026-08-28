import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["exceljs", "bcryptjs"],
  experimental: {
    // Server actions cap their request body at 1 MB by default. Image uploads
    // go through a route handler instead, but a pasted email template can
    // itself run to megabytes when it carries inlined images, and saving one
    // is a server action.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const config: NextConfig = {
  serverExternalPackages: ["mongodb"],
  output: "standalone",
  compress: false,

  async rewrites() {
    return [{ source: "/api/:caminho((?!auth/).*)", destination: `${API_URL}/api/:caminho` }];
  },
};

export default config;

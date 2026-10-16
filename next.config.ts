import type { NextConfig } from "next";

const config: NextConfig = {
  // typescript (compilador, usado só como parser) e o driver do Mongo rodam
  // como módulos Node normais, fora do bundle do servidor.
  serverExternalPackages: ["typescript", "mongodb"],
  output: "standalone",
};

export default config;

import type { NextConfig } from "next";

// Para onde vão as chamadas de dados. O navegador só conhece o web
// (mesma origem, mesmos cookies); o Next repassa /api/* para o microsserviço.
//
// Atenção: com `output: "standalone"` os rewrites são gravados no BUILD.
// No Docker isso vem do build arg API_URL (ver web/Dockerfile).
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const config: NextConfig = {
  // O driver do Mongo roda como módulo Node normal, fora do bundle do servidor.
  serverExternalPackages: ["mongodb"],
  output: "standalone",
  // Compressão desligada: o SSE do chat passa por aqui e o gzip seguraria os
  // eventos num buffer até juntar bytes suficientes (o chat "travaria").
  compress: false,

  async rewrites() {
    return [
      // Tudo em /api/* que NÃO é /api/auth/* vai para o microsserviço.
      // As rotas de auth existem como arquivos no app/ e o Next as atende antes
      // dos rewrites, mas o padrão já exclui auth/ para deixar isso explícito.
      { source: "/api/:caminho((?!auth/).*)", destination: `${API_URL}/api/:caminho` },
    ];
  },
};

export default config;

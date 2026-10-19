import { jwks } from "@/lib/auth/chaves";

export const dynamic = "force-dynamic";

// JWKS: a chave PÚBLICA que o microsserviço api/ usa para verificar o access
// token. É público de propósito (com ela só dá para verificar, não assinar).
// O caminho /.well-known/jwks.json é o padrão que bibliotecas e provedores
// de identidade usam (OpenID Connect).
export async function GET() {
  return Response.json(await jwks(), { headers: { "cache-control": "public, max-age=300" } });
}

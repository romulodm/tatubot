import { cookies } from "next/headers";
import { rota, json } from "@/lib/http";
import { ErroApp } from "@/lib/erros";
import { COOKIE_REFRESH, gravarCookies, limparCookies } from "@/lib/auth/sessao";
import { emitirAccess, rotacionarRefresh } from "@/lib/auth/tokens";

async function rotacionar() {
  const atual = (await cookies()).get(COOKIE_REFRESH)?.value;
  if (!atual) return null;
  const r = await rotacionarRefresh(atual);
  if (!r.ok) {
    await limparCookies();
    return r.motivo;
  }
  await gravarCookies(await emitirAccess(r.usuario), r.refresh);
  return r.usuario;
}

// POST: usado pelo cliente quando uma chamada volta 401.
export const POST = rota(async () => {
  const r = await rotacionar();
  if (!r || typeof r === "string") {
    throw new ErroApp(401, r === "reuso" ? "SESSAO_REVOGADA" : "SESSAO_EXPIRADA", r === "reuso" ? "Sessão revogada por segurança. Entre de novo." : "Sessão expirada. Entre de novo.");
  }
  return json({ usuario: { id: r._id, nome: r.nome, email: r.email, papel: r.papel } });
});

// GET: usado em navegação de página (server components não gravam cookies).
export const GET = rota(async (req) => {
  const volta = new URL(req.url).searchParams.get("volta") || "/app";
  const destino = volta.startsWith("/") && !volta.startsWith("//") ? volta : "/app";
  const r = await rotacionar();
  const url = new URL(r && typeof r !== "string" ? destino : `/entrar?volta=${encodeURIComponent(destino)}`, req.url);
  return new Response(null, { status: 303, headers: { location: url.pathname + url.search } });
});

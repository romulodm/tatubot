import { cookies } from "next/headers";
import { config } from "../config";
import { naoAutorizado } from "../erros";
import { emitirAccess, emitirRefresh, verificarAccess, type Claims } from "./tokens";
import type { Usuario } from "../tipos";

// Tokens vivem em cookies httpOnly: o JS da página não os lê, e o EventSource
// / fetch de streaming funcionam sem colocar JWT em query string.
export const COOKIE_ACCESS = "rb_access";
export const COOKIE_REFRESH = "rb_refresh";

const seguro = process.env.NODE_ENV === "production" && !process.env.COOKIE_INSEGURO;

export async function abrirSessao(u: Usuario) {
  const access = await emitirAccess(u);
  const { token } = await emitirRefresh(u._id);
  await gravarCookies(access, token);
}

export async function gravarCookies(access: string, refresh: string) {
  const c = await cookies();
  // O access vai para "/" porque a api (atrás do rewrite /api/*) também precisa dele.
  c.set(COOKIE_ACCESS, access, { httpOnly: true, sameSite: "lax", secure: seguro, path: "/", maxAge: config.jwt.accessTtlMin * 60 });
  // O refresh só é enviado para as rotas de auth.
  c.set(COOKIE_REFRESH, refresh, { httpOnly: true, sameSite: "lax", secure: seguro, path: "/api/auth", maxAge: config.refreshTtlDias * 86400 });
}

export async function limparCookies() {
  const c = await cookies();
  c.delete(COOKIE_ACCESS);
  c.set(COOKIE_REFRESH, "", { path: "/api/auth", maxAge: 0 });
}

export async function usuarioAtual(): Promise<Claims | null> {
  const t = (await cookies()).get(COOKIE_ACCESS)?.value;
  return t ? verificarAccess(t) : null;
}

export async function exigirUsuario(): Promise<Claims> {
  const u = await usuarioAtual();
  if (!u) throw naoAutorizado();
  return u;
}


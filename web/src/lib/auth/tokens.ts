import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";
import { db, agora } from "../db";
import type { Papel, RefreshToken, Usuario } from "../tipos";
import { chaves } from "./chaves";

export interface Claims {
  sub: string;
  papel: Papel;
  nome: string;
}

// Access token curto (JWT RS256, 15 min por padrão).
// Agora há dois serviços lendo o token: o web (páginas) e a api (dados).
// Com RS256 só o web consegue ASSINAR; a api verifica com a chave pública
// do /.well-known/jwks.json, identificada pelo `kid` no cabeçalho.
export async function emitirAccess(u: Pick<Usuario, "_id" | "papel" | "nome">): Promise<string> {
  const { privada, kid } = await chaves();
  return new SignJWT({ papel: u.papel, nome: u.nome })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid })
    .setSubject(u._id)
    .setIssuer(config.jwt.issuer)
    .setAudience(config.jwt.audience)
    .setIssuedAt()
    .setExpirationTime(`${config.jwt.accessTtlMin}m`)
    .sign(privada);
}

export async function verificarAccess(token: string): Promise<Claims | null> {
  try {
    const { publica } = await chaves();
    const { payload } = await jwtVerify(token, publica, {
      algorithms: ["RS256"], // lista fechada: rejeita "none", HS256 e qualquer outro alg
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      clockTolerance: 30,
    });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, papel: payload.papel as Papel, nome: String(payload.nome ?? "") };
  } catch {
    return null;
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Refresh token opaco (32 bytes). No banco fica só o hash.
export async function emitirRefresh(usuarioId: string, familia: string = randomUUID()): Promise<{ token: string; id: string }> {
  const token = randomBytes(32).toString("base64url");
  const doc: RefreshToken = {
    _id: randomUUID(),
    usuarioId,
    familia,
    tokenHash: sha256(token),
    expiraEm: new Date(Date.now() + config.refreshTtlDias * 86400_000),
    revogadoEm: null,
    substituidoPor: null,
    criadoEm: agora(),
  };
  await (await db()).collection<RefreshToken>("refresh_tokens").insertOne(doc);
  return { token, id: doc._id };
}

export type ResultadoRotacao =
  | { ok: true; usuario: Usuario; refresh: string }
  | { ok: false; motivo: "invalido" | "expirado" | "reuso" };

// Rotação: o token usado é revogado e um novo é emitido na mesma família.
// Se um token JÁ revogado for apresentado, alguém está reutilizando um token
// roubado: revogamos a família inteira e forçamos novo login.
export async function rotacionarRefresh(token: string): Promise<ResultadoRotacao> {
  const d = await db();
  const col = d.collection<RefreshToken>("refresh_tokens");
  const atual = await col.findOne({ tokenHash: sha256(token) });
  if (!atual) return { ok: false, motivo: "invalido" };
  if (atual.revogadoEm) {
    await col.updateMany({ familia: atual.familia, revogadoEm: null }, { $set: { revogadoEm: agora() } });
    return { ok: false, motivo: "reuso" };
  }
  if (atual.expiraEm < agora()) return { ok: false, motivo: "expirado" };

  // Revogação condicional: duas requisições simultâneas com o mesmo token
  // não podem ambas ganhar um sucessor.
  const r = await col.updateOne({ _id: atual._id, revogadoEm: null }, { $set: { revogadoEm: agora() } });
  if (r.modifiedCount === 0) return { ok: false, motivo: "reuso" };

  const usuario = await d.collection<Usuario>("usuarios").findOne({ _id: atual.usuarioId });
  if (!usuario) return { ok: false, motivo: "invalido" };
  const novo = await emitirRefresh(usuario._id, atual.familia);
  await col.updateOne({ _id: atual._id }, { $set: { substituidoPor: novo.id } });
  return { ok: true, usuario, refresh: novo.token };
}

export async function revogarRefresh(token: string) {
  await (await db())
    .collection<RefreshToken>("refresh_tokens")
    .updateOne({ tokenHash: sha256(token), revogadoEm: null }, { $set: { revogadoEm: agora() } });
}

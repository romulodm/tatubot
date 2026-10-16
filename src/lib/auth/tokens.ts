import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";
import { db, agora } from "../db";
import type { Papel, RefreshToken, Usuario } from "../tipos";

const chave = new TextEncoder().encode(config.jwtSecret);

export interface Claims {
  sub: string;
  papel: Papel;
  nome: string;
}

// Access token curto (JWT HS256). No MVP só a própria app verifica o token,
// então um segredo simétrico basta; RS256 + JWKS volta quando houver um
// segundo serviço verificando (ver docs/decisoes.md).
export async function emitirAccess(u: Pick<Usuario, "_id" | "papel" | "nome">): Promise<string> {
  return new SignJWT({ papel: u.papel, nome: u.nome })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(u._id)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlMin}m`)
    .sign(chave);
}

export async function verificarAccess(token: string): Promise<Claims | null> {
  try {
    const { payload } = await jwtVerify(token, chave, {
      algorithms: ["HS256"], // lista fechada: rejeita "none" e qualquer outro alg
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
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

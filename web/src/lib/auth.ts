import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { agora, config, db, type Papel, type RefreshToken, type Usuario } from "./db";
import { log, naoAutorizado } from "./http";

// ---------- chaves do JWT ----------
// A chave privada é gerada no primeiro boot e nunca sai do web.
// A api só recebe a pública, pelo /.well-known/jwks.json.

interface Chaves {
  privada: KeyObject;
  publica: KeyObject;
  kid: string;
}

const g = globalThis as unknown as { _chaves?: Promise<Chaves> };

function chaves(): Promise<Chaves> {
  g._chaves ??= carregarOuGerar();
  g._chaves.catch(() => (g._chaves = undefined));
  return g._chaves;
}

async function carregarOuGerar(): Promise<Chaves> {
  const arquivo = path.resolve(config.jwt.chavePrivadaPath);
  if (!existsSync(arquivo)) {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await mkdir(path.dirname(arquivo), { recursive: true });
    await writeFile(arquivo, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    log("aviso", "par de chaves RSA gerado para o JWT", { arquivo });
  }
  const privada = createPrivateKey(await readFile(arquivo, "utf8"));
  const publica = createPublicKey(privada);
  // kid = thumbprint da chave pública (RFC 7638)
  const { e, kty, n } = publica.export({ format: "jwk" });
  const kid = createHash("sha256").update(JSON.stringify({ e, kty, n })).digest("base64url").slice(0, 16);
  return { privada, publica, kid };
}

export async function jwks() {
  const { publica, kid } = await chaves();
  const { kty, n, e } = publica.export({ format: "jwk" });
  return { keys: [{ kty, n, e, kid, alg: "RS256", use: "sig" }] };
}

// ---------- senha ----------

const scryptAsync = promisify(scrypt) as (s: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scryptAsync(senha, salt, 64, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), h.toString("base64url")].join("$");
}

export async function conferirSenha(senha: string, armazenado: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = armazenado.split("$");
  if (alg !== "scrypt") return false;
  const esperado = Buffer.from(hash, "base64url");
  const h = await scryptAsync(senha, Buffer.from(salt, "base64url"), esperado.length, { N: +N, r: +r, p: +p });
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

// login com e-mail que não existe também roda o scrypt, para o tempo de resposta não entregar quem tem conta
export const HASH_FALSO = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

// ---------- tokens ----------

export interface Claims {
  sub: string;
  papel: Papel;
  nome: string;
}

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
      algorithms: ["RS256"],
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
const refreshTokens = async () => (await db()).collection<RefreshToken>("refresh_tokens");

// O refresh é opaco e só o hash vai para o banco. Cada login abre uma "família".
async function emitirRefresh(usuarioId: string, familia: string = randomUUID()) {
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
  await (await refreshTokens()).insertOne(doc);
  return { token, id: doc._id };
}

type ResultadoRotacao = { ok: true; usuario: Usuario; refresh: string } | { ok: false; motivo: "invalido" | "expirado" | "reuso" };

// Rotação: o token usado é revogado e um novo nasce na mesma família.
// Token já revogado aparecendo de novo = vazou; revoga a família inteira.
export async function rotacionarRefresh(token: string): Promise<ResultadoRotacao> {
  const col = await refreshTokens();
  const atual = await col.findOne({ tokenHash: sha256(token) });
  if (!atual) return { ok: false, motivo: "invalido" };
  if (atual.revogadoEm) {
    await col.updateMany({ familia: atual.familia, revogadoEm: null }, { $set: { revogadoEm: agora() } });
    return { ok: false, motivo: "reuso" };
  }
  if (atual.expiraEm < agora()) return { ok: false, motivo: "expirado" };

  // duas abas renovando ao mesmo tempo: só uma ganha o sucessor
  const r = await col.updateOne({ _id: atual._id, revogadoEm: null }, { $set: { revogadoEm: agora() } });
  if (r.modifiedCount === 0) return { ok: false, motivo: "reuso" };

  const usuario = await (await db()).collection<Usuario>("usuarios").findOne({ _id: atual.usuarioId });
  if (!usuario) return { ok: false, motivo: "invalido" };
  const novo = await emitirRefresh(usuario._id, atual.familia);
  await col.updateOne({ _id: atual._id }, { $set: { substituidoPor: novo.id } });
  return { ok: true, usuario, refresh: novo.token };
}

export async function revogarRefresh(token: string) {
  await (await refreshTokens()).updateOne({ tokenHash: sha256(token), revogadoEm: null }, { $set: { revogadoEm: agora() } });
}

// ---------- sessão (cookies) ----------

const COOKIE_ACCESS = "rb_access";
export const COOKIE_REFRESH = "rb_refresh";

const seguro = process.env.NODE_ENV === "production" && !process.env.COOKIE_INSEGURO;

export async function abrirSessao(u: Usuario) {
  const access = await emitirAccess(u);
  const { token } = await emitirRefresh(u._id);
  await gravarCookies(access, token);
}

export async function gravarCookies(access: string, refresh: string) {
  const c = await cookies();
  c.set(COOKIE_ACCESS, access, { httpOnly: true, sameSite: "lax", secure: seguro, path: "/", maxAge: config.jwt.accessTtlMin * 60 });
  // o refresh só viaja para /api/auth
  c.set(COOKIE_REFRESH, refresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: seguro,
    path: "/api/auth",
    maxAge: config.refreshTtlDias * 86400,
  });
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

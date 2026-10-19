import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { log } from "../log";

// Par de chaves RSA do access token.
//
// O web ASSINA com a chave privada; a api VERIFICA com a pública, que o web
// publica em /.well-known/jwks.json. Assim a api não guarda nenhum segredo
// capaz de fabricar um token (com HS256 o mesmo segredo faria as duas coisas).
//
// A chave privada vive num arquivo fora do git (data/ está no .gitignore e,
// no Docker, num volume). Se o arquivo não existe, geramos um par novo no
// primeiro boot. Trocar a chave = apagar o arquivo e reiniciar: todo mundo
// precisa entrar de novo e a api busca a chave nova pelo `kid`.

interface Chaves {
  privada: KeyObject;
  publica: KeyObject;
  kid: string;
}

const g = globalThis as unknown as { _chaves?: Promise<Chaves> };

export function chaves(): Promise<Chaves> {
  g._chaves ??= carregarOuGerar();
  g._chaves.catch(() => (g._chaves = undefined));
  return g._chaves;
}

async function carregarOuGerar(): Promise<Chaves> {
  const arquivo = path.resolve(config.jwt.chavePrivadaPath);
  if (!existsSync(arquivo)) {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await mkdir(path.dirname(arquivo), { recursive: true });
    // 0o600: só o dono do processo lê o arquivo.
    await writeFile(arquivo, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    log("aviso", "par de chaves RSA gerado para o JWT", { arquivo });
  }
  const pem = await readFile(arquivo, "utf8");
  const privada = createPrivateKey(pem);
  // A pública é derivada da privada: um arquivo só para guardar.
  const publica = createPublicKey(privada);
  return { privada, publica, kid: thumbprint(publica) };
}

// kid = thumbprint da chave pública (RFC 7638): hash dos campos obrigatórios
// do JWK em ordem alfabética. Mesma chave, mesmo kid, sem precisar guardar nada.
function thumbprint(publica: KeyObject) {
  const jwk = publica.export({ format: "jwk" });
  const canonico = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return createHash("sha256").update(canonico).digest("base64url").slice(0, 16);
}

// O documento JWKS: só a parte PÚBLICA da chave (n e e), nunca a privada.
export async function jwks() {
  const { publica, kid } = await chaves();
  const { kty, n, e } = publica.export({ format: "jwk" });
  return { keys: [{ kty, n, e, kid, alg: "RS256", use: "sig" }] };
}

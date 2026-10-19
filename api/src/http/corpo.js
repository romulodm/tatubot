import { ErroApp } from "../erros.js";

// Parser de body escrito à mão.
//
// O IncomingMessage do Node é um stream: o corpo chega em pedaços (Buffer).
// Juntamos tudo, mas contando os bytes no caminho para cortar cedo quem
// manda um corpo gigante, sem esperar ele terminar de chegar.

const LIMITE_PADRAO = 64 * 1024;

/**
 * Lê o corpo cru como texto UTF-8.
 * O webhook do GitHub precisa disto: a assinatura HMAC é sobre os bytes
 * exatos, então não dá para fazer JSON.parse + JSON.stringify antes.
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [limite] em bytes
 * @returns {Promise<string>}
 */
export function lerTexto(req, limite = LIMITE_PADRAO) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const pedacos = [];
    let total = 0;
    req.on("data", (/** @type {Buffer} */ p) => {
      total += p.length;
      if (total > limite) {
        reject(new ErroApp(413, "CORPO_GRANDE", "Corpo da requisição grande demais"));
        req.destroy();
        return;
      }
      pedacos.push(p);
    });
    req.on("end", () => resolve(Buffer.concat(pedacos).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Lê o corpo e garante que é um objeto JSON (nada de array, número ou null).
 * Corpo vazio vira {} para rotas em que todos os campos são opcionais.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
export async function lerJson(req) {
  const tipo = req.headers["content-type"] ?? "";
  const texto = await lerTexto(req);
  if (!texto) return {};
  if (!tipo.includes("application/json")) {
    throw new ErroApp(415, "TIPO_NAO_SUPORTADO", "Envie o corpo como application/json");
  }
  try {
    const v = JSON.parse(texto);
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new ErroApp(400, "JSON_INVALIDO", "Corpo deve ser um objeto JSON");
  }
}

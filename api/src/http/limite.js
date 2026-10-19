import { ErroApp } from "../erros.js";

// Rate limit em memória, com janela deslizante.
//
// Para cada chave (ex.: "msg:<usuarioId>") guardamos os instantes das últimas
// chamadas e descartamos os que saíram da janela. Se sobrou `max` ou mais,
// recusa com 429 e diz quanto tempo esperar.
//
// Vale por processo: com várias réplicas da API, cada uma conta separado.
// Nesse dia, mover o contador para o Mongo (ou Redis).

/** @type {Map<string, number[]>} */
const baldes = new Map();

/**
 * @param {string} chave
 * @param {number} max chamadas permitidas na janela
 * @param {number} janelaMs
 */
export function limitar(chave, max, janelaMs) {
  const agora = Date.now();
  const hits = (baldes.get(chave) ?? []).filter((t) => agora - t < janelaMs);
  if (hits.length >= max) {
    const espera = Math.ceil((janelaMs - (agora - hits[0])) / 1000);
    throw new ErroApp(429, "LIMITE_EXCEDIDO", `Muitas tentativas. Tente de novo em ${espera}s`, { esperaSegundos: espera });
  }
  hits.push(agora);
  baldes.set(chave, hits);
}

// Limpeza periódica para o Map não crescer para sempre com chaves antigas.
setInterval(() => {
  const agora = Date.now();
  for (const [k, hits] of baldes) if (!hits.some((t) => agora - t < 60 * 60_000)) baldes.delete(k);
}, 10 * 60_000).unref();

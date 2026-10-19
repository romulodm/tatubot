import { config } from "../config.js";
import { ErroPermanente, ErroTransitorio } from "../erros.js";
import { log } from "../log.js";

// POST para a API do provedor (OpenAI ou compatível), com as regras de erro
// num lugar só:
//
//   429 (limite de taxa) e 5xx  -> espera e tenta de novo AQUI, algumas vezes.
//                                  Sem isso, um 429 no meio de 3 mil embeddings
//                                  derrubava a indexação inteira e ela recomeçava
//                                  do zero pela fila.
//   401 / 403                   -> chave errada ou sem permissão: ErroPermanente
//                                  (não adianta tentar de novo; vai para a DLQ com
//                                  uma mensagem clara).
//   outros 4xx                  -> requisição inválida: ErroPermanente.
//   rede caiu / timeout         -> tenta de novo aqui; esgotou, ErroTransitorio
//                                  (aí quem tenta de novo é a fila).

const TENTATIVAS = 6;

/**
 * @param {string} caminho ex.: "/embeddings"
 * @param {Record<string, unknown>} corpo
 * @param {{ timeoutMs?: number, sinal?: AbortSignal }} [o]
 * @returns {Promise<Response>} resposta com status 2xx
 */
export async function postarLlm(caminho, corpo, o = {}) {
  const url = `${config.llm.baseUrl}${caminho}`;
  const timeoutMs = o.timeoutMs ?? 120_000;
  let ultimoErro = "";

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
        body: JSON.stringify(corpo),
        signal: o.sinal ? AbortSignal.any([o.sinal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (o.sinal?.aborted) throw e;
      ultimoErro = `${caminho} indisponível: ${/** @type {Error} */ (e).message}`;
      await esperar(tentativa, null, ultimoErro);
      continue;
    }

    if (res.ok) return res;

    // O corpo do erro da OpenAI não contém a chave, mas cortamos mesmo assim.
    const detalhe = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new ErroPermanente("LLM_SEM_ACESSO", `O provedor recusou a chave (HTTP ${res.status}). Confira LLM_API_KEY e LLM_BASE_URL no .env.`);
    }
    if (res.status === 429 || res.status >= 500) {
      ultimoErro = `${caminho}: HTTP ${res.status} ${detalhe}`;
      // Cota esgotada (sem crédito) também volta 429, mas esperar não resolve.
      if (/insufficient_quota/.test(detalhe)) throw new ErroPermanente("LLM_SEM_CREDITO", "A conta do provedor está sem crédito (insufficient_quota).");
      await esperar(tentativa, res.headers, ultimoErro);
      continue;
    }
    throw new ErroPermanente("LLM_REQUISICAO_INVALIDA", `${caminho}: HTTP ${res.status} ${detalhe}`);
  }
  throw new ErroTransitorio(ultimoErro);
}

/**
 * Quanto esperar antes da próxima tentativa. Se o provedor disser (Retry-After
 * ou x-ratelimit-reset-*), obedecemos; senão, backoff exponencial: 1, 2, 4, 8, 16 s.
 * @param {number} tentativa
 * @param {Headers | null} headers
 * @param {string} motivo
 */
async function esperar(tentativa, headers, motivo) {
  if (tentativa >= TENTATIVAS) return;
  let ms = Math.min(1000 * 2 ** (tentativa - 1), 20_000);
  const retryAfter = Number(headers?.get("retry-after"));
  const reset = duracao(headers?.get("x-ratelimit-reset-tokens") ?? headers?.get("x-ratelimit-reset-requests"));
  if (retryAfter > 0) ms = retryAfter * 1000;
  else if (reset) ms = reset;
  ms = Math.min(ms + Math.random() * 250, 60_000); // um pouco de aleatoriedade evita todos voltarem juntos
  log("aviso", "provedor de LLM pediu para esperar", { tentativa, esperaMs: Math.round(ms), motivo: motivo.slice(0, 160) });
  await new Promise((ok) => setTimeout(ok, ms));
}

/**
 * A OpenAI manda o reset como "1s", "250ms" ou "1m30s".
 * @param {string | null | undefined} s
 */
function duracao(s) {
  if (!s) return 0;
  let ms = 0;
  for (const [, n, u] of s.matchAll(/([\d.]+)(ms|s|m|h)/g)) ms += Number(n) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[u];
  return ms;
}

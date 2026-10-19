import { ErroApp } from "../erros.js";
import { log } from "../log.js";

// Helpers de resposta. Os handlers devolvem objetos simples
// ({ status, corpo, headers }) e quem escreve no socket é o app.js.
// Isso deixa os handlers fáceis de testar: é só olhar o objeto devolvido.

/**
 * @param {unknown} corpo
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
export function json(corpo, status = 200, headers = {}) {
  return { status, corpo, headers };
}

export function semConteudo() {
  return { status: 204 };
}

/**
 * Converte qualquer erro no formato padrão:
 *   { "erro": { "codigo": "...", "mensagem": "...", "detalhes": {} } }
 * Erro inesperado vira 500 genérico; o detalhe só vai para o log
 * (stack trace não deve chegar ao navegador).
 * @param {unknown} e
 * @param {string} correlationId
 */
export function respostaDeErro(e, correlationId) {
  if (e instanceof ErroApp) {
    return json({ erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes } }, e.status);
  }
  log("erro", "erro não tratado", { correlationId, erro: e instanceof Error ? e.stack : String(e) });
  return json({ erro: { codigo: "ERRO_INTERNO", mensagem: "Erro interno", detalhes: {} } }, 500);
}

/**
 * Escreve a resposta no socket.
 * @param {import("node:http").ServerResponse} res
 * @param {{ status: number, corpo?: unknown, headers?: Record<string, string> }} r
 */
export function enviar(res, r) {
  if (res.headersSent) return;
  const headers = { ...r.headers };
  let corpo = "";
  if (r.corpo !== undefined) {
    corpo = JSON.stringify(r.corpo);
    headers["content-type"] = "application/json; charset=utf-8";
  }
  res.writeHead(r.status, headers);
  res.end(corpo);
}

/**
 * Abre um stream de Server-Sent Events.
 * Formato do SSE: blocos de texto separados por linha em branco, cada um com
 * "event: nome" e "data: json". Linhas começando com ":" são comentários
 * (usamos como ping para o proxy não derrubar a conexão ociosa).
 * @param {import("node:http").ServerResponse} res
 * @param {string} correlationId
 */
export function abrirSse(res, correlationId) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    // no-transform: impede proxies (inclusive o do Next) de comprimir/bufferizar
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-correlation-id": correlationId,
  });
  res.flushHeaders();
  return {
    /** @param {string} evento @param {unknown} dado */
    evento(evento, dado) {
      if (!res.writableEnded) res.write(`event: ${evento}\ndata: ${JSON.stringify(dado)}\n\n`);
    },
    ping() {
      if (!res.writableEnded) res.write(": ping\n\n");
    },
    fechar() {
      if (!res.writableEnded) res.end();
    },
  };
}

/**
 * Paginação a partir da query string (?pagina=2&limite=20).
 * @param {URL} url
 */
export function paginacao(url) {
  const pagina = Math.max(1, Number(url.searchParams.get("pagina")) || 1);
  const limite = Math.min(100, Math.max(1, Number(url.searchParams.get("limite")) || 20));
  return { pagina, limite, pular: (pagina - 1) * limite };
}

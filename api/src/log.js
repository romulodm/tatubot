// Logger escrito à mão: uma linha de JSON por evento, fácil de filtrar com jq
// ou de mandar para qualquer agregador.
//
// Nunca logar senha, token, conteúdo de .env ou prompt completo.

/**
 * @param {"info" | "aviso" | "erro"} nivel
 * @param {string} msg
 * @param {Record<string, unknown>} [campos]
 */
export function log(nivel, msg, campos = {}) {
  const linha = JSON.stringify({ nivel, msg, servico: "tatubot-api", em: new Date().toISOString(), ...campos });
  if (nivel === "erro") console.error(linha);
  else console.log(linha);
}

// Erros com significado.
//
// Na HTTP, todo erro sai no mesmo formato:
//   { "erro": { "codigo": "...", "mensagem": "...", "detalhes": {} } }
// Na fila, o tipo do erro decide o destino do evento (retry ou DLQ).

/** Erro que vira resposta HTTP com status e código próprios. */
export class ErroApp extends Error {
  /**
   * @param {number} status código HTTP
   * @param {string} codigo código estável, em MAIÚSCULAS, que o front pode tratar
   * @param {string} mensagem texto em português para mostrar ao usuário
   * @param {Record<string, unknown>} [detalhes]
   */
  constructor(status, codigo, mensagem, detalhes = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** @param {string} codigo @param {string} mensagem */
export const naoEncontrado = (codigo, mensagem) => new ErroApp(404, codigo, mensagem);
export const naoAutorizado = () => new ErroApp(401, "NAO_AUTENTICADO", "Faça login para continuar");
/** @param {string} mensagem @param {Record<string, unknown>} [detalhes] */
export const invalido = (mensagem, detalhes = {}) => new ErroApp(400, "VALIDACAO", mensagem, detalhes);

// Na fila: transitório volta para retry com backoff (rede caiu, LLM fora do ar);
// permanente vai direto para a DLQ (repositório não existe, não adianta insistir).
export class ErroTransitorio extends Error {}

export class ErroPermanente extends Error {
  /** @param {string} codigo @param {string} mensagem */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

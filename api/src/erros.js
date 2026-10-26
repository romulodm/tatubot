export class ErroApp extends Error {
  constructor(status, codigo, mensagem, detalhes = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export const naoEncontrado = (codigo, mensagem) => new ErroApp(404, codigo, mensagem);
export const naoAutorizado = () => new ErroApp(401, "NAO_AUTENTICADO", "Faça login para continuar");
export const invalido = (mensagem, detalhes = {}) => new ErroApp(400, "VALIDACAO", mensagem, detalhes);

export class ErroTransitorio extends Error {}

export class ErroPermanente extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

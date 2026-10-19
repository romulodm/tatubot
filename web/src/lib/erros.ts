// Formato de erro único (context.md, seção 8):
// { "erro": { "codigo": "...", "mensagem": "...", "detalhes": {} } }
export class ErroApp extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public detalhes: Record<string, unknown> = {},
  ) {
    super(mensagem);
  }
}

export const naoEncontrado = (codigo: string, mensagem: string) => new ErroApp(404, codigo, mensagem);
export const naoAutorizado = () => new ErroApp(401, "NAO_AUTENTICADO", "Faça login para continuar");
export const invalido = (mensagem: string, detalhes: Record<string, unknown> = {}) =>
  new ErroApp(400, "VALIDACAO", mensagem, detalhes);

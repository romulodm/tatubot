import type { Mensagem } from "./tipos";

export function mensagemPublica(m: Mensagem) {
  return {
    id: m._id,
    autor: m.autor,
    conteudo: m.conteudo,
    citacoes: m.citacoes,
    trilha: m.trilha,
    status: m.status,
    erro: m.erro,
    execucaoId: m.execucaoId,
    criadoEm: m.criadoEm,
    atualizadoEm: m.atualizadoEm,
  };
}

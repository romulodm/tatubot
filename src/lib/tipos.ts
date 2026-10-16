// Documentos do Mongo. Ids são strings UUID (crypto.randomUUID) em vez de ObjectId,
// para manter paridade com o modelo do context.md e facilitar logs e URLs.

export type Papel = "admin" | "usuario";

export interface Usuario {
  _id: string;
  nome: string;
  email: string;
  senhaHash: string;
  papel: Papel;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface RefreshToken {
  _id: string;
  usuarioId: string;
  familia: string; // cadeia de rotação; reuso revoga a família inteira
  tokenHash: string;
  expiraEm: Date;
  revogadoEm: Date | null;
  substituidoPor: string | null;
  criadoEm: Date;
}

export type StatusRepo = "pendente" | "indexando" | "pronto" | "erro";

export interface Repositorio {
  _id: string;
  ownerId: string;
  url: string;
  ghOwner: string;
  ghNome: string;
  branch: string;
  status: StatusRepo;
  ultimoCommit: string | null;
  erro: string | null;
  webhookSecret: string;
  totalArquivos: number;
  totalChunks: number;
  embedModelo: string | null;
  versaoIndice: number;
  progresso: { etapa: string; processados: number; total: number } | null;
  ultimaIndexacao: { embeddingsGerados: number; embeddingsReaproveitados: number; modo: "completa" | "incremental" | "nada" } | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

export type StatusArquivo = "indexado" | "ignorado" | "erro";

export interface Arquivo {
  _id: string;
  repoId: string;
  path: string;
  hash: string;
  linguagem: string;
  tamanhoBytes: number;
  status: StatusArquivo;
  motivo: string | null;
  atualizadoEm: Date;
}

export type TipoChunk = "funcao" | "classe" | "metodo" | "modulo" | "secao_doc";

export interface Chunk {
  _id: string;
  repoId: string;
  path: string;
  simbolo: string | null;
  tipo: TipoChunk;
  linhaInicio: number;
  linhaFim: number;
  cabecalho: string;
  conteudo: string;
  hashTexto: string; // hash do texto embedado; chave de reaproveitamento de embedding
  commitSha: string;
  embedding: number[];
  tokens: string[];
  referencias: string[];
  criadoEm: Date;
  atualizadoEm: Date;
}

export type ModoBot = "pipeline" | "agente";

export interface Bot {
  _id: string;
  ownerId: string;
  nome: string;
  avatarSeed: string;
  avatarEstilo: string;
  instrucoes: string;
  modo: ModoBot;
  repoIds: string[];
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface Conversa {
  _id: string;
  botId: string;
  usuarioId: string;
  titulo: string;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface Citacao {
  repoId: string;
  ghOwner: string;
  ghNome: string;
  path: string;
  linhaInicio: number;
  linhaFim: number;
  commitSha: string;
}

export interface PassoTrilha {
  descricao: string;
  em: Date;
}

export type StatusMensagem = "pendente" | "processando" | "concluida" | "falhou";

export interface Mensagem {
  _id: string;
  conversaId: string;
  autor: "usuario" | "bot";
  conteudo: string;
  citacoes: Citacao[];
  trilha: PassoTrilha[];
  status: StatusMensagem;
  erro: string | null;
  correlationId: string;
  execucaoId: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface Execucao {
  _id: string;
  mensagemId: string;
  botId: string;
  usuarioId: string;
  modo: ModoBot | "extrativo";
  status: "rodando" | "concluida" | "falhou";
  tokensEntrada: number;
  tokensSaida: number;
  passos: {
    ordem: number;
    tipo: "llm" | "ferramenta" | "busca";
    ferramenta: string | null;
    entrada: unknown;
    saidaResumo: string;
    duracaoMs: number;
  }[];
  citacoesRemovidas: string[];
  iniciadoEm: Date;
  finalizadoEm: Date | null;
  erro: string | null;
}

export type StatusEvento = "pendente" | "processando" | "feito" | "dlq";

export interface Evento<P = Record<string, unknown>> {
  _id: string; // eventId
  tipo: string;
  versao: number;
  ocorridoEm: Date;
  correlationId: string;
  produtor: string;
  payload: P;
  status: StatusEvento;
  tentativas: number;
  disponivelEm: Date;
  travadoAte: Date | null;
  trava: string | null; // token do worker dono do evento
  ultimoErro: string | null;
}

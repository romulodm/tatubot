export interface BotUI {
  id: string;
  nome: string;
  avatarSeed: string;
  avatarEstilo: string;
  instrucoes: string;
  modo: "pipeline" | "agente";
  repoIds: string[];
}

export interface RepoUI {
  id: string;
  url: string;
  ghOwner: string;
  ghNome: string;
  branch: string;
  status: "pendente" | "indexando" | "pronto" | "erro";
  ultimoCommit: string | null;
  erro: string | null;
  totalArquivos: number;
  totalChunks: number;
  progresso: { etapa: string; processados: number; total: number } | null;
  ultimaIndexacao: { embeddingsGerados: number; embeddingsReaproveitados: number; modo: string } | null;
  webhookSecret?: string;
  atualizadoEm: string;
}

export interface ConversaUI {
  id: string;
  botId: string;
  titulo: string;
  atualizadoEm: string;
}

export interface MensagemUI {
  id: string;
  autor: "usuario" | "bot";
  conteudo: string;
  citacoes: { repoId: string; ghOwner: string; ghNome: string; path: string; linhaInicio: number; linhaFim: number; commitSha: string }[];
  trilha: { descricao: string; em: string }[];
  status: "pendente" | "processando" | "concluida" | "falhou";
  erro: string | null;
  execucaoId: string | null;
  criadoEm: string;
}

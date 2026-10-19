// Formato dos documentos no Mongo, descrito em JSDoc.
//
// O serviço é JavaScript puro, mas os tipos continuam úteis: o VS Code lê
// estes @typedef e completa os campos em qualquer arquivo que faça
//   /** @param {import("../tipos.js").Repositorio} repo */
//
// Ids são strings UUID (crypto.randomUUID) em vez de ObjectId, para manter
// paridade com o modelo do context.md e facilitar logs e URLs.

/**
 * Quem está fazendo a requisição. Vem das claims do access token (JWT),
 * então a API não precisa consultar a coleção de usuários.
 * @typedef {object} Usuario
 * @property {string} sub id do usuário
 * @property {"admin" | "usuario"} papel
 * @property {string} nome
 */

/**
 * @typedef {"pendente" | "indexando" | "pronto" | "erro"} StatusRepo
 */

/**
 * @typedef {object} Repositorio
 * @property {string} _id
 * @property {string} ownerId
 * @property {string} url
 * @property {string} ghOwner
 * @property {string} ghNome
 * @property {string} branch vazia = branch padrão, descoberta no clone
 * @property {StatusRepo} status
 * @property {string | null} ultimoCommit
 * @property {string | null} erro
 * @property {string} webhookSecret
 * @property {number} totalArquivos
 * @property {number} totalChunks
 * @property {string | null} embedModelo modelo usado na última indexação
 * @property {number} versaoIndice sobe a cada indexação; invalida o cache da busca
 * @property {{ etapa: string, processados: number, total: number } | null} progresso
 * @property {{ embeddingsGerados: number, embeddingsReaproveitados: number, modo: "completa" | "incremental" | "nada" } | null} ultimaIndexacao
 * @property {Date} criadoEm
 * @property {Date} atualizadoEm
 */

/**
 * Um arquivo do repositório e o que a indexação decidiu sobre ele.
 * @typedef {object} Arquivo
 * @property {string} _id
 * @property {string} repoId
 * @property {string} path
 * @property {string} hash sha1 do conteúdo
 * @property {string} linguagem
 * @property {number} tamanhoBytes
 * @property {"indexado" | "ignorado" | "erro"} status
 * @property {string | null} motivo por que foi ignorado (lockfile, binario, segredo_detectado:...)
 * @property {Date} atualizadoEm
 */

/**
 * @typedef {"funcao" | "classe" | "metodo" | "modulo" | "secao_doc"} TipoChunk
 */

/**
 * Um pedaço do código que vira uma unidade de busca (ver docs/rag/03-chunking.md).
 * @typedef {object} Chunk
 * @property {string} _id
 * @property {string} repoId
 * @property {string} path
 * @property {string | null} simbolo nome da função/classe/método, se houver
 * @property {TipoChunk} tipo
 * @property {number} linhaInicio 1-based, inclusivo
 * @property {number} linhaFim
 * @property {string} cabecalho "arquivo: src/a.ts > classe X > método y"
 * @property {string} conteudo
 * @property {string} hashTexto hash do texto embedado; chave de reaproveitamento de embedding
 * @property {string} commitSha
 * @property {number[]} embedding
 * @property {string[]} tokens termos para o BM25
 * @property {string[]} referencias nomes que este trecho chama (grafo de 1 salto)
 * @property {Date} criadoEm
 * @property {Date} atualizadoEm
 */

/**
 * @typedef {"pipeline" | "agente"} ModoBot
 */

/**
 * @typedef {object} Bot
 * @property {string} _id
 * @property {string} ownerId
 * @property {string} nome
 * @property {string} avatarSeed
 * @property {string} avatarEstilo
 * @property {string} instrucoes
 * @property {ModoBot} modo
 * @property {string[]} repoIds
 * @property {Date} criadoEm
 * @property {Date} atualizadoEm
 */

/**
 * @typedef {object} Conversa
 * @property {string} _id
 * @property {string} botId
 * @property {string} usuarioId
 * @property {string} titulo
 * @property {Date} criadoEm
 * @property {Date} atualizadoEm
 */

/**
 * Uma citação que sobreviveu à validação: o bot leu exatamente estas linhas.
 * @typedef {object} Citacao
 * @property {string} repoId
 * @property {string} ghOwner
 * @property {string} ghNome
 * @property {string} path
 * @property {number} linhaInicio
 * @property {number} linhaFim
 * @property {string} commitSha
 */

/**
 * @typedef {object} Mensagem
 * @property {string} _id
 * @property {string} conversaId
 * @property {"usuario" | "bot"} autor
 * @property {string} conteudo
 * @property {Citacao[]} citacoes
 * @property {{ descricao: string, em: Date }[]} trilha o que o bot fez, mostrado ao vivo no chat
 * @property {"pendente" | "processando" | "concluida" | "falhou"} status
 * @property {string | null} erro
 * @property {string} correlationId
 * @property {string | null} execucaoId
 * @property {Date} criadoEm
 * @property {Date} atualizadoEm
 */

/**
 * @typedef {object} PassoExecucao
 * @property {number} ordem
 * @property {"llm" | "ferramenta" | "busca"} tipo
 * @property {string | null} ferramenta
 * @property {unknown} entrada
 * @property {string} saidaResumo
 * @property {number} duracaoMs
 */

/**
 * Registro de uma resposta do bot, passo a passo ("ver o raciocínio").
 * @typedef {object} Execucao
 * @property {string} _id
 * @property {string} mensagemId
 * @property {string} botId
 * @property {string} usuarioId
 * @property {ModoBot | "extrativo"} modo
 * @property {"rodando" | "concluida" | "falhou"} status
 * @property {number} tokensEntrada
 * @property {number} tokensSaida
 * @property {PassoExecucao[]} passos
 * @property {string[]} citacoesRemovidas
 * @property {Date} iniciadoEm
 * @property {Date | null} finalizadoEm
 * @property {string | null} erro
 */

/**
 * Envelope de evento da fila (coleção `eventos`).
 * @typedef {object} Evento
 * @property {string} _id eventId
 * @property {string} tipo ex.: "repo.cadastrado", "mensagem.recebida"
 * @property {number} versao
 * @property {Date} ocorridoEm
 * @property {string} correlationId
 * @property {string} produtor
 * @property {Record<string, any>} payload
 * @property {"pendente" | "processando" | "feito" | "dlq"} status
 * @property {number} tentativas
 * @property {Date} disponivelEm
 * @property {Date | null} travadoAte
 * @property {string | null} trava token do worker dono do evento
 * @property {string | null} ultimoErro
 */

export {};

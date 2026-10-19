import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { db, agora } from "../db.js";
import { ErroPermanente } from "../erros.js";
import { log } from "../log.js";
import { buscar } from "../busca/buscar.js";
import { analisarConsulta } from "../busca/consulta.js";
import { promptConversa, respostaConversaLocal } from "./conversa.js";
import { fraseDoAssunto, respostaExtrativa } from "./extrativo.js";
import { chat, estimarTokens, llmDisponivel } from "../llm/chat.js";
import { validarCitacoes } from "./citacoes.js";
import { definicoes, executarFerramenta } from "./ferramentas.js";
import { blocoTrechos, promptSistema } from "./prompts.js";

// Runtime do bot: o que acontece entre "mensagem.recebida" e a resposta pronta.
//
//   pergunta ─► roteador de intenção ─┬─ conversa ("oi") ─► resposta curta, sem busca
//                                     └─ código ─┬─ extrativo (sem LLM)
//                                                ├─ pipeline  (busca fixa + 1 chamada ao LLM)
//                                                └─ agente    (LLM com ferramentas, em loop)
//                                                      │
//                                     validação de citações ◄┘
//
// Enquanto trabalha, o bot grava a "trilha" (o que está fazendo) e o texto
// parcial na própria mensagem. O SSE da API lê essas mudanças e manda ao
// navegador. Detalhes em docs/rag/06-resposta-e-citacoes.md.

/**
 * O payload do evento traz tudo de que o runtime precisa (bot, histórico,
 * repositórios permitidos): o runtime não consulta bots nem conversas.
 * @typedef {object} PayloadMensagem
 * @property {string} mensagemId mensagem do BOT (pendente) que esta execução preenche
 * @property {string} conversaId
 * @property {string} usuarioId
 * @property {{ id: string, nome: string, instrucoes: string, modo: import("../tipos.js").ModoBot }} bot
 * @property {string[]} repoIds
 * @property {{ autor: "usuario" | "bot", conteudo: string }[]} historico
 * @property {string} conteudo a pergunta
 */

/** @typedef {import("./citacoes.js").Fonte} Fonte */
/** @typedef {import("../llm/chat.js").MensagemChat} MensagemChat */

/**
 * @param {PayloadMensagem} p
 * @param {string} correlationId
 */
export async function responder(p, correlationId) {
  const d = await db();
  const msgs = d.collection("mensagens");
  const msg = await msgs.findOne({ _id: /** @type {any} */ (p.mensagemId) });
  if (!msg || msg.status === "concluida") return; // conversa apagada ou já respondida

  // Autorização de novo, aqui dentro: só repositórios do mesmo dono.
  // A API já conferiu ao vincular, mas um repo pode ter mudado de dono ou
  // sumido entre a publicação do evento e agora.
  const filtroRepos = { _id: { $in: p.repoIds }, ownerId: p.usuarioId };
  const repos = /** @type {import("../tipos.js").Repositorio[]} */ (
    /** @type {unknown} */ (
      await d
        .collection("repositorios")
        .find(/** @type {any} */ (filtroRepos))
        .toArray()
    )
  );

  /** @type {import("../tipos.js").Execucao} */
  const exec = {
    _id: randomUUID(),
    mensagemId: p.mensagemId,
    botId: p.bot.id,
    usuarioId: p.usuarioId,
    modo: llmDisponivel() ? p.bot.modo : "extrativo",
    status: "rodando",
    tokensEntrada: 0,
    tokensSaida: 0,
    passos: [],
    citacoesRemovidas: [],
    iniciadoEm: agora(),
    finalizadoEm: null,
    erro: null,
  };
  await d.collection("execucoes").insertOne(/** @type {any} */ (exec));
  await msgs.updateOne({ _id: p.mensagemId }, { $set: { status: "processando", execucaoId: exec._id, conteudo: "", trilha: [], atualizadoEm: agora() } });

  // Cada passo da trilha aparece ao vivo no chat ("Lendo src/auth.ts L10-L40").
  const trilha = async (/** @type {string} */ descricao) => {
    await msgs.updateOne({ _id: p.mensagemId }, { $push: { trilha: { descricao, em: agora() } }, $set: { atualizadoEm: agora() } });
  };

  /**
   * Registra um passo na execução (vai para "ver o raciocínio").
   * @param {import("../tipos.js").PassoExecucao["tipo"]} tipo @param {string | null} ferramenta
   * @param {unknown} entrada @param {string} saidaResumo @param {number} inicio
   */
  const passo = (tipo, ferramenta, entrada, saidaResumo, inicio) => {
    exec.passos.push({ ordem: exec.passos.length + 1, tipo, ferramenta, entrada, saidaResumo: saidaResumo.slice(0, 500), duracaoMs: Date.now() - inicio });
  };

  // Streaming: tokens chegam muito rápido; gravamos o parcial no máximo a cada 250 ms.
  let parcial = "";
  let ultimoFlush = 0;
  const aoToken = (/** @type {string} */ t) => {
    parcial += t;
    if (Date.now() - ultimoFlush > 250) {
      ultimoFlush = Date.now();
      void msgs.updateOne({ _id: p.mensagemId }, { $set: { conteudo: parcial, atualizadoEm: agora() } });
    }
  };

  // Roteamento: conversa ("oi", "valeu") não dispara busca nenhuma.
  const nomesRepos = repos.map((r) => `${r.ghOwner}/${r.ghNome}`);
  const anterior = [...p.historico].reverse().find((h) => h.autor === "usuario")?.conteudo ?? "";
  let consulta = analisarConsulta(p.conteudo);
  if (consulta.intencao === "conversa") {
    await responderConversa();
    return;
  }
  // Pergunta de continuação ("e quem chama essa função?") herda o assunto da anterior.
  if (anterior && /\b(ele|ela|isso|esse|essa|este|esta|dele|dela|nele|nela|disso|desse|dessa|deste|desta|mesmo|mesma|la|ali)\b/i.test(p.conteudo)) {
    consulta = analisarConsulta(`${anterior} ${p.conteudo}`);
  }

  if (!repos.length) {
    await finalizar("Este bot ainda não tem repositórios. Vincule um repositório na configuração do bot e pergunte de novo.", [], []);
    return;
  }
  const naoProntos = repos.filter((r) => r.status !== "pronto");
  if (naoProntos.length === repos.length) {
    await finalizar(
      `Ainda estou indexando ${naoProntos.map((r) => `${r.ghOwner}/${r.ghNome}`).join(", ")}. Tente de novo quando o status ficar "pronto".`,
      [],
      [],
    );
    return;
  }

  /** @type {string} */
  let texto;
  /** @type {Fonte[]} */
  let fontes;
  if (exec.modo === "extrativo") ({ texto, fontes } = await modoExtrativo());
  else if (exec.modo === "pipeline") ({ texto, fontes } = await modoPipeline());
  else ({ texto, fontes } = await modoAgente());

  const v = validarCitacoes(texto, fontes);
  exec.citacoesRemovidas = v.removidas;
  if (v.removidas.length) await trilha(`Removi ${v.removidas.length} citação(ões) para linhas que não li`);
  await finalizar(v.texto, v.citacoes, v.removidas);

  // ---------- modos ----------
  // Funções internas (closures): enxergam p, exec, trilha e passo sem precisar
  // passar tudo como parâmetro.

  async function responderConversa() {
    passo("llm", "roteador", { intencao: "conversa" }, "mensagem sem pergunta sobre o código; sem busca", Date.now());
    if (!llmDisponivel()) {
      exec.modo = "extrativo";
      await finalizar(respostaConversaLocal(p.conteudo, p.bot, nomesRepos, false), [], []);
      return;
    }
    const t0 = Date.now();
    /** @type {MensagemChat[]} */
    const mensagens = [{ role: "system", content: promptConversa(p.bot, nomesRepos) }, ...historico(), { role: "user", content: p.conteudo }];
    const r = await chat({ mensagens, aoToken, maxTokens: 300 });
    contar(r.uso, mensagens, r.conteudo);
    passo("llm", null, { conversa: true }, r.conteudo, t0);
    // Sem fontes: qualquer citação que o modelo inventar é removida.
    const v = validarCitacoes(r.conteudo, []);
    await finalizar(v.texto, [], v.removidas);
  }

  // Sem LLM: busca e devolve os trechos agrupados por arquivo.
  async function modoExtrativo() {
    await trilha(`Buscando ${fraseDoAssunto(consulta)}`);
    const t0 = Date.now();
    const saida = await buscar({ repoIds: repos.map((r) => r._id), consulta, k: consulta.intencao === "localizar" ? 16 : 10 });
    passo("busca", null, { conceitos: consulta.conceitos.map((c) => c.termos) }, `${saida.resultados.length} trechos`, t0);
    await trilha(descreverAchados(saida.resultados));
    const primeira = !p.historico.some((h) => h.autor === "bot");
    return { texto: respostaExtrativa(saida, primeira), fontes: fontesDe(saida.resultados) };
  }

  // Pipeline (RAG clássico): busca uma vez, monta o prompt com os trechos e
  // pede UMA resposta ao modelo. Rápido e previsível.
  async function modoPipeline() {
    await trilha(`Buscando ${fraseDoAssunto(consulta)}`);
    let t0 = Date.now();
    // Passo 1 (opcional no context.md): o LLM traduz a pergunta em termos
    // prováveis do código. Ajuda muito quando a pergunta é em português e o código em inglês.
    const termos = await reescreverConsulta(p.conteudo, anterior);
    if (termos) await trilha(`Procurando por ${termos.split(" ").slice(0, 6).join(", ")}`);
    const comExtras = analisarConsulta(consulta.original, termos ? termos.split(" ") : []);
    const saida = await buscar({ repoIds: repos.map((r) => r._id), consulta: comExtras, k: 8, grafo: true });
    const resultados = saida.resultados;
    passo(
      "busca",
      null,
      { conceitos: comExtras.conceitos.map((c) => c.palavra), termos },
      resultados.map((r) => `${r.chunk.path}:L${r.chunk.linhaInicio}`).join(", "),
      t0,
    );
    await trilha(descreverAchados(resultados));

    const foco =
      consulta.intencao === "localizar"
        ? "A pessoa quer saber ONDE está: responda com a lista de arquivos relevantes e o papel de cada um, em uma linha cada."
        : "Explique o que o código faz, citando as linhas.";
    /** @type {MensagemChat[]} */
    const mensagens = [
      { role: "system", content: promptSistema(p.bot, "pipeline", nomesRepos) },
      ...historico(),
      {
        role: "user",
        content: `Trechos do código (podem incluir trechos pouco relevantes: ignore-os):\n\n${blocoTrechos(resultados)}\n\n${foco}\nSe os trechos não respondem, diga que não encontrou.${saida.faltando.length ? ` Nada foi encontrado sobre: ${saida.faltando.join(", ")}.` : ""}\n\nPergunta: ${p.conteudo}`,
      },
    ];
    await trilha("Escrevendo a resposta");
    t0 = Date.now();
    const r = await chat({ mensagens, aoToken, maxTokens: 1500 });
    contar(r.uso, mensagens, r.conteudo);
    passo("llm", null, { mensagens: mensagens.length }, `${r.conteudo.length} caracteres`, t0);
    return { texto: r.conteudo, fontes: fontesDe(resultados) };
  }

  // Agente: o modelo decide o que fazer. A cada volta ele pode pedir
  // ferramentas (buscar, ler arquivo, ver referências); executamos, devolvemos
  // o resultado e perguntamos de novo, até ele responder sem pedir nada.
  // Limites de passos, tokens e tempo evitam um loop caro e infinito.
  async function modoAgente() {
    /** @type {Fonte[]} */
    const fontes = [];
    const inicio = Date.now();
    /** @type {MensagemChat[]} */
    const mensagens = [{ role: "system", content: promptSistema(p.bot, "agente", nomesRepos) }, ...historico(), { role: "user", content: p.conteudo }];
    const ctx = { repos: repos.filter((r) => r.status === "pronto") };

    for (let i = 0; i < config.limites.agentePassos; i++) {
      const estourou = exec.tokensEntrada > config.limites.agenteTokensEntrada || Date.now() - inicio > config.limites.agenteTempoMs;
      if (estourou || i === config.limites.agentePassos - 1) {
        await trilha("Limite de exploração atingido, respondendo com o que já tenho");
        mensagens.push({ role: "user", content: "Limite de passos atingido. Responda agora, apenas com o que você já leu, citando as linhas." });
        const r = await chat({ mensagens, aoToken, maxTokens: 1500 });
        contar(r.uso, mensagens, r.conteudo);
        return { texto: r.conteudo, fontes };
      }
      const t0 = Date.now();
      if (i === 0) await trilha("Planejando como investigar");
      const r = await chat({ mensagens, ferramentas: definicoes, maxTokens: 1200 });
      contar(r.uso, mensagens, r.conteudo);
      passo("llm", null, { passo: i + 1 }, r.chamadas.length ? `pediu ${r.chamadas.map((c) => c.nome).join(", ")}` : "resposta final", t0);

      if (!r.chamadas.length) {
        // Resposta final já veio completa; publicamos de uma vez.
        return { texto: r.conteudo, fontes };
      }
      mensagens.push({ role: "assistant", content: r.conteudo || null, tool_calls: r.chamadas.map((c) => c.bruto) });
      for (const c of r.chamadas) {
        const t1 = Date.now();
        const saida = await executarFerramenta(c.nome, c.argumentos, ctx);
        fontes.push(...saida.fontes);
        await trilha(capitalizar(saida.descricao));
        passo("ferramenta", c.nome, c.argumentos, saida.texto, t1);
        mensagens.push({ role: "tool", tool_call_id: c.id, content: saida.texto.slice(0, 12_000) });
      }
    }
    return { texto: "Não consegui concluir a investigação.", fontes };
  }

  /**
   * Reescrita da consulta: o LLM sugere identificadores prováveis no código
   * ("login com Google" -> "signInWithGoogle oauth GoogleProvider").
   * @param {string} pergunta @param {string} anterior
   */
  async function reescreverConsulta(pergunta, anterior) {
    const t0 = Date.now();
    try {
      const r = await chat({
        mensagens: [
          {
            role: "system",
            content:
              "Você gera termos de busca para encontrar código. Responda SOMENTE com até 10 termos separados por espaço: identificadores prováveis (em inglês, camelCase ou snake_case), nomes de arquivos e palavras-chave técnicas. Nada mais.",
          },
          { role: "user", content: `${anterior ? `Contexto anterior: ${anterior.slice(0, 300)}\n` : ""}Pergunta: ${pergunta.slice(0, 600)}` },
        ],
        maxTokens: 60,
      });
      contar(r.uso, [], r.conteudo);
      const termos = r.conteudo
        .replace(/[`"',;\n]+/g, " ")
        .split(/\s+/)
        .filter((t) => /^[\w./-]{2,60}$/.test(t))
        .slice(0, 10)
        .join(" ");
      passo("llm", "reescrever_consulta", { pergunta }, termos, t0);
      return termos;
    } catch {
      return ""; // reescrita é otimização; sem ela a busca segue com a pergunta original
    }
  }

  // ---------- utilidades ----------

  /** Últimas 10 mensagens da conversa, cortadas para não estourar o contexto. @returns {MensagemChat[]} */
  function historico() {
    return p.historico.slice(-10).map((h) => ({ role: h.autor === "usuario" ? "user" : "assistant", content: h.conteudo.slice(0, 4000) }));
  }

  /** @param {{ entrada: number, saida: number }} uso @param {MensagemChat[]} mensagens @param {string} saida */
  function contar(uso, mensagens, saida) {
    exec.tokensEntrada += uso.entrada || mensagens.reduce((s, m) => s + estimarTokens(String("content" in m ? (m.content ?? "") : "")), 0);
    exec.tokensSaida += uso.saida || estimarTokens(saida);
  }

  /** @param {string} conteudo @param {Fonte[]} citacoes @param {string[]} removidas */
  async function finalizar(conteudo, citacoes, removidas) {
    await msgs.updateOne({ _id: p.mensagemId }, { $set: { conteudo, citacoes, status: "concluida", erro: null, atualizadoEm: agora() } });
    await d.collection("execucoes").updateOne(
      { _id: exec._id },
      {
        $set: {
          status: "concluida",
          finalizadoEm: agora(),
          passos: exec.passos,
          tokensEntrada: exec.tokensEntrada,
          tokensSaida: exec.tokensSaida,
          citacoesRemovidas: removidas,
        },
      },
    );
    await d.collection("conversas").updateOne({ _id: p.conversaId }, { $set: { atualizadoEm: agora() } });
    log("info", "bot respondeu", {
      correlationId,
      execucaoId: exec._id,
      modo: exec.modo,
      passos: exec.passos.length,
      citacoes: citacoes.length,
      removidas: removidas.length,
    });
  }
}

/**
 * Chamado quando o evento vai para a DLQ: a mensagem sai de "processando"
 * e o usuário vê o erro, em vez de um "digitando..." eterno.
 * @param {PayloadMensagem} p
 * @param {Error} erro
 */
export async function falhar(p, erro) {
  const d = await db();
  const msg = erro instanceof ErroPermanente ? erro.message : "Não consegui responder agora (o modelo ou a busca falharam). Tente de novo em instantes.";
  await d.collection("mensagens").updateOne({ _id: p.mensagemId }, { $set: { status: "falhou", erro: msg, atualizadoEm: agora() } });
  await d
    .collection("execucoes")
    .updateMany({ mensagemId: p.mensagemId, status: "rodando" }, { $set: { status: "falhou", erro: erro.message, finalizadoEm: agora() } });
}

/** @param {import("../busca/buscar.js").Resultado[]} resultados @returns {Fonte[]} */
function fontesDe(resultados) {
  return resultados.map((r) => ({
    repoId: r.chunk.repoId,
    ghOwner: r.repo.ghOwner,
    ghNome: r.repo.ghNome,
    path: r.chunk.path,
    linhaInicio: r.chunk.linhaInicio,
    linhaFim: r.chunk.linhaFim,
    commitSha: r.chunk.commitSha,
  }));
}

/** @param {import("../busca/buscar.js").Resultado[]} rs */
function descreverAchados(rs) {
  if (!rs.length) return "Não encontrei trechos relacionados";
  const arquivos = new Set(rs.map((r) => r.chunk.path));
  return `Encontrei ${rs.length} trechos em ${arquivos.size} arquivo${arquivos.size > 1 ? "s" : ""}`;
}

const capitalizar = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

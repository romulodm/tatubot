import { db } from "../db.js";
import { cosseno, embedConsulta, modeloEmbedding } from "../llm/embeddings.js";
import { tokenizar } from "../indexacao/tokenizar.js";
import { analisarConsulta, cobre, raiz } from "./consulta.js";

// Busca híbrida (context.md, seção 11), em memória sobre o índice do Mongo.
//
//   pergunta ─► conceitos (com sinônimos PT→EN) ─┬─► vetorial (cosseno)
//                                                 ├─► textual (BM25 sobre raízes)
//                                                 └─► caminho (conceitos no path)
//                         fusão RRF ─► × cobertura² ─► × prior do arquivo ─► filtro
//
// O RRF ordena; a COBERTURA decide o que é relevante: um trecho que fala de
// "autenticação" mas não de "modal" não responde "onde fica o modal de autenticação".
//
// Explicação passo a passo em docs/rag/05-busca-hibrida.md.

/** @typedef {import("../tipos.js").Chunk} Chunk */
/** @typedef {import("../tipos.js").Repositorio} Repositorio */
/** @typedef {import("./consulta.js").Consulta} Consulta */

/**
 * Chunk com os dados pré-calculados que a busca usa a cada pergunta.
 * @typedef {object} ChunkIndexado
 * @property {Chunk} c
 * @property {string[]} raizes raízes únicas de símbolo + caminho + conteúdo
 * @property {Map<string, number>} tf frequência de cada raiz (para o BM25)
 * @property {number} tamanho total de termos do trecho
 * @property {string[]} raizesCaminho
 * @property {string[]} raizesArquivo só o nome do arquivo
 * @property {number} prior peso do tipo de arquivo (teste, tradução... valem menos)
 */

/**
 * @typedef {object} IndiceRepo
 * @property {number} versao versaoIndice do repositório quando o cache foi montado
 * @property {string | null} modelo
 * @property {ChunkIndexado[]} chunks
 * @property {Map<string, number>} df em quantos chunks cada raiz aparece
 */

/**
 * @typedef {object} Resultado
 * @property {Chunk} chunk
 * @property {{ _id: string, ghOwner: string, ghNome: string }} repo
 * @property {{ vetorial: number | null, textual: number | null, caminho: number | null, rrf: number, cobertura: number, final: number, posVetorial: number | null, posTextual: number | null, posCaminho: number | null }} scores
 * @property {boolean} definicao conceitos no caminho ou no símbolo: o arquivo É sobre o assunto, não só menciona
 * @property {boolean} viaGrafo entrou pela expansão de referências, não pela busca
 */

/**
 * @typedef {object} SaidaBusca
 * @property {Resultado[]} resultados
 * @property {string[]} avisos
 * @property {Consulta} consulta
 * @property {string[]} faltando conceitos da pergunta que nenhum trecho cobriu
 */

// Cache do índice em memória, por repositório. É invalidado sozinho: cada
// indexação incrementa `versaoIndice` e a versão é conferida a cada busca.
// Funciona igual nos dois processos (api e worker), cada um com o seu cache.
/** @type {Map<string, IndiceRepo>} */
const cache = new Map();

/** @param {Repositorio} repo @returns {Promise<IndiceRepo>} */
async function indiceDe(repo) {
  const atual = cache.get(repo._id);
  if (atual && atual.versao === repo.versaoIndice) return atual;
  const docs = /** @type {Chunk[]} */ (/** @type {unknown} */ (await (await db()).collection("chunks").find({ repoId: repo._id }).toArray()));
  /** @type {Map<string, number>} */
  const df = new Map();
  const chunks = docs.map((c) => {
    const lista = c.tokens.map(raiz);
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const r of lista) tf.set(r, (tf.get(r) ?? 0) + 1);
    for (const r of tf.keys()) df.set(r, (df.get(r) ?? 0) + 1);
    const nomeArquivo = c.path.split("/").pop() ?? c.path;
    // Segmentos dinâmicos ("app/[locale]/...") são parâmetro de rota, não assunto.
    const caminhoSemParametros = c.path.replace(/\[[^\]]*\]/g, " ");
    return {
      c,
      raizes: [...new Set([...tokenizar(`${c.simbolo ?? ""} ${c.conteudo}`), ...tokenizar(caminhoSemParametros.replace(/[/._-]/g, " "))].map(raiz))],
      tf,
      tamanho: lista.length,
      raizesCaminho: [...new Set(tokenizar(caminhoSemParametros.replace(/[/._-]/g, " ")).map(raiz))],
      raizesArquivo: [...new Set(tokenizar(nomeArquivo.replace(/[._-]/g, " ")).map(raiz))],
      prior: priorDoArquivo(c),
    };
  });
  const idx = { versao: repo.versaoIndice, modelo: repo.embedModelo, chunks, df };
  cache.set(repo._id, idx);
  // Limite simples: no máximo 30 repositórios em memória (sai o mais antigo).
  if (cache.size > 30) cache.delete(/** @type {string} */ (cache.keys().next().value));
  return idx;
}

// Arquivos que raramente são a resposta, a menos que a pergunta fale deles.
const RE_TRADUCAO = /(^|\/)(legal|messages|locales?|i18n|translations?|lang)\/|\.(json|ya?ml|lock)$/i;
const RE_TESTE = /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|(^|\/)e2e\/|fixtures?\/)/i;
const RE_MIGRACAO = /(^|\/)migrations?\//i;

/** @param {Chunk} c */
function priorDoArquivo(c) {
  if (RE_TRADUCAO.test(c.path)) return 0.35;
  if (RE_TESTE.test(c.path)) return 0.5;
  if (RE_MIGRACAO.test(c.path)) return 0.5;
  if (c.tipo === "secao_doc") return 0.7;
  return 1;
}

/** @param {ChunkIndexado} ci @param {Consulta} consulta */
function priorAjustado(ci, consulta) {
  if (ci.prior === 1) return 1;
  // "onde estão os testes do login?" -> testes deixam de ser penalizados
  const fala = (/** @type {RegExp} */ re) => consulta.conceitos.some((k) => re.test(k.termos.join(" ")));
  if (RE_TESTE.test(ci.c.path) && fala(/\b(test|spec)/)) return 1;
  if (RE_TRADUCAO.test(ci.c.path) && fala(/\b(i18n|translat|locale|privacy|legal|messag|config)/)) return 1;
  if (RE_MIGRACAO.test(ci.c.path) && fala(/\bmigrat/)) return 1;
  if (ci.c.tipo === "secao_doc" && fala(/\b(doc|readme|guia|instal|privacy)/)) return 1;
  return ci.prior;
}

const K_RRF = 60; // constante do Reciprocal Rank Fusion; 60 é o valor do artigo original
const TOP = 40; // quantos candidatos cada ranking entrega para a fusão

/**
 * Busca híbrida nos repositórios indicados.
 *
 * IMPORTANTE: `repoIds` já deve vir autorizado (os repositórios do bot ou do
 * dono). A busca não sabe quem está perguntando; ela só nunca sai da lista.
 *
 * @param {object} o
 * @param {string[]} o.repoIds
 * @param {string | Consulta} o.consulta pergunta em texto ou já analisada
 * @param {number} [o.k] quantos resultados (padrão 6)
 * @param {boolean} [o.grafo] expandir com quem chama / é chamado pelos melhores
 * @param {string[]} [o.termosExtras] termos sugeridos pelo LLM (modo pipeline)
 * @returns {Promise<SaidaBusca>}
 */
export async function buscar(o) {
  const consulta = typeof o.consulta === "string" ? analisarConsulta(o.consulta, o.termosExtras) : o.consulta;
  const k = o.k ?? 6;
  /** @type {string[]} */
  const avisos = [];
  const vazio = (/** @type {string} */ aviso = "") => ({
    resultados: [],
    avisos: aviso ? [aviso] : [],
    consulta,
    faltando: consulta.conceitos.map((c) => c.palavra),
  });

  if (!consulta.conceitos.length && !consulta.termosBusca.length) return vazio();
  const d = await db();
  const filtro = { _id: { $in: o.repoIds }, status: { $in: ["pronto", "indexando"] } };
  const repos = /** @type {Repositorio[]} */ (
    /** @type {unknown} */ (
      await d
        .collection("repositorios")
        .find(/** @type {any} */ (filtro))
        .toArray()
    )
  );
  if (!repos.length) return vazio("Nenhum repositório indexado para buscar.");
  const indices = await Promise.all(repos.map(indiceDe));
  const todos = indices.flatMap((i) => i.chunks);
  if (!todos.length) return vazio("Os repositórios ainda não têm trechos indexados.");

  // Cobertura: quanto dos conceitos da pergunta o trecho contém (conteúdo ou caminho),
  // ponderado pela raridade de cada conceito (como o IDF): em "componente de troca de
  // idioma", "componente" aparece em quase tudo e pesa pouco; "idioma" pesa muito.
  const n = consulta.conceitos.length || 1;
  const presenca = consulta.conceitos.map((k) => new Set(todos.filter((ci) => cobre(k, ci.raizes) || cobre(k, ci.raizesCaminho))));
  const pesos = presenca.map((p) => Math.log(1 + todos.length / (1 + p.size)));
  const somaPesos = pesos.reduce((a, b) => a + b, 0) || 1;
  /** @type {Map<ChunkIndexado, number>} */
  const cobertura = new Map();
  for (const ci of todos) {
    let soma = 0;
    presenca.forEach((p, i) => p.has(ci) && (soma += pesos[i]));
    cobertura.set(ci, soma / somaPesos);
  }

  // 1. Vetorial — a consulta inclui as traduções, o que ajuda até o embedding local.
  const modelo = modeloEmbedding();
  const remoto = !modelo.startsWith("local-");
  const compativeis = indices.filter((i) => i.modelo === modelo).flatMap((i) => i.chunks);
  if (compativeis.length < todos.length) {
    avisos.push("Alguns repositórios foram indexados com outro modelo de embedding; sincronize-os para usar a busca vetorial.");
  }
  /** @type {{ ci: ChunkIndexado, s: number }[]} */
  let rankVet = [];
  if (compativeis.length) {
    const q = await embedConsulta(`${consulta.original}\n${consulta.termosBusca.join(" ")}`);
    rankVet = compativeis
      .map((ci) => ({ ci, s: cosseno(q, ci.c.embedding) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, TOP);
  }

  // 2. Textual — BM25 sobre raízes (pega identificadores exatos que o embedding erra).
  const N = todos.length;
  /** @type {Map<string, number>} */
  const df = new Map();
  for (const i of indices) for (const t of consulta.termosBusca) df.set(t, (df.get(t) ?? 0) + (i.df.get(t) ?? 0));
  const media = todos.reduce((s, ci) => s + ci.tamanho, 0) / N || 1;
  const rankTxt = todos
    .map((ci) => ({ ci, s: bm25(ci, consulta.termosBusca, df, N, media) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP);

  // 3. Caminho — o nome da pasta e do arquivo costuma ser a melhor pista ("components/auth/AuthModal.tsx").
  const rankCam = todos
    .map((ci) => {
      const noCaminho = consulta.conceitos.filter((k) => cobre(k, ci.raizesCaminho)).length;
      const noArquivo = consulta.conceitos.filter((k) => cobre(k, ci.raizesArquivo)).length;
      return { ci, s: noCaminho / n + noArquivo / n };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP);

  // Fusão RRF: score = Σ 1 / (60 + posição) em cada lista.
  // Só a POSIÇÃO importa, não o valor do score. Isso resolve o problema de
  // somar coisas em escalas diferentes (cosseno vai de 0 a 1, BM25 vai de 0 a
  // "quanto for"). Quem aparece bem colocado em mais de uma lista sobe.
  /** @typedef {{ ci: ChunkIndexado, rrf: number, v: number | null, t: number | null, p: number | null, pv: number | null, pt: number | null, pc: number | null }} Linha */
  /** @type {Map<ChunkIndexado, Linha>} */
  const fusao = new Map();
  const pegar = (/** @type {ChunkIndexado} */ ci) => {
    if (!fusao.has(ci)) fusao.set(ci, { ci, rrf: 0, v: null, t: null, p: null, pv: null, pt: null, pc: null });
    return /** @type {Linha} */ (fusao.get(ci));
  };
  rankVet.forEach(({ ci, s }, i) => (Object.assign(pegar(ci), { v: s, pv: i + 1 }).rrf += 1 / (K_RRF + i + 1)));
  rankTxt.forEach(({ ci, s }, i) => (Object.assign(pegar(ci), { t: s, pt: i + 1 }).rrf += 1 / (K_RRF + i + 1)));
  rankCam.forEach(({ ci, s }, i) => (Object.assign(pegar(ci), { p: s, pc: i + 1 }).rrf += 1 / (K_RRF + i + 1)));

  let linhas = [...fusao.values()].map((x) => {
    const cob = cobertura.get(x.ci) ?? 0;
    return { ...x, cob, final: x.rrf * (0.15 + cob * cob) * priorAjustado(x.ci, consulta) };
  });

  // Filtro de relevância: só fica quem cobre tanto quanto o melhor.
  // Com embedding local, trecho sem nenhum conceito é ruído e sai; com um
  // modelo de verdade, a similaridade semântica sozinha ainda vale.
  const maxCob = Math.max(0, ...linhas.map((x) => x.cob));
  if (maxCob > 0) linhas = linhas.filter((x) => x.cob >= maxCob * 0.6);
  else if (remoto) linhas = linhas.filter((x) => x.v !== null && x.v >= (rankVet[0]?.s ?? 1) * 0.85);
  else linhas = [];
  linhas.sort((a, b) => b.final - a.final);
  // Corte relativo: muito abaixo do melhor resultado é ruído, mesmo cobrindo os conceitos.
  const melhor = linhas[0]?.final ?? 0;
  const topo = linhas.filter((x) => x.final >= melhor * 0.35).slice(0, k);

  const faltando = consulta.conceitos.filter((kc) => !topo.some((x) => cobre(kc, x.ci.raizes) || cobre(kc, x.ci.raizesCaminho))).map((kc) => kc.palavra);

  // 4. Expansão por grafo (1 salto): quem os 5 primeiros chamam e quem os chama.
  /** @type {ChunkIndexado[]} */
  const extras = [];
  if (o.grafo && topo.length) {
    const ja = new Set(topo.map((x) => x.ci));
    const nomesUsados = new Set(topo.map((x) => nomeCurto(x.ci.c.simbolo)));
    const codigo = (/** @type {Chunk} */ c) => c.tipo === "funcao" || c.tipo === "metodo" || c.tipo === "classe";
    for (const { ci } of topo.slice(0, 5)) {
      if (!codigo(ci.c)) continue;
      const nome = nomeCurto(ci.c.simbolo);
      for (const outro of todos) {
        if (extras.length >= 5) break;
        const nomeOutro = nomeCurto(outro.c.simbolo);
        if (!codigo(outro.c) || ja.has(outro) || outro.c.repoId !== ci.c.repoId || !nomeOutro || nomesUsados.has(nomeOutro) || outro.prior < 1) continue;
        if (ci.c.referencias.includes(nomeOutro) || (!!nome && outro.c.referencias.includes(nome))) {
          extras.push(outro);
          ja.add(outro);
          nomesUsados.add(nomeOutro);
        }
      }
    }
  }

  const repoPorId = new Map(repos.map((r) => [r._id, { _id: r._id, ghOwner: r.ghOwner, ghNome: r.ghNome }]));
  // "É definição" quando os conceitos de maior peso estão no caminho/símbolo.
  const pesoMax = Math.max(...pesos);
  const ehDefinicao = (/** @type {ChunkIndexado} */ ci) => {
    const raizesNome = [...ci.raizesCaminho, ...tokenizar(ci.c.simbolo ?? "").map(raiz)];
    return consulta.conceitos.every((k, i) => pesos[i] < pesoMax * 0.35 || cobre(k, raizesNome));
  };
  /** @type {Resultado[]} */
  const resultados = [
    ...topo.map((x) => ({
      chunk: x.ci.c,
      repo: /** @type {Resultado["repo"]} */ (repoPorId.get(x.ci.c.repoId)),
      scores: {
        vetorial: x.v,
        textual: x.t,
        caminho: x.p,
        rrf: x.rrf,
        cobertura: x.cob,
        final: x.final,
        posVetorial: x.pv,
        posTextual: x.pt,
        posCaminho: x.pc,
      },
      definicao: ehDefinicao(x.ci),
      viaGrafo: false,
    })),
    ...extras.map((ci) => ({
      chunk: ci.c,
      repo: /** @type {Resultado["repo"]} */ (repoPorId.get(ci.c.repoId)),
      scores: {
        vetorial: null,
        textual: null,
        caminho: null,
        rrf: 0,
        cobertura: cobertura.get(ci) ?? 0,
        final: 0,
        posVetorial: null,
        posTextual: null,
        posCaminho: null,
      },
      definicao: false,
      viaGrafo: true,
    })),
  ];
  return { resultados, avisos, consulta, faltando };
}

/**
 * BM25: o clássico da busca textual. Para cada termo da pergunta soma
 *   idf (termo raro vale mais) × tf saturado (repetir ajuda, mas cada vez menos)
 * com correção pelo tamanho do trecho (trecho enorme não ganha só por ser grande).
 * @param {ChunkIndexado} ci @param {string[]} termos @param {Map<string, number>} df
 * @param {number} N total de trechos @param {number} media tamanho médio dos trechos
 */
function bm25(ci, termos, df, N, media, k1 = 1.2, b = 0.75) {
  let s = 0;
  for (const t of termos) {
    const tf = ci.tf.get(t);
    if (!tf) continue;
    const n = df.get(t) ?? 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    s += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * ci.tamanho) / media)));
  }
  return s;
}

// "JwtService.verify" -> "verify"; "login, logout" -> "login"
/** @param {string | null} s */
function nomeCurto(s) {
  if (!s) return "";
  const base = s.split(/[\s(,]/)[0];
  return base.split(".").pop() ?? base;
}

import { db } from "../db.js";
import { cosseno, embedConsulta, modeloEmbedding } from "../llm.js";
import { analisarConsulta, cobre, raiz, tokenizar } from "./consulta.js";

// índice em memória por repositório, refeito quando versaoIndice muda
const cache = new Map();

async function indiceDe(repo) {
  const atual = cache.get(repo._id);
  if (atual && atual.versao === repo.versaoIndice) return atual;
  const docs = await (await db()).collection("chunks").find({ repoId: repo._id }).toArray();
  const df = new Map();
  const chunks = docs.map((c) => {
    const lista = c.tokens.map(raiz);
    const tf = new Map();
    for (const r of lista) tf.set(r, (tf.get(r) ?? 0) + 1);
    for (const r of tf.keys()) df.set(r, (df.get(r) ?? 0) + 1);
    const nomeArquivo = c.path.split("/").pop() ?? c.path;
    const caminhoSemParametros = c.path.replace(/\[[^\]]*\]/g, " ");
    return {
      c,
      raizes: [
        ...new Set(
          [...tokenizar(`${c.simbolo ?? ""} ${c.conteudo}`), ...tokenizar(caminhoSemParametros.replace(/[/._-]/g, " "))].map(raiz),
        ),
      ],
      tf,
      tamanho: lista.length,
      raizesCaminho: [...new Set(tokenizar(caminhoSemParametros.replace(/[/._-]/g, " ")).map(raiz))],
      raizesArquivo: [...new Set(tokenizar(nomeArquivo.replace(/[._-]/g, " ")).map(raiz))],
      prior: priorDoArquivo(c),
    };
  });
  const idx = { versao: repo.versaoIndice, modelo: repo.embedModelo, chunks, df };
  cache.set(repo._id, idx);
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  return idx;
}

const RE_TRADUCAO = /(^|\/)(legal|messages|locales?|i18n|translations?|lang)\/|\.(json|ya?ml|lock)$/i;
const RE_TESTE = /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|(^|\/)e2e\/|fixtures?\/)/i;
const RE_MIGRACAO = /(^|\/)migrations?\//i;

// traduções, testes, migrações e docs raramente são a resposta, a não ser que a pergunta fale deles
function priorDoArquivo(c) {
  if (RE_TRADUCAO.test(c.path)) return 0.35;
  if (RE_TESTE.test(c.path)) return 0.5;
  if (RE_MIGRACAO.test(c.path)) return 0.5;
  if (c.tipo === "secao_doc") return 0.7;
  return 1;
}

function priorAjustado(ci, consulta) {
  if (ci.prior === 1) return 1;
  const fala = (re) => consulta.conceitos.some((k) => re.test(k.termos.join(" ")));
  if (RE_TESTE.test(ci.c.path) && fala(/\b(test|spec)/)) return 1;
  if (RE_TRADUCAO.test(ci.c.path) && fala(/\b(i18n|translat|locale|privacy|legal|messag|config)/)) return 1;
  if (RE_MIGRACAO.test(ci.c.path) && fala(/\bmigrat/)) return 1;
  if (ci.c.tipo === "secao_doc" && fala(/\b(doc|readme|guia|instal|privacy)/)) return 1;
  return ci.prior;
}

const K_RRF = 60;
const TOP = 40;

export async function buscar(o) {
  const consulta = typeof o.consulta === "string" ? analisarConsulta(o.consulta, o.termosExtras) : o.consulta;
  const k = o.k ?? 6;
  const avisos = [];
  const vazio = (aviso = "") => ({
    resultados: [],
    avisos: aviso ? [aviso] : [],
    consulta,
    faltando: consulta.conceitos.map((c) => c.palavra),
  });

  if (!consulta.conceitos.length && !consulta.termosBusca.length) return vazio();
  const d = await db();
  const filtro = { _id: { $in: o.repoIds }, status: { $in: ["pronto", "indexando"] } };
  const repos = await d.collection("repositorios").find(filtro).toArray();
  if (!repos.length) return vazio("Nenhum repositório indexado para buscar.");
  const indices = await Promise.all(repos.map(indiceDe));
  const todos = indices.flatMap((i) => i.chunks);
  if (!todos.length) return vazio("Os repositórios ainda não têm trechos indexados.");

  // cobertura: quanto dos conceitos da pergunta o trecho cobre, pesando os conceitos raros
  const n = consulta.conceitos.length || 1;
  const presenca = consulta.conceitos.map((k) => new Set(todos.filter((ci) => cobre(k, ci.raizes) || cobre(k, ci.raizesCaminho))));
  const pesos = presenca.map((p) => Math.log(1 + todos.length / (1 + p.size)));
  const somaPesos = pesos.reduce((a, b) => a + b, 0) || 1;
  const cobertura = new Map();
  for (const ci of todos) {
    let soma = 0;
    presenca.forEach((p, i) => p.has(ci) && (soma += pesos[i]));
    cobertura.set(ci, soma / somaPesos);
  }

  // três rankings: vetorial (significado), BM25 (identificadores) e caminho do arquivo
  const modelo = modeloEmbedding();
  const remoto = !modelo.startsWith("local-");
  const compativeis = indices.filter((i) => i.modelo === modelo).flatMap((i) => i.chunks);
  if (compativeis.length < todos.length) {
    avisos.push("Alguns repositórios foram indexados com outro modelo de embedding; sincronize-os para usar a busca vetorial.");
  }
  let rankVet = [];
  if (compativeis.length) {
    const q = await embedConsulta(`${consulta.original}\n${consulta.termosBusca.join(" ")}`);
    rankVet = compativeis
      .map((ci) => ({ ci, s: cosseno(q, ci.c.embedding) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, TOP);
  }

  const N = todos.length;
  const df = new Map();
  for (const i of indices) for (const t of consulta.termosBusca) df.set(t, (df.get(t) ?? 0) + (i.df.get(t) ?? 0));
  const media = todos.reduce((s, ci) => s + ci.tamanho, 0) / N || 1;
  const rankTxt = todos
    .map((ci) => ({ ci, s: bm25(ci, consulta.termosBusca, df, N, media) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP);

  const rankCam = todos
    .map((ci) => {
      const noCaminho = consulta.conceitos.filter((k) => cobre(k, ci.raizesCaminho)).length;
      const noArquivo = consulta.conceitos.filter((k) => cobre(k, ci.raizesArquivo)).length;
      return { ci, s: noCaminho / n + noArquivo / n };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP);

  // fusão por posição (RRF), depois multiplicada pela cobertura e pelo prior
  const fusao = new Map();
  const pegar = (ci) => {
    if (!fusao.has(ci)) fusao.set(ci, { ci, rrf: 0, v: null, t: null, p: null, pv: null, pt: null, pc: null });
    return fusao.get(ci);
  };
  rankVet.forEach(({ ci, s }, i) => (Object.assign(pegar(ci), { v: s, pv: i + 1 }).rrf += 1 / (K_RRF + i + 1)));
  rankTxt.forEach(({ ci, s }, i) => (Object.assign(pegar(ci), { t: s, pt: i + 1 }).rrf += 1 / (K_RRF + i + 1)));
  rankCam.forEach(({ ci, s }, i) => (Object.assign(pegar(ci), { p: s, pc: i + 1 }).rrf += 1 / (K_RRF + i + 1)));

  let linhas = [...fusao.values()].map((x) => {
    const cob = cobertura.get(x.ci) ?? 0;
    return { ...x, cob, final: x.rrf * (0.15 + cob * cob) * priorAjustado(x.ci, consulta) };
  });

  const maxCob = Math.max(0, ...linhas.map((x) => x.cob));
  if (maxCob > 0) linhas = linhas.filter((x) => x.cob >= maxCob * 0.6);
  else if (remoto) linhas = linhas.filter((x) => x.v !== null && x.v >= (rankVet[0]?.s ?? 1) * 0.85);
  else linhas = [];
  linhas.sort((a, b) => b.final - a.final);
  const melhor = linhas[0]?.final ?? 0;
  const topo = linhas.filter((x) => x.final >= melhor * 0.35).slice(0, k);

  const faltando = consulta.conceitos
    .filter((kc) => !topo.some((x) => cobre(kc, x.ci.raizes) || cobre(kc, x.ci.raizesCaminho)))
    .map((kc) => kc.palavra);

  // grafo: traz quem chama ou é chamado pelos melhores trechos
  const extras = [];
  if (o.grafo && topo.length) {
    const ja = new Set(topo.map((x) => x.ci));
    const nomesUsados = new Set(topo.map((x) => nomeCurto(x.ci.c.simbolo)));
    const codigo = (c) => c.tipo === "funcao" || c.tipo === "metodo" || c.tipo === "classe";
    for (const { ci } of topo.slice(0, 5)) {
      if (!codigo(ci.c)) continue;
      const nome = nomeCurto(ci.c.simbolo);
      for (const outro of todos) {
        if (extras.length >= 5) break;
        const nomeOutro = nomeCurto(outro.c.simbolo);
        if (
          !codigo(outro.c) ||
          ja.has(outro) ||
          outro.c.repoId !== ci.c.repoId ||
          !nomeOutro ||
          nomesUsados.has(nomeOutro) ||
          outro.prior < 1
        )
          continue;
        if (ci.c.referencias.includes(nomeOutro) || (!!nome && outro.c.referencias.includes(nome))) {
          extras.push(outro);
          ja.add(outro);
          nomesUsados.add(nomeOutro);
        }
      }
    }
  }

  const repoPorId = new Map(repos.map((r) => [r._id, { _id: r._id, ghOwner: r.ghOwner, ghNome: r.ghNome }]));
  const pesoMax = Math.max(...pesos);
  const ehDefinicao = (ci) => {
    const raizesNome = [...ci.raizesCaminho, ...tokenizar(ci.c.simbolo ?? "").map(raiz)];
    return consulta.conceitos.every((k, i) => pesos[i] < pesoMax * 0.35 || cobre(k, raizesNome));
  };
  const resultados = [
    ...topo.map((x) => ({
      chunk: x.ci.c,
      repo: repoPorId.get(x.ci.c.repoId),
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
      repo: repoPorId.get(ci.c.repoId),
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

function nomeCurto(s) {
  if (!s) return "";
  const base = s.split(/[\s(,]/)[0];
  return base.split(".").pop() ?? base;
}

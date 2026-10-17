import { db } from "../db";
import { cosseno, embedConsulta, modeloEmbedding } from "../llm/embeddings";
import { tokenizar } from "../indexacao/tokenizar";
import type { Chunk, Repositorio } from "../tipos";
import { analisarConsulta, cobre, raiz, type Consulta } from "./consulta";

// Busca híbrida (context.md, seção 11), em memória sobre o índice do Mongo.
//
//   pergunta ─► conceitos (com sinônimos PT→EN) ─┬─► vetorial (cosseno)
//                                                 ├─► textual (BM25 sobre raízes)
//                                                 └─► caminho (conceitos no path)
//                         fusão RRF ─► × cobertura² ─► × prior do arquivo ─► filtro
//
// O RRF ordena; a COBERTURA decide o que é relevante: um trecho que fala de
// "autenticação" mas não de "modal" não responde "onde fica o modal de autenticação".

interface ChunkIndexado {
  c: Chunk;
  raizes: string[]; // raízes únicas de símbolo + caminho + conteúdo
  tf: Map<string, number>;
  tamanho: number;
  raizesCaminho: string[];
  raizesArquivo: string[]; // só o nome do arquivo
  prior: number;
}

interface IndiceRepo {
  versao: number;
  modelo: string | null;
  chunks: ChunkIndexado[];
  df: Map<string, number>;
}

const g = globalThis as unknown as { _indicesBusca?: Map<string, IndiceRepo> };
const cache = (g._indicesBusca ??= new Map());

async function indiceDe(repo: Repositorio): Promise<IndiceRepo> {
  const atual = cache.get(repo._id);
  if (atual && atual.versao === repo.versaoIndice) return atual;
  const docs = await (await db()).collection<Chunk>("chunks").find({ repoId: repo._id }).toArray();
  const df = new Map<string, number>();
  const chunks = docs.map((c) => {
    const lista = c.tokens.map(raiz);
    const tf = new Map<string, number>();
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
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return idx;
}

// Arquivos que raramente são a resposta, a menos que a pergunta fale deles.
const RE_TRADUCAO = /(^|\/)(legal|messages|locales?|i18n|translations?|lang)\/|\.(json|ya?ml|lock)$/i;
const RE_TESTE = /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|(^|\/)e2e\/|fixtures?\/)/i;
const RE_MIGRACAO = /(^|\/)migrations?\//i;

function priorDoArquivo(c: Chunk): number {
  if (RE_TRADUCAO.test(c.path)) return 0.35;
  if (RE_TESTE.test(c.path)) return 0.5;
  if (RE_MIGRACAO.test(c.path)) return 0.5;
  if (c.tipo === "secao_doc") return 0.7;
  return 1;
}

function priorAjustado(ci: ChunkIndexado, consulta: Consulta): number {
  if (ci.prior === 1) return 1;
  // "onde estão os testes do login?" -> testes deixam de ser penalizados
  const fala = (re: RegExp) => consulta.conceitos.some((k) => re.test(k.termos.join(" ")));
  if (RE_TESTE.test(ci.c.path) && fala(/\b(test|spec)/)) return 1;
  if (RE_TRADUCAO.test(ci.c.path) && fala(/\b(i18n|translat|locale|privacy|legal|messag|config)/)) return 1;
  if (RE_MIGRACAO.test(ci.c.path) && fala(/\bmigrat/)) return 1;
  if (ci.c.tipo === "secao_doc" && fala(/\b(doc|readme|guia|instal|privacy)/)) return 1;
  return ci.prior;
}

export interface Resultado {
  chunk: Chunk;
  repo: Pick<Repositorio, "_id" | "ghOwner" | "ghNome">;
  scores: {
    vetorial: number | null;
    textual: number | null;
    caminho: number | null;
    rrf: number;
    cobertura: number;
    final: number;
    posVetorial: number | null;
    posTextual: number | null;
    posCaminho: number | null;
  };
  // Conceitos presentes no caminho ou no nome do símbolo: o arquivo É sobre o assunto,
  // não só menciona ou usa.
  definicao: boolean;
  viaGrafo: boolean;
}

export interface SaidaBusca {
  resultados: Resultado[];
  avisos: string[];
  consulta: Consulta;
  faltando: string[]; // conceitos da pergunta que nenhum trecho cobriu
}

const K_RRF = 60;
const TOP = 40;

// repoIds JÁ devem vir autorizados (do bot / do dono). Toda busca é restrita a eles.
export async function buscar(o: { repoIds: string[]; consulta: string | Consulta; k?: number; grafo?: boolean; termosExtras?: string[] }): Promise<SaidaBusca> {
  const consulta = typeof o.consulta === "string" ? analisarConsulta(o.consulta, o.termosExtras) : o.consulta;
  const k = o.k ?? 6;
  const avisos: string[] = [];
  const vazio = (aviso?: string): SaidaBusca => ({ resultados: [], avisos: aviso ? [aviso] : [], consulta, faltando: consulta.conceitos.map((c) => c.palavra) });

  if (!consulta.conceitos.length && !consulta.termosBusca.length) return vazio();
  const d = await db();
  const repos = await d.collection<Repositorio>("repositorios").find({ _id: { $in: o.repoIds }, status: { $in: ["pronto", "indexando"] } }).toArray();
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
  const cobertura = new Map<ChunkIndexado, number>();
  for (const ci of todos) {
    let soma = 0;
    presenca.forEach((p, i) => p.has(ci) && (soma += pesos[i]));
    cobertura.set(ci, soma / somaPesos);
  }

  // 1. Vetorial — a consulta inclui as traduções, o que ajuda até o embedding local.
  const modelo = modeloEmbedding();
  const remoto = !modelo.startsWith("local-");
  const compativeis = indices.filter((i) => i.modelo === modelo).flatMap((i) => i.chunks);
  if (compativeis.length < todos.length) avisos.push("Alguns repositórios foram indexados com outro modelo de embedding; sincronize-os para usar a busca vetorial.");
  let rankVet: { ci: ChunkIndexado; s: number }[] = [];
  if (compativeis.length) {
    const q = await embedConsulta(`${consulta.original}\n${consulta.termosBusca.join(" ")}`);
    rankVet = compativeis.map((ci) => ({ ci, s: cosseno(q, ci.c.embedding) })).sort((a, b) => b.s - a.s).slice(0, TOP);
  }

  // 2. Textual — BM25 sobre raízes (pega identificadores exatos que o embedding erra).
  const N = todos.length;
  const df = new Map<string, number>();
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
  type Linha = { ci: ChunkIndexado; rrf: number; v: number | null; t: number | null; p: number | null; pv: number | null; pt: number | null; pc: number | null };
  const fusao = new Map<ChunkIndexado, Linha>();
  const pegar = (ci: ChunkIndexado) => fusao.get(ci) ?? fusao.set(ci, { ci, rrf: 0, v: null, t: null, p: null, pv: null, pt: null, pc: null }).get(ci)!;
  rankVet.forEach(({ ci, s }, i) => Object.assign(pegar(ci), { v: s, pv: i + 1 }).rrf += 1 / (K_RRF + i + 1));
  rankTxt.forEach(({ ci, s }, i) => Object.assign(pegar(ci), { t: s, pt: i + 1 }).rrf += 1 / (K_RRF + i + 1));
  rankCam.forEach(({ ci, s }, i) => Object.assign(pegar(ci), { p: s, pc: i + 1 }).rrf += 1 / (K_RRF + i + 1));

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
  const extras: ChunkIndexado[] = [];
  if (o.grafo && topo.length) {
    const ja = new Set(topo.map((x) => x.ci));
    const nomesUsados = new Set(topo.map((x) => nomeCurto(x.ci.c.simbolo)));
    const codigo = (c: Chunk) => c.tipo === "funcao" || c.tipo === "metodo" || c.tipo === "classe";
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
  const ehDefinicao = (ci: ChunkIndexado) => {
    const raizesNome = [...ci.raizesCaminho, ...tokenizar(ci.c.simbolo ?? "").map(raiz)];
    return consulta.conceitos.every((k, i) => pesos[i] < pesoMax * 0.35 || cobre(k, raizesNome));
  };
  const resultados: Resultado[] = [
    ...topo.map((x) => ({
      chunk: x.ci.c,
      repo: repoPorId.get(x.ci.c.repoId)!,
      scores: { vetorial: x.v, textual: x.t, caminho: x.p, rrf: x.rrf, cobertura: x.cob, final: x.final, posVetorial: x.pv, posTextual: x.pt, posCaminho: x.pc },
      definicao: ehDefinicao(x.ci),
      viaGrafo: false,
    })),
    ...extras.map((ci) => ({
      chunk: ci.c,
      repo: repoPorId.get(ci.c.repoId)!,
      scores: { vetorial: null, textual: null, caminho: null, rrf: 0, cobertura: cobertura.get(ci) ?? 0, final: 0, posVetorial: null, posTextual: null, posCaminho: null },
      definicao: false,
      viaGrafo: true,
    })),
  ];
  return { resultados, avisos, consulta, faltando };
}

function bm25(ci: ChunkIndexado, termos: string[], df: Map<string, number>, N: number, media: number, k1 = 1.2, b = 0.75): number {
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
function nomeCurto(s: string | null): string {
  if (!s) return "";
  const base = s.split(/[\s(,]/)[0];
  return base.split(".").pop() ?? base;
}

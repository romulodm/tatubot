import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../db.js";
import { buscar } from "../busca/buscar.js";
import { dirRepo } from "../indexacao/indexar.js";

const MAX_LINHAS_LEITURA = 200;

// Ferramentas do modo agente. Toda leitura registra o trecho visto, que é o que o bot pode citar.
export const definicoes = [
  fn(
    "buscar_semantico",
    "Busca trechos de código por significado e por termos. Use primeiro para localizar onde algo é implementado.",
    {
      consulta: { type: "string", description: "O que procurar, em linguagem natural ou com nomes de funções" },
      k: { type: "integer", description: "Quantos trechos (padrão 6, máx. 10)" },
    },
    ["consulta"],
  ),
  fn(
    "buscar_texto",
    "Procura um termo literal (nome de função, string, rota) em todos os arquivos indexados. Retorna linhas onde aparece.",
    {
      termo: { type: "string", description: "Texto exato a procurar" },
    },
    ["termo"],
  ),
  fn(
    "ler_arquivo",
    `Lê um arquivo com números de linha (máx. ${MAX_LINHAS_LEITURA} linhas por chamada).`,
    {
      repo: { type: "string", description: "owner/nome do repositório" },
      path: { type: "string", description: "Caminho do arquivo dentro do repositório" },
      linhaInicio: { type: "integer" },
      linhaFim: { type: "integer" },
    },
    ["path"],
  ),
  fn(
    "listar_diretorio",
    "Lista arquivos e pastas de um diretório do repositório.",
    {
      repo: { type: "string", description: "owner/nome do repositório" },
      path: { type: "string", description: "Diretório; vazio ou '.' para a raiz" },
    },
    [],
  ),
  fn(
    "referencias",
    "Mostra quem chama um símbolo e o que ele chama.",
    {
      repo: { type: "string", description: "owner/nome do repositório" },
      simbolo: { type: "string", description: "Nome da função, método ou classe" },
    },
    ["simbolo"],
  ),
];

function fn(name, description, properties, required) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export async function executarFerramenta(nome, args, ctx) {
  try {
    switch (nome) {
      case "buscar_semantico":
        return await buscarSemantico(String(args.consulta ?? ""), Math.min(10, Math.max(1, Number(args.k) || 6)), ctx);
      case "buscar_texto":
        return await buscarTexto(String(args.termo ?? ""), ctx);
      case "ler_arquivo":
        return await lerArquivo(args, ctx);
      case "listar_diretorio":
        return await listarDiretorio(args, ctx);
      case "referencias":
        return await referencias(args, ctx);
      default:
        return { texto: `Ferramenta desconhecida: ${nome}`, fontes: [], descricao: `ferramenta desconhecida ${nome}` };
    }
  } catch (e) {
    return { texto: `Erro: ${e.message}`, fontes: [], descricao: `erro em ${nome}` };
  }
}

function resolverRepo(arg, ctx) {
  if (ctx.repos.length === 1 && !arg) return ctx.repos[0];
  const s = String(arg ?? "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .toLowerCase();
  const r = ctx.repos.find((x) => `${x.ghOwner}/${x.ghNome}`.toLowerCase() === s || x.ghNome.toLowerCase() === s);
  if (!r)
    throw new Error(
      `repositório não disponível para este bot. Disponíveis: ${ctx.repos.map((x) => `${x.ghOwner}/${x.ghNome}`).join(", ")}`,
    );
  return r;
}

const fonteDe = (r, p, a, b) => ({
  repoId: r._id,
  ghOwner: r.ghOwner,
  ghNome: r.ghNome,
  path: p,
  linhaInicio: a,
  linhaFim: b,
  commitSha: r.ultimoCommit ?? "HEAD",
});

async function buscarSemantico(consulta, k, ctx) {
  const { resultados } = await buscar({ repoIds: ctx.repos.map((r) => r._id), consulta, k, grafo: false });
  const fontes = [];
  const linhas = resultados.map((r, i) => {
    const c = r.chunk;
    fontes.push({
      ...fonteDe(
        ctx.repos.find((x) => x._id === c.repoId),
        c.path,
        c.linhaInicio,
        c.linhaFim,
      ),
      commitSha: c.commitSha,
    });
    const previa = c.conteudo
      .split("\n")
      .slice(0, 12)
      .map((l, j) => `${String(c.linhaInicio + j).padStart(4)}| ${l}`)
      .join("\n");
    return `${i + 1}. ${r.repo.ghOwner}/${r.repo.ghNome} ${c.path}:L${c.linhaInicio}-L${c.linhaFim}${c.simbolo ? ` (${c.tipo} ${c.simbolo})` : ""}\n${previa}`;
  });
  return { texto: linhas.join("\n\n") || "Nada encontrado.", fontes, descricao: `buscando "${consulta.slice(0, 60)}"` };
}

async function arquivosIndexados(repoId, filtro = {}) {
  return (await db())
    .collection("arquivos")
    .find({ repoId, status: "indexado", ...filtro })
    .toArray();
}

async function buscarTexto(termo, ctx) {
  if (termo.trim().length < 2) return { texto: "Termo muito curto.", fontes: [], descricao: "busca textual vazia" };
  const alvo = termo.toLowerCase();
  const achados = [];
  const fontes = [];
  for (const r of ctx.repos) {
    for (const a of await arquivosIndexados(r._id)) {
      if (achados.length >= 30) break;
      const texto = await lerSeguro(r, a.path);
      if (!texto) continue;
      texto.split("\n").forEach((l, i) => {
        if (achados.length < 30 && l.toLowerCase().includes(alvo)) {
          achados.push(`${r.ghOwner}/${r.ghNome} ${a.path}:L${i + 1}: ${l.trim().slice(0, 160)}`);
          fontes.push(fonteDe(r, a.path, i + 1, i + 1));
        }
      });
    }
  }
  return {
    texto: achados.join("\n") || `"${termo}" não aparece nos arquivos indexados.`,
    fontes,
    descricao: `procurando "${termo.slice(0, 40)}" no código`,
  };
}

async function lerArquivo(args, ctx) {
  const r = resolverRepo(args.repo, ctx);
  const p = String(args.path ?? "").replace(/^\.?\//, "");
  const [arq] = await arquivosIndexados(r._id, { path: p });
  if (!arq)
    return { texto: `Arquivo ${p} não existe ou não está indexado (pode ter sido ignorado).`, fontes: [], descricao: `tentou ler ${p}` };
  const linhas = (await lerSeguro(r, p))?.split("\n") ?? [];
  const a = Math.max(1, Number(args.linhaInicio) || 1);
  const b = Math.min(linhas.length, Number(args.linhaFim) || a + MAX_LINHAS_LEITURA - 1, a + MAX_LINHAS_LEITURA - 1);
  const corpo = linhas
    .slice(a - 1, b)
    .map((l, i) => `${String(a + i).padStart(4)}| ${l}`)
    .join("\n");
  const sufixo = b < linhas.length ? `\n(arquivo tem ${linhas.length} linhas; peça linhaInicio=${b + 1} para continuar)` : "";
  return { texto: `${p} (L${a}-L${b})\n${corpo}${sufixo}`, fontes: [fonteDe(r, p, a, b)], descricao: `lendo ${p} L${a}-${b}` };
}

async function listarDiretorio(args, ctx) {
  const r = resolverRepo(args.repo, ctx);
  const base = String(args.path ?? "")
    .replace(/^\.?\/?/, "")
    .replace(/\/$/, "");
  const prefixo = base ? base + "/" : "";
  const col = (await db()).collection("arquivos");
  const todos = await col.find({ repoId: r._id }, { projection: { path: 1, status: 1 } }).toArray();
  const entradas = new Map();
  for (const a of todos) {
    if (!a.path.startsWith(prefixo)) continue;
    const resto = a.path.slice(prefixo.length);
    const [primeiro, ...mais] = resto.split("/");
    entradas.set(primeiro + (mais.length ? "/" : ""), mais.length ? "dir" : a.status);
  }
  const lista = [...entradas].sort().map(([n, s]) => (s === "dir" ? n : s === "indexado" ? n : `${n} (ignorado)`));
  return { texto: lista.join("\n") || "Diretório vazio ou inexistente.", fontes: [], descricao: `listando ${base || "raiz"}` };
}

async function referencias(args, ctx) {
  const r = resolverRepo(args.repo, ctx);
  const simbolo = String(args.simbolo ?? "").trim();
  const curto = simbolo.split(".").pop();
  const col = (await db()).collection("chunks");
  const proj = { projection: { path: 1, simbolo: 1, linhaInicio: 1, linhaFim: 1, referencias: 1, commitSha: 1 } };
  const definicao = await col
    .find({ repoId: r._id, simbolo: { $in: [simbolo, curto] } }, proj)
    .limit(5)
    .toArray();
  const chamadores = await col.find({ repoId: r._id, referencias: curto }, proj).limit(10).toArray();
  const fontes = [...definicao, ...chamadores].map((c) => ({ ...fonteDe(r, c.path, c.linhaInicio, c.linhaFim), commitSha: c.commitSha }));
  const fmt = (c) => `${c.path}:L${c.linhaInicio}-L${c.linhaFim}${c.simbolo ? ` (${c.simbolo})` : ""}`;
  const texto = [
    definicao.length ? `Definido em:\n${definicao.map(fmt).join("\n")}` : `Definição de ${simbolo} não encontrada.`,
    definicao[0]?.referencias.length ? `Chama: ${definicao[0].referencias.join(", ")}` : "",
    chamadores.length ? `Chamado por:\n${chamadores.map(fmt).join("\n")}` : "Nenhum chamador encontrado.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { texto, fontes, descricao: `rastreando referências de ${simbolo}` };
}

async function lerSeguro(r, p) {
  const dir = dirRepo(r._id);
  const abs = path.resolve(dir, p);
  if (!abs.startsWith(dir + path.sep)) return null;
  try {
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

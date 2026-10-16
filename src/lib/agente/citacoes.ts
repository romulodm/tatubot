import type { Citacao } from "../tipos";

// Fonte = intervalo de linhas que o bot EFETIVAMENTE viu nesta execução
// (retornado pela busca ou por ler_arquivo). Só esses podem ser citados.
export type Fonte = Citacao;

// Aceita [src/a.ts:L10-L20], [src/a.ts:10-20], [src/a.ts:L10] e a mesma coisa entre crases.
const REGEX = /\[([^\[\]\n`]+?):L?(\d+)(?:\s*[-–]\s*L?(\d+))?\]|`([^`\n\s]+?):L(\d+)(?:\s*[-–]\s*L?(\d+))?`/g;

export interface ResultadoCitacoes {
  texto: string;
  citacoes: Citacao[];
  removidas: string[];
}

export function validarCitacoes(texto: string, fontes: Fonte[]): ResultadoCitacoes {
  const citacoes: Citacao[] = [];
  const chave = (c: Citacao) => `${c.repoId}|${c.path}|${c.linhaInicio}|${c.linhaFim}`;
  const vistas = new Map<string, number>();
  const removidas: string[] = [];

  const novo = texto.replace(REGEX, (bruto, p1, a1, b1, p2, a2, b2) => {
    const caminho = normalizarCaminho(p1 ?? p2);
    const ini = Number(a1 ?? a2);
    const fim = Number(b1 ?? b2 ?? ini);
    const [a, b] = ini <= fim ? [ini, fim] : [fim, ini];

    // Casa o caminho exato ou um sufixo (o modelo às vezes omite "owner/repo/").
    const candidatas = fontes.filter((f) => f.path === caminho || caminho.endsWith("/" + f.path) || `${f.ghOwner}/${f.ghNome}/${f.path}` === caminho);
    // Prefere a fonte que contém o intervalo inteiro; senão, a de maior sobreposição.
    const sobreposicao = (x: Fonte) => Math.min(b, x.linhaFim) - Math.max(a, x.linhaInicio) + 1;
    const f = candidatas.filter((x) => sobreposicao(x) > 0).sort((x, y) => sobreposicao(y) - sobreposicao(x))[0];
    if (!f) {
      removidas.push(bruto);
      return "";
    }
    // Recorta ao que foi realmente visto.
    const c: Citacao = { ...f, linhaInicio: Math.max(a, f.linhaInicio), linhaFim: Math.min(b, f.linhaFim) };
    const k = chave(c);
    if (!vistas.has(k)) {
      vistas.set(k, citacoes.length);
      citacoes.push(c);
    }
    return `[[${vistas.get(k)! + 1}]]`;
  });

  return { texto: limparEspacos(novo), citacoes, removidas };
}

function normalizarCaminho(p: string) {
  return p.trim().replace(/^\.?\//, "").replace(/^`|`$/g, "");
}

function limparEspacos(t: string) {
  return t.replace(/[ \t]+([.,;:])/g, "$1").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function linkGithub(c: Citacao) {
  return `https://github.com/${c.ghOwner}/${c.ghNome}/blob/${c.commitSha}/${c.path}#L${c.linhaInicio}-L${c.linhaFim}`;
}

// Validação de citações: a última barreira contra a alucinação.
//
// O modelo é instruído a citar no formato [caminho:L10-L20]. Mas instrução
// não é garantia: ele pode inventar um arquivo, ou citar linhas que nunca
// viu. Então, depois que a resposta fica pronta, conferimos cada citação
// contra as FONTES desta execução: os intervalos de linhas que a busca ou a
// ferramenta ler_arquivo realmente devolveram.
//
//   - citação dentro de uma fonte: vira [[n]] e entra na lista de citações;
//   - citação fora de qualquer fonte: é removida do texto (e registrada).
//
// Mais em docs/rag/06-resposta-e-citacoes.md.

/**
 * Intervalo de linhas que o bot EFETIVAMENTE viu nesta execução.
 * @typedef {import("../tipos.js").Citacao} Fonte
 */

// Aceita [src/a.ts:L10-L20], [src/a.ts:10-20], [src/a.ts:L10] e a mesma coisa entre crases.
// O caminho pode ter colchetes de rota dinâmica: [app/[locale]/page.tsx:L1-L9].
const REGEX = /\[((?:[^\[\]\n`]|\[[^\[\]\n`]*\])+?):L?(\d+)(?:\s*[-–]\s*L?(\d+))?\]|`([^`\n\s]+?):L(\d+)(?:\s*[-–]\s*L?(\d+))?`/g;

/**
 * @param {string} texto resposta do modelo
 * @param {Fonte[]} fontes
 * @returns {{ texto: string, citacoes: Fonte[], removidas: string[] }}
 */
export function validarCitacoes(texto, fontes) {
  /** @type {Fonte[]} */
  const citacoes = [];
  const chave = (/** @type {Fonte} */ c) => `${c.repoId}|${c.path}|${c.linhaInicio}|${c.linhaFim}`;
  /** @type {Map<string, number>} */
  const vistas = new Map();
  /** @type {string[]} */
  const removidas = [];

  const novo = texto.replace(REGEX, (bruto, p1, a1, b1, p2, a2, b2) => {
    const caminho = normalizarCaminho(p1 ?? p2);
    const ini = Number(a1 ?? a2);
    const fim = Number(b1 ?? b2 ?? ini);
    const [a, b] = ini <= fim ? [ini, fim] : [fim, ini];

    // Casa o caminho exato ou um sufixo (o modelo às vezes omite ou acrescenta "owner/repo/").
    const candidatas = fontes.filter((f) => f.path === caminho || caminho.endsWith("/" + f.path) || `${f.ghOwner}/${f.ghNome}/${f.path}` === caminho);
    // Prefere a fonte que contém o intervalo inteiro; senão, a de maior sobreposição.
    const sobreposicao = (/** @type {Fonte} */ x) => Math.min(b, x.linhaFim) - Math.max(a, x.linhaInicio) + 1;
    const f = candidatas.filter((x) => sobreposicao(x) > 0).sort((x, y) => sobreposicao(y) - sobreposicao(x))[0];
    if (!f) {
      removidas.push(bruto);
      return "";
    }
    // Recorta ao que foi realmente visto: citar L5-L15 tendo lido L10-L40 vira L10-L15.
    const c = { ...f, linhaInicio: Math.max(a, f.linhaInicio), linhaFim: Math.min(b, f.linhaFim) };
    const k = chave(c);
    if (!vistas.has(k)) {
      vistas.set(k, citacoes.length);
      citacoes.push(c);
    }
    return `[[${/** @type {number} */ (vistas.get(k)) + 1}]]`;
  });

  return { texto: limparEspacos(novo), citacoes, removidas };
}

/** @param {string} p */
function normalizarCaminho(p) {
  return p
    .trim()
    .replace(/^\.?\//, "")
    .replace(/^`|`$/g, "");
}

// Tirar uma citação deixa sobras como "texto ." ou "()"; limpamos.
/** @param {string} t */
function limparEspacos(t) {
  return t
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Link para o GitHub fixado no commit que foi lido (não na branch), então
 * continua apontando para as linhas certas mesmo depois de novos pushes.
 * @param {Fonte} c
 */
export function linkGithub(c) {
  return `https://github.com/${c.ghOwner}/${c.ghNome}/blob/${c.commitSha}/${c.path}#L${c.linhaInicio}-L${c.linhaFim}`;
}

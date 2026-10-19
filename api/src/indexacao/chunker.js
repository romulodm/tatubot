import ts from "typescript";

// Chunking: quebrar cada arquivo em pedaços que façam sentido sozinhos.
//
// O pedaço é a unidade de busca e de citação. Se cortarmos uma função no
// meio, a busca acha metade da resposta e o bot cita linhas soltas. Por isso
// o corte segue a ESTRUTURA do arquivo (ver docs/rag/03-chunking.md):
//   - JS/TS: pela AST. Uma função, uma classe (resumo), cada método.
//     O que sobra no nível do módulo (imports, constantes) vira "modulo".
//   - Markdown: uma seção por heading.
//   - Resto: blocos de 60 linhas com sobreposição.

/**
 * Chunk antes de ganhar embedding e ir para o banco.
 * @typedef {object} ChunkBruto
 * @property {string} path
 * @property {string | null} simbolo
 * @property {import("../tipos.js").TipoChunk} tipo
 * @property {number} linhaInicio 1-based, inclusivo
 * @property {number} linhaFim
 * @property {string} cabecalho contexto que vai junto no embedding ("arquivo: x > classe Y")
 * @property {string} conteudo
 * @property {string[]} referencias nomes chamados dentro do trecho
 */

const MAX_LINHAS = 120; // acima disso a função é fatiada em partes
const OVERLAP = 15; // linhas repetidas entre partes, para não perder o contexto da emenda
const MIN_LINHAS = 5; // funções menores que isso são agrupadas com as vizinhas
const BLOCO_TEXTO = 60; // tamanho do bloco para arquivos sem estrutura conhecida

/**
 * @param {string} path
 * @param {string} texto
 * @returns {ChunkBruto[]}
 */
export function quebrarEmChunks(path, texto) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    try {
      return chunkerCodigo(path, texto, ext);
    } catch {
      return chunkerLinhas(path, texto); // parse falhou: melhor esforço
    }
  }
  if (ext === ".md" || ext === ".mdx") return chunkerMarkdown(path, texto);
  return chunkerLinhas(path, texto);
}

// ---------- JS/TS: guiado pela AST (compilador do TypeScript só como parser) ----------

// Usamos o compilador do TypeScript só como PARSER: ele entende JS, JSX, TS e
// TSX, e devolve a árvore com as posições exatas de cada nó. Não compilamos nada.

/** @param {string} path @param {string} texto @param {string} ext @returns {ChunkBruto[]} */
function chunkerCodigo(path, texto, ext) {
  const kind =
    ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : ext.includes("t") && !ext.includes("js") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, texto, ts.ScriptTarget.Latest, true, kind);
  const linhas = texto.split("\n");
  const linhaDe = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const inicio = (n) => linhaDe(n.getStart(sf, true)); // inclui JSDoc
  const fim = (n) => linhaDe(n.getEnd());

  /** @type {ChunkBruto[]} */
  const chunks = [];
  const cobertas = new Set(); // linhas que já pertencem a algum chunk
  const marcar = (a, b) => {
    for (let i = a; i <= b; i++) cobertas.add(i);
  };
  const add = (tipo, simbolo, contexto, a, b, no) => {
    const cab = [`arquivo: ${path}`, ...contexto].join(" > ");
    for (const parte of fatiar(a, b)) {
      chunks.push({
        path,
        simbolo: parte.n > 1 ? `${simbolo} (parte ${parte.i})` : simbolo,
        tipo,
        linhaInicio: parte.a,
        linhaFim: parte.b,
        cabecalho: cab,
        conteudo: linhas.slice(parte.a - 1, parte.b).join("\n"),
        referencias: chamadas(no),
      });
    }
    marcar(a, b);
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st)) {
      const nome = st.name?.text ?? "default";
      add("funcao", nome, [`função ${nome}`], inicio(st), fim(st), st);
    } else if (ts.isClassDeclaration(st)) {
      const nomeClasse = st.name?.text ?? "default";
      const metodos = st.members.filter(
        (m) =>
          ts.isMethodDeclaration(m) ||
          ts.isConstructorDeclaration(m) ||
          ts.isGetAccessor(m) ||
          ts.isSetAccessor(m) ||
          (ts.isPropertyDeclaration(m) && m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))),
      );
      // Resumo da classe: do cabeçalho até antes do primeiro método (campos, heranças).
      const a = inicio(st);
      const primeiro = metodos[0] ? inicio(metodos[0]) - 1 : fim(st);
      const b = Math.max(a, Math.min(primeiro, a + MAX_LINHAS - 1));
      chunks.push({
        path,
        simbolo: nomeClasse,
        tipo: "classe",
        linhaInicio: a,
        linhaFim: b,
        cabecalho: `arquivo: ${path} > classe ${nomeClasse}`,
        conteudo: linhas.slice(a - 1, b).join("\n") + (metodos.length ? `\n  // métodos: ${metodos.map(nomeMembro).join(", ")}` : ""),
        referencias: st.heritageClauses?.flatMap((h) => h.types.map((t) => t.expression.getText(sf))) ?? [],
      });
      marcar(a, fim(st)); // a classe inteira sai do chunk de módulo
      for (const m of metodos) {
        const nm = nomeMembro(m);
        add("metodo", `${nomeClasse}.${nm}`, [`classe ${nomeClasse}`, `método ${nm}`], inicio(m), fim(m), m);
      }
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const ini = d.initializer;
        if (ini && ts.isIdentifier(d.name) && (ts.isArrowFunction(ini) || ts.isFunctionExpression(ini) || envolveFuncao(ini))) {
          const nome = d.name.text;
          const a = st.declarationList.declarations.length === 1 ? inicio(st) : inicio(d);
          add("funcao", nome, [`função ${nome}`], a, fim(d), d);
        }
      }
    } else if (ts.isExportAssignment(st) && (ts.isArrowFunction(st.expression) || ts.isFunctionExpression(st.expression))) {
      add("funcao", "default", ["função default"], inicio(st), fim(st), st);
    } else if (ts.isExpressionStatement(st) && fim(st) - inicio(st) + 1 >= MIN_LINHAS && temCallbackFuncao(st.expression)) {
      // app.get('/rota', async (req, res) => {...}) — handlers inline merecem chunk próprio
      const nome = rotuloChamada(st.expression, sf);
      add("funcao", nome, [nome], inicio(st), fim(st), st);
    }
  }

  // O que sobrou no nível do módulo (imports, constantes, config) vira chunk "modulo".
  const resto = [];
  for (let i = 1; i <= linhas.length; i++) if (!cobertas.has(i) && linhas[i - 1].trim()) resto.push(i);
  for (const [a, b] of agruparFaixas(resto, 3)) {
    for (const parte of fatiar(a, b, BLOCO_TEXTO, 10)) {
      const conteudo = linhas.slice(parte.a - 1, parte.b).join("\n");
      chunks.push({
        path,
        simbolo: null,
        tipo: "modulo",
        linhaInicio: parte.a,
        linhaFim: parte.b,
        cabecalho: `arquivo: ${path} > módulo`,
        conteudo,
        referencias: [...conteudo.matchAll(/from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]),
      });
    }
  }

  return agruparPequenos(
    chunks.sort((x, y) => x.linhaInicio - y.linhaInicio),
    linhas,
  );
}

function nomeMembro(m) {
  if (ts.isConstructorDeclaration(m)) return "constructor";
  const n = m.name;
  if (!n) return "anonimo";
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return n.getText();
}

function envolveFuncao(n) {
  // const handler = withAuth(async (req) => {...}) / memo(() => ...)
  return ts.isCallExpression(n) && n.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
}

function temCallbackFuncao(n) {
  return (
    ts.isCallExpression(n) &&
    (envolveFuncao(n) ||
      (ts.isPropertyAccessExpression(n.expression) && ts.isCallExpression(n.expression.expression) && temCallbackFuncao(n.expression.expression)))
  );
}

function rotuloChamada(n, sf) {
  if (!ts.isCallExpression(n)) return "chamada";
  const alvo = n.expression.getText(sf).replace(/\s+/g, "").slice(0, 60);
  const primeiro = n.arguments[0];
  const arg = primeiro && ts.isStringLiteralLike(primeiro) ? `('${primeiro.text.slice(0, 60)}')` : "()";
  return `${alvo}${arg}`;
}

// Nomes chamados dentro do nó: verificarToken(), this.log(), new JwtService().
// É o que alimenta a expansão por grafo na busca e a ferramenta "referencias".
/** @param {ts.Node} no */
function chamadas(no) {
  const nomes = new Set();
  const visitar = (n) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) nomes.add(e.text);
      else if (ts.isPropertyAccessExpression(e)) nomes.add(e.name.text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(no);
  return [...nomes].slice(0, 40);
}

// ---------- Markdown: uma seção por heading (#, ##, ###) ----------

// A pilha guarda os títulos acima da seção atual, então o cabeçalho fica
// "README.md > Instalação > Docker": o contexto que um parágrafo solto perderia.
/** @param {string} path @param {string} texto @returns {ChunkBruto[]} */
function chunkerMarkdown(path, texto) {
  const linhas = texto.split("\n");
  const secoes = [];
  const pilha = [];
  let emCodigo = false;
  linhas.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) emCodigo = !emCodigo;
    const m = !emCodigo && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) {
      const nivel = m[1].length;
      pilha.length = nivel - 1;
      pilha[nivel - 1] = m[2];
      secoes.push({ a: i + 1, titulo: pilha.filter(Boolean) });
    }
  });
  if (!secoes.length || secoes[0].a > 1) secoes.unshift({ a: 1, titulo: [] });

  const r = [];
  secoes.forEach((s, i) => {
    const b = (secoes[i + 1]?.a ?? linhas.length + 1) - 1;
    const corpo = linhas.slice(s.a - 1, b).join("");
    if (!corpo.trim()) return;
    const titulo = s.titulo.join(" > ") || "início";
    for (const parte of fatiar(s.a, b)) {
      r.push({
        path,
        simbolo: s.titulo.at(-1) ?? null,
        tipo: "secao_doc",
        linhaInicio: parte.a,
        linhaFim: parte.b,
        cabecalho: `arquivo: ${path} > ${titulo}`,
        conteudo: linhas.slice(parte.a - 1, parte.b).join("\n"),
        referencias: [],
      });
    }
  });
  return r;
}

// ---------- Outras linguagens: blocos de 60 linhas com overlap ----------

/** @param {string} path @param {string} texto @returns {ChunkBruto[]} */
function chunkerLinhas(path, texto) {
  const linhas = texto.split("\n");
  if (!texto.trim()) return [];
  return fatiar(1, linhas.length, BLOCO_TEXTO, 10)
    .map((p) => ({
      path,
      simbolo: null,
      tipo: "modulo",
      linhaInicio: p.a,
      linhaFim: p.b,
      cabecalho: `arquivo: ${path}`,
      conteudo: linhas.slice(p.a - 1, p.b).join("\n"),
      referencias: [],
    }))
    .filter((c) => c.conteudo.trim());
}

// ---------- utilidades ----------

/**
 * Divide o intervalo [a, b] em partes de até `max` linhas, com `overlap`
 * linhas repetidas entre uma parte e a próxima.
 *   fatiar(1, 300) -> [1-120], [106-225], [211-300]
 * @param {number} a @param {number} b @param {number} [max] @param {number} [overlap]
 */
export function fatiar(a, b, max = MAX_LINHAS, overlap = OVERLAP) {
  const total = b - a + 1;
  if (total <= max) return [{ a, b, i: 1, n: 1 }];
  const partes = [];
  for (let s = a, i = 1; s <= b; s += max - overlap, i++) {
    partes.push({ a: s, b: Math.min(b, s + max - 1), i, n: 0 });
    if (s + max - 1 >= b) break;
  }
  return partes.map((p) => ({ ...p, n: partes.length }));
}

// [1,2,3,8,9] com folga 3 -> [[1,3],[8,9]]
/** @param {number[]} nums @param {number} folga @returns {[number, number][]} */
function agruparFaixas(nums, folga) {
  const r = [];
  for (const n of nums) {
    const ult = r.at(-1);
    if (ult && n - ult[1] <= folga) ult[1] = n;
    else r.push([n, n]);
  }
  return r;
}

// Funções/métodos com menos de 5 linhas viram ruído isoladas;
// juntamos vizinhos pequenos e contíguos do mesmo arquivo.
/** @param {ChunkBruto[]} chunks @param {string[]} linhas */
function agruparPequenos(chunks, linhas) {
  const r = [];
  for (const c of chunks) {
    const ult = r.at(-1);
    const pequeno = (x) => (x.tipo === "funcao" || x.tipo === "metodo") && x.linhaFim - x.linhaInicio + 1 < MIN_LINHAS;
    if (
      ult &&
      pequeno(c) &&
      (pequeno(ult) || ult.simbolo?.includes(",")) &&
      c.linhaInicio - ult.linhaFim <= 3 &&
      c.linhaFim - ult.linhaInicio < 40 &&
      c.tipo === ult.tipo
    ) {
      r[r.length - 1] = {
        ...ult,
        simbolo: `${ult.simbolo}, ${c.simbolo}`,
        linhaFim: c.linhaFim,
        conteudo: linhas.slice(ult.linhaInicio - 1, c.linhaFim).join("\n"),
        referencias: [...new Set([...ult.referencias, ...c.referencias])],
      };
    } else r.push(c);
  }
  return r;
}

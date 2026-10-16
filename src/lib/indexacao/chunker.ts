import ts from "typescript";
import type { TipoChunk } from "../tipos";

export interface ChunkBruto {
  path: string;
  simbolo: string | null;
  tipo: TipoChunk;
  linhaInicio: number; // 1-based, inclusivo
  linhaFim: number;
  cabecalho: string;
  conteudo: string;
  referencias: string[];
}

const MAX_LINHAS = 120;
const OVERLAP = 15;
const MIN_LINHAS = 5;
const BLOCO_TEXTO = 60;

export function quebrarEmChunks(path: string, texto: string): ChunkBruto[] {
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

function chunkerCodigo(path: string, texto: string, ext: string): ChunkBruto[] {
  const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ext === ".jsx" ? ts.ScriptKind.JSX : ext.includes("t") && !ext.includes("js") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, texto, ts.ScriptTarget.Latest, true, kind);
  const linhas = texto.split("\n");
  const linhaDe = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const inicio = (n: ts.Node) => linhaDe(n.getStart(sf, true)); // inclui JSDoc
  const fim = (n: ts.Node) => linhaDe(n.getEnd());

  const chunks: ChunkBruto[] = [];
  const cobertas = new Set<number>();
  const marcar = (a: number, b: number) => {
    for (let i = a; i <= b; i++) cobertas.add(i);
  };
  const add = (tipo: TipoChunk, simbolo: string, contexto: string[], a: number, b: number, no: ts.Node) => {
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
        (m) => ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m) ||
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
  const resto: number[] = [];
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

  return agruparPequenos(chunks.sort((x, y) => x.linhaInicio - y.linhaInicio), linhas);
}

function nomeMembro(m: ts.ClassElement): string {
  if (ts.isConstructorDeclaration(m)) return "constructor";
  const n = m.name;
  if (!n) return "anonimo";
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return n.getText();
}

function envolveFuncao(n: ts.Expression): boolean {
  // const handler = withAuth(async (req) => {...}) / memo(() => ...)
  return ts.isCallExpression(n) && n.arguments.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
}

function temCallbackFuncao(n: ts.Expression): boolean {
  return ts.isCallExpression(n) && (envolveFuncao(n) || (ts.isPropertyAccessExpression(n.expression) && ts.isCallExpression(n.expression.expression) && temCallbackFuncao(n.expression.expression)));
}

function rotuloChamada(n: ts.Expression, sf: ts.SourceFile): string {
  if (!ts.isCallExpression(n)) return "chamada";
  const alvo = n.expression.getText(sf).replace(/\s+/g, "").slice(0, 60);
  const primeiro = n.arguments[0];
  const arg = primeiro && ts.isStringLiteralLike(primeiro) ? `('${primeiro.text.slice(0, 60)}')` : "()";
  return `${alvo}${arg}`;
}

function chamadas(no: ts.Node): string[] {
  const nomes = new Set<string>();
  const visitar = (n: ts.Node) => {
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

function chunkerMarkdown(path: string, texto: string): ChunkBruto[] {
  const linhas = texto.split("\n");
  const secoes: { a: number; titulo: string[] }[] = [];
  const pilha: string[] = [];
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

  const r: ChunkBruto[] = [];
  secoes.forEach((s, i) => {
    const b = (secoes[i + 1]?.a ?? linhas.length + 1) - 1;
    if (!linhas.slice(s.a - 1, b).join("").trim()) return;
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

function chunkerLinhas(path: string, texto: string): ChunkBruto[] {
  const linhas = texto.split("\n");
  if (!texto.trim()) return [];
  return fatiar(1, linhas.length, BLOCO_TEXTO, 10)
    .map((p) => ({
      path,
      simbolo: null,
      tipo: "modulo" as const,
      linhaInicio: p.a,
      linhaFim: p.b,
      cabecalho: `arquivo: ${path}`,
      conteudo: linhas.slice(p.a - 1, p.b).join("\n"),
      referencias: [],
    }))
    .filter((c) => c.conteudo.trim());
}

// ---------- utilidades ----------

export function fatiar(a: number, b: number, max = MAX_LINHAS, overlap = OVERLAP) {
  const total = b - a + 1;
  if (total <= max) return [{ a, b, i: 1, n: 1 }];
  const partes: { a: number; b: number; i: number; n: number }[] = [];
  for (let s = a, i = 1; s <= b; s += max - overlap, i++) {
    partes.push({ a: s, b: Math.min(b, s + max - 1), i, n: 0 });
    if (s + max - 1 >= b) break;
  }
  return partes.map((p) => ({ ...p, n: partes.length }));
}

function agruparFaixas(nums: number[], folga: number): [number, number][] {
  const r: [number, number][] = [];
  for (const n of nums) {
    const ult = r.at(-1);
    if (ult && n - ult[1] <= folga) ult[1] = n;
    else r.push([n, n]);
  }
  return r;
}

// Funções/métodos com menos de 5 linhas viram ruído isoladas;
// juntamos vizinhos pequenos e contíguos do mesmo arquivo.
function agruparPequenos(chunks: ChunkBruto[], linhas: string[]): ChunkBruto[] {
  const r: ChunkBruto[] = [];
  for (const c of chunks) {
    const ult = r.at(-1);
    const pequeno = (x: ChunkBruto) => (x.tipo === "funcao" || x.tipo === "metodo") && x.linhaFim - x.linhaInicio + 1 < MIN_LINHAS;
    if (ult && pequeno(c) && (pequeno(ult) || ult.simbolo?.includes(",")) && c.linhaInicio - ult.linhaFim <= 3 && c.linhaFim - ult.linhaInicio < 40 && c.tipo === ult.tipo) {
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

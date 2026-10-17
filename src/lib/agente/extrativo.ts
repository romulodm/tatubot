import type { SaidaBusca, Resultado } from "../busca/buscar";
import type { Consulta } from "../busca/consulta";

// Resposta sem LLM: agrupa por arquivo e diz só o que dá para afirmar com certeza
// (onde está e quais símbolos existem ali), sempre com citação.

const TIPOS: Record<string, string> = { funcao: "função", classe: "classe", metodo: "método", modulo: "trecho", secao_doc: "seção" };

export function respostaExtrativa(saida: SaidaBusca, primeiraResposta: boolean): string {
  const { resultados, consulta, faltando } = saida;
  const frase = fraseDoAssunto(consulta);

  if (!resultados.length) {
    const termos = [...new Set(consulta.conceitos.flatMap((c) => c.termos))].slice(0, 10);
    return [
      `Não encontrei nada sobre **${frase}** nos repositórios deste bot.`,
      termos.length ? `Procurei por: ${termos.map((t) => `\`${t}\``).join(", ")}.` : "",
      "Tente usar o nome de um componente, função, rota ou pasta.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const arquivos = agruparPorArquivo(resultados.filter((r) => !r.viaGrafo));
  const linhas: string[] = [];
  const localizar = consulta.intencao === "localizar";
  // Ao localizar, separa os arquivos que SÃO do assunto (caminho/símbolo) dos que só o usam.
  const nucleo = localizar ? arquivos.filter((a) => a.trechos.some((t) => t.definicao)) : arquivos;
  const usos = localizar && nucleo.length ? arquivos.filter((a) => !nucleo.includes(a)) : [];
  const principais = nucleo.length ? nucleo : arquivos;

  if (faltando.length) {
    linhas.push(`Não encontrei nada que fale de ${faltando.map((f) => `**${f}**`).join(" e ")} junto com o resto. O mais próximo:`, "");
  } else if (localizar) {
    linhas.push(principais.length === 1 ? `**${capital(frase)}** está em um arquivo:` : `**${capital(frase)}** está nestes ${principais.length} arquivos:`, "");
  } else {
    linhas.push(`O que encontrei sobre **${frase}**:`, "");
  }

  for (const a of principais.slice(0, localizar ? 8 : 5)) {
    const trechoCodigo = a.trechos.find(t_codigo) ?? a.trechos[0];
    const melhor = trechoCodigo.chunk;
    const simbolos = [...new Set(a.trechos.filter(t_codigo).map((t) => t.chunk.simbolo).filter((x): x is string => !!x).map(limpar))].slice(0, 4);
    const cit = `[${melhor.path}:L${melhor.linhaInicio}-L${melhor.linhaFim}]`;
    const doc = descricao(a.trechos);
    if (localizar) {
      linhas.push(`- \`${melhor.path}\`${simbolos.length ? `, com ${simbolos.map((x) => `\`${x}\``).join(", ")}` : ""} ${cit}${doc ? `: ${doc}` : ""}`);
    } else {
      const quem = simbolos.length && t_codigo(trechoCodigo) ? `${TIPOS[melhor.tipo] ?? "trecho"} \`${limpar(melhor.simbolo ?? simbolos[0])}\` em \`${melhor.path}\`` : `\`${melhor.path}\``;
      linhas.push(`- ${capital(quem)} ${cit}${doc ? `: ${doc}` : ""}`);
    }
  }

  if (usos.length) {
    const lista = usos.slice(0, 5).map((a) => {
      const c = (a.trechos.find(t_codigo) ?? a.trechos[0]).chunk;
      return `\`${nomeCurto(c.path)}\` [${c.path}:L${c.linhaInicio}-L${c.linhaFim}]`;
    });
    linhas.push("", `Também é usado em ${lista.join(", ")}.`);
  }

  if (primeiraResposta) {
    linhas.push("", "Sem um modelo de linguagem configurado eu localizo o código, mas não explico o que ele faz. Com `LLM_PROVIDER=openai_compat` as respostas vêm explicadas.");
  }
  return linhas.join("\n");
}

function t_codigo(r: Resultado) {
  return r.chunk.tipo !== "secao_doc" && r.chunk.tipo !== "modulo";
}

function agruparPorArquivo(rs: Resultado[]) {
  const mapa = new Map<string, { path: string; trechos: Resultado[] }>();
  for (const r of rs) {
    const k = `${r.repo._id}|${r.chunk.path}`;
    if (!mapa.has(k)) mapa.set(k, { path: r.chunk.path, trechos: [] });
    mapa.get(k)!.trechos.push(r);
  }
  return [...mapa.values()];
}

// Comentário de documentação no início do trecho de código, se houver.
function descricao(trechos: Resultado[]): string {
  for (const t of trechos) {
    if (!t_codigo(t)) continue;
    const inicio = t.chunk.conteudo.split("\n").slice(0, 3).join("\n");
    const m = inicio.match(/^\s*(?:\/\*\*?|\*|\/\/\/?)\s*([A-ZÀ-Ú][^\n*]{15,140})/m);
    if (m && !/^métodos:/i.test(m[1])) return m[1].trim().replace(/[`*]/g, "").replace(/\.?$/, ".");
  }
  return "";
}

// "Onde ficam os arquivos do modal de autenticação?" -> "modal de autenticação"
const CONECTORES = new Set(["de", "da", "do", "das", "dos", "e", "para", "com", "em", "no", "na", "nos", "nas", "a", "o", "os", "as"]);

export function fraseDoAssunto(c: Consulta): string {
  if (!c.conceitos.length) return c.original.trim();
  const palavras = c.original.replace(/[?!.,;:]+/g, " ").split(/\s+/).filter(Boolean);
  const ehConceito = (w: string) => c.conceitos.some((k) => k.palavra === w);
  const ini = palavras.findIndex(ehConceito);
  const fim = palavras.length - 1 - [...palavras].reverse().findIndex(ehConceito);
  // Mantém os conceitos e os conectores entre eles: "rotas da api para comentários".
  const trecho = palavras.slice(ini, fim + 1).filter((w) => ehConceito(w) || CONECTORES.has(w.toLowerCase()));
  return trecho.join(" ").replace(/[`*]/g, "").slice(0, 80);
}

// "app/[locale]/admin/contact/page.tsx" -> "admin/contact/page.tsx": nomes genéricos precisam da pasta.
const GENERICOS = /^(page|route|layout|index|loading|error|actions|types|utils|constants)\.\w+$/;
function nomeCurto(path: string) {
  const partes = path.split("/").filter((p) => !/^\[.*\]$/.test(p));
  return GENERICOS.test(partes.at(-1) ?? "") ? partes.slice(-3).join("/") : (partes.at(-1) ?? path);
}

const limpar = (s: string) => s.replace(/ \(parte \d+\)$/, "").replace(/[`*]/g, "").slice(0, 60);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

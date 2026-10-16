"use client";

import type { ReactNode } from "react";

export interface CitacaoUI {
  ghOwner: string;
  ghNome: string;
  path: string;
  linhaInicio: number;
  linhaFim: number;
  commitSha: string;
}

export function linkCitacao(c: CitacaoUI) {
  return `https://github.com/${c.ghOwner}/${c.ghNome}/blob/${c.commitSha}/${c.path}#L${c.linhaInicio}-L${c.linhaFim}`;
}

// Markdown mínimo, montado como elementos React (nada de innerHTML com
// texto do modelo): blocos de código, títulos, listas, parágrafos,
// `código`, **negrito** e as citações [[n]] viram chips com link.
export function Markdown({ texto, citacoes = [], aoFocarCitacao }: { texto: string; citacoes?: CitacaoUI[]; aoFocarCitacao?: (i: number) => void }) {
  const blocos: ReactNode[] = [];
  const partes = texto.split(/```([\w-]*)\n?([\s\S]*?)(?:```|$)/g);
  for (let i = 0; i < partes.length; i += 3) {
    blocos.push(...blocosDeTexto(partes[i], `t${i}`, citacoes, aoFocarCitacao));
    if (partes[i + 2] !== undefined) {
      blocos.push(
        <pre key={`c${i}`} className="md-codigo">
          <code>{partes[i + 2].replace(/\n$/, "")}</code>
        </pre>,
      );
    }
  }
  return <div className="md">{blocos}</div>;
}

function blocosDeTexto(t: string, chave: string, cit: CitacaoUI[], foco?: (i: number) => void): ReactNode[] {
  const r: ReactNode[] = [];
  const linhas = t.split("\n");
  let lista: { ordenada: boolean; itens: string[] } | null = null;
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length) r.push(<p key={`${chave}p${r.length}`}>{inline(paragrafo.join(" "), cit, foco)}</p>);
    paragrafo = [];
  };
  const fecharLista = () => {
    if (!lista) return;
    const itens = lista.itens.map((it, i) => <li key={i}>{inline(it, cit, foco)}</li>);
    r.push(lista.ordenada ? <ol key={`${chave}l${r.length}`}>{itens}</ol> : <ul key={`${chave}l${r.length}`}>{itens}</ul>);
    lista = null;
  };
  for (const l of linhas) {
    const titulo = /^(#{1,4})\s+(.*)$/.exec(l);
    const item = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (titulo) {
      fecharParagrafo();
      fecharLista();
      r.push(<h4 key={`${chave}h${r.length}`}>{inline(titulo[2], cit, foco)}</h4>);
    } else if (item) {
      fecharParagrafo();
      const ordenada = /\d/.test(item[1]);
      if (lista && lista.ordenada !== ordenada) fecharLista();
      lista ??= { ordenada, itens: [] };
      lista.itens.push(item[2]);
    } else if (!l.trim()) {
      fecharParagrafo();
      fecharLista();
    } else if (lista && /^\s{2,}/.test(l)) {
      lista.itens[lista.itens.length - 1] += " " + l.trim();
    } else {
      fecharLista();
      paragrafo.push(l.trim());
    }
  }
  fecharParagrafo();
  fecharLista();
  return r;
}

function inline(t: string, cit: CitacaoUI[], foco?: (i: number) => void): ReactNode[] {
  const r: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[\[\d+\]\])/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > ultimo) r.push(t.slice(ultimo, m.index));
    const s = m[0];
    if (s.startsWith("`")) r.push(<code key={m.index}>{s.slice(1, -1)}</code>);
    else if (s.startsWith("**")) r.push(<strong key={m.index}>{s.slice(2, -2)}</strong>);
    else {
      const n = Number(s.slice(2, -2));
      const c = cit[n - 1];
      r.push(
        c ? (
          <a
            key={m.index}
            className="chip-citacao"
            href={linkCitacao(c)}
            target="_blank"
            rel="noreferrer"
            title={`${c.path}:L${c.linhaInicio}-L${c.linhaFim}`}
            onMouseEnter={() => foco?.(n - 1)}
            onFocus={() => foco?.(n - 1)}
          >
            {n}
          </a>
        ) : null,
      );
    }
    ultimo = m.index + s.length;
  }
  if (ultimo < t.length) r.push(t.slice(ultimo));
  return r;
}

"use client";

import { useState } from "react";
import { TRABALHOS } from "@/lib/trabalhos";
import { Avatar } from "@/components/Avatar";
import s from "./landing.module.css";

// Abas com os modelos de bot. Os mesmos modelos aparecem no formulário de
// criação ("Começar de um modelo"), então o que a landing promete é o que existe.
export function Trabalhos() {
  const [atual, setAtual] = useState(0);
  const t = TRABALHOS[atual];
  return (
    <div className={s.trabalhos}>
      <div className={s.trabalhosLista} role="tablist" aria-label="Modelos de bot">
        {TRABALHOS.map((x, i) => (
          <button key={x.id} role="tab" aria-selected={i === atual} className={s.trabalhoAba} onClick={() => setAtual(i)}>
            <Avatar seed={x.id} tamanho={28} forma="rounded" />
            <span>{x.nome}</span>
          </button>
        ))}
      </div>
      <div className={s.trabalhoPainel} role="tabpanel">
        <div className={s.trabalhoTopo}>
          <Avatar seed={t.id} tamanho={56} forma="rounded" />
          <div>
            <h3>{t.nome}</h3>
            <span className={s.trabalhoModo}>{t.modo === "agente" ? "modo agente" : "modo busca direta"}</span>
          </div>
        </div>
        <p className={s.trabalhoResumo}>{t.resumo}</p>
        <div className={s.trabalhoPergunta}>
          <span>Pergunte, por exemplo</span>
          <p>{t.pergunta}</p>
        </div>
        <p className={s.trabalhoDica}>
          {t.modo === "agente" ? "Abre arquivos e segue referências até ter certeza." : "Responde com os trechos mais relevantes, numa chamada só."}
        </p>
      </div>
    </div>
  );
}

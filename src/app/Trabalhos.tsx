"use client";

import { useState } from "react";
import { TRABALHOS } from "@/lib/trabalhos";
import { Avatar } from "@/components/Avatar";
import s from "./landing.module.css";

export function Trabalhos() {
  const [atual, setAtual] = useState(0);
  const t = TRABALHOS[atual];
  return (
    <div className={s.trabalhos}>
      <div className={s.trabalhosLista} role="tablist" aria-label="Modelos de bot">
        {TRABALHOS.map((x, i) => (
          <button key={x.id} role="tab" aria-selected={i === atual} className={s.trabalhoAba} onClick={() => setAtual(i)}>
            {x.nome}
          </button>
        ))}
      </div>
      <div className={s.trabalhoPainel} role="tabpanel">
        <Avatar seed={t.id} tamanho={56} />
        <p className={s.trabalhoResumo}>{t.resumo}</p>
        <p className={s.trabalhoPergunta}>
          <span>Pergunte, por exemplo</span>
          {t.pergunta}
        </p>
        <span className="selo">{t.modo === "agente" ? "Modo agente: abre arquivos e segue referências" : "Modo busca: responde com os trechos mais relevantes"}</span>
      </div>
    </div>
  );
}

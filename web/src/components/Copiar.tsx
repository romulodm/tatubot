"use client";

import { useState } from "react";

// Botãozinho de copiar para os comandos da landing ("$ docker compose up").
export function Copiar({ texto, className }: { texto: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // sem permissão de clipboard (http sem TLS, iframe): o texto continua visível para copiar à mão
    }
  }

  return (
    <button type="button" className={className} onClick={copiar} aria-label={copiado ? "Copiado" : `Copiar: ${texto}`} title="Copiar">
      {copiado ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

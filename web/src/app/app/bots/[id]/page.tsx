"use client";

import { use } from "react";
import { useEspaco } from "../../Espaco";
import { FormBot } from "../FormBot";
import s from "../../app.module.css";

export default function EditarBot({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bots, carregado } = useEspaco();
  const bot = bots.find((b) => b.id === id);
  if (!carregado) return <div className={s.pagina} />;
  if (!bot)
    return (
      <div className={s.pagina}>
        <h1 className={s.tituloPagina}>Bot não encontrado</h1>
        <p className={s.subPagina}>Ele pode ter sido excluído.</p>
      </div>
    );
  return (
    <div className={s.pagina}>
      <h1 className={s.tituloPagina}>{bot.nome}</h1>
      <p className={s.subPagina}>Mudanças valem a partir da próxima mensagem.</p>
      <FormBot key={bot.id} bot={bot} />
    </div>
  );
}

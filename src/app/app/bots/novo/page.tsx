"use client";

import { useEspaco } from "../../Espaco";
import { FormBot } from "../FormBot";
import s from "../../app.module.css";

export default function NovoBot() {
  const { carregado } = useEspaco();
  return (
    <div className={s.pagina}>
      <h1 className={s.tituloPagina}>Novo bot</h1>
      <p className={s.subPagina}>Um nome, um jeito de trabalhar e o que ele pode ler.</p>
      {carregado && <FormBot />}
    </div>
  );
}

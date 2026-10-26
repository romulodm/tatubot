"use client";

import { useState } from "react";
import { api, ErroApi } from "@/components/api";
import { useEspaco } from "../Espaco";
import s from "../app.module.css";

export function FormRepo() {
  const { recarregar } = useEspaco();
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setErro("");
    setEnviando(true);
    try {
      await api("/api/repos", {
        method: "POST",
        json: { url: String(f.get("url")).trim(), branch: String(f.get("branch") || "").trim() || undefined },
      });
      form.reset();
      await recarregar();
    } catch (x) {
      setErro(x instanceof ErroApi ? x.message : "Não foi possível cadastrar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className={s.formRepo} onSubmit={enviar}>
      <label className="campo">
        <span>URL do repositório</span>
        <input className="entrada" name="url" placeholder="https://github.com/owner/repositorio" required inputMode="url" />
      </label>
      <label className="campo">
        <span>Branch</span>
        <input className="entrada" name="branch" placeholder="padrão do repo" />
      </label>
      <button className="btn btn-primario" disabled={enviando}>
        {enviando ? "Conectando…" : "Conectar"}
      </button>
      {erro && (
        <p className="erro-form" role="alert">
          {erro}
        </p>
      )}
    </form>
  );
}

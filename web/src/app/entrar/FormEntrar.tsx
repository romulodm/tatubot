"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ErroApi } from "@/components/api";
import s from "./entrar.module.css";

export function FormEntrar() {
  const params = useSearchParams();
  const router = useRouter();
  const [modo, setModo] = useState<"entrar" | "registrar">(params.get("modo") === "registrar" ? "registrar" : "entrar");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const volta = params.get("volta");
  const destino = volta && volta.startsWith("/") && !volta.startsWith("//") ? volta : "/app";

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    const f = new FormData(e.currentTarget);
    try {
      await api(modo === "entrar" ? "/api/auth/login" : "/api/auth/registrar", {
        method: "POST",
        json: Object.fromEntries(f.entries()),
      });
      router.replace(destino);
      router.refresh();
    } catch (x) {
      setErro(x instanceof ErroApi ? x.message : "Não foi possível conectar ao servidor.");
      setEnviando(false);
    }
  }

  const registrar = modo === "registrar";
  return (
    <div className={s.caixa}>
      <h1 className={s.titulo}>{registrar ? "Crie sua conta" : "Entre na sua conta"}</h1>
      <p className={s.sub}>{registrar ? "Depois você conecta um repositório e cria seu primeiro bot." : "Seus bots estão onde você deixou."}</p>
      <form onSubmit={enviar} className={s.form}>
        {registrar && (
          <label className="campo">
            <span>Nome</span>
            <input className="entrada" name="nome" autoComplete="name" required minLength={2} maxLength={80} />
          </label>
        )}
        <label className="campo">
          <span>E-mail</span>
          <input className="entrada" name="email" type="email" autoComplete="email" required />
        </label>
        <label className="campo">
          <span>Senha</span>
          <input className="entrada" name="senha" type="password" autoComplete={registrar ? "new-password" : "current-password"} required minLength={registrar ? 8 : 1} />
          {registrar && <small>Pelo menos 8 caracteres.</small>}
        </label>
        {erro && (
          <p className="erro-form" role="alert">
            {erro}
          </p>
        )}
        <button className="btn btn-primario" disabled={enviando}>
          {enviando ? "Aguarde…" : registrar ? "Criar conta" : "Entrar"}
        </button>
      </form>
      <p className={s.trocar}>
        {registrar ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
        <button type="button" onClick={() => (setModo(registrar ? "entrar" : "registrar"), setErro(""))}>
          {registrar ? "Entrar" : "Criar conta"}
        </button>
      </p>
    </div>
  );
}

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
  const [verSenha, setVerSenha] = useState(false);
  const volta = params.get("volta");
  const destino = volta && volta.startsWith("/") && !volta.startsWith("//") ? volta : "/app";
  const registrar = modo === "registrar";

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    const f = new FormData(e.currentTarget);
    try {
      await api(registrar ? "/api/auth/registrar" : "/api/auth/login", {
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

  function trocarModo() {
    setModo(registrar ? "entrar" : "registrar");
    setErro("");
  }

  return (
    <div className={s.caixa}>
      <h1 className={s.titulo}>{registrar ? "Crie sua conta" : "Entre na sua conta"}</h1>
      <p className={s.sub}>
        {registrar ? "Depois você conecta um repositório e cria seu primeiro bot." : "Seus bots estão onde você deixou."}
      </p>
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
          <div className={s.senha}>
            <input
              className="entrada"
              name="senha"
              type={verSenha ? "text" : "password"}
              autoComplete={registrar ? "new-password" : "current-password"}
              required
              minLength={registrar ? 8 : 1}
            />
            <button
              type="button"
              className={s.olho}
              onClick={() => setVerSenha((v) => !v)}
              aria-label={verSenha ? "Esconder senha" : "Mostrar senha"}
              aria-pressed={verSenha}
              title={verSenha ? "Esconder senha" : "Mostrar senha"}
            >
              {verSenha ? <OlhoFechado /> : <Olho />}
            </button>
          </div>
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
        <button type="button" onClick={trocarModo}>
          {registrar ? "Entrar" : "Criar conta"}
        </button>
      </p>
    </div>
  );
}

function Olho() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OlhoFechado() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

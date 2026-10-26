"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ErroApi } from "@/components/api";
import { Avatar } from "@/components/Avatar";
import { TRABALHOS } from "@/lib/trabalhos";
import { useEspaco } from "../Espaco";
import type { BotUI } from "../tipos-ui";
import s from "../app.module.css";

const ESTILOS = ["pixelart", "pixels", "identicon", "stellar", "heraldry", "kaleidoscope", "marble", "terrain"];

export function FormBot({ bot }: { bot?: BotUI }) {
  const { repos, recarregar, novaConversa } = useEspaco();
  const router = useRouter();
  const [nome, setNome] = useState(bot?.nome ?? "");
  const [instrucoes, setInstrucoes] = useState(bot?.instrucoes ?? "");
  const [modo, setModo] = useState<BotUI["modo"]>(bot?.modo ?? "agente");
  const [repoIds, setRepoIds] = useState<string[]>(bot?.repoIds ?? (repos.length === 1 ? [repos[0].id] : []));
  const [seed, setSeed] = useState(bot?.avatarSeed ?? crypto.randomUUID());
  const [estilo, setEstilo] = useState(bot?.avatarEstilo ?? "pixelart");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  function usarTrabalho(id: string) {
    const t = TRABALHOS.find((x) => x.id === id)!;
    setNome(t.nome);
    setInstrucoes(t.instrucoes);
    setModo(t.modo);
    setSeed(t.id + "-" + Math.random().toString(36).slice(2, 6));
  }

  async function salvar(e: React.FormEvent, conversar = false) {
    e.preventDefault();
    setErro("");
    setSalvando(true);
    try {
      const corpo = { nome, instrucoes, modo, repoIds, avatarSeed: seed, avatarEstilo: estilo };
      const salvo = bot
        ? await api<BotUI>(`/api/bots/${bot.id}`, { method: "PATCH", json: corpo })
        : await api<BotUI>("/api/bots", { method: "POST", json: corpo });
      await recarregar();
      if (conversar || !bot) await novaConversa(salvo.id);
      else setSalvando(false);
    } catch (x) {
      setErro(x instanceof ErroApi ? x.message : "Não foi possível salvar.");
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!bot || !confirm(`Excluir ${bot.nome} e todas as conversas com ele?`)) return;
    await api(`/api/bots/${bot.id}`, { method: "DELETE" });
    await recarregar();
    router.replace("/app");
  }

  return (
    <form className={s.formBot} onSubmit={(e) => salvar(e)}>
      {!bot && (
        <div className={s.modelos}>
          <span className={s.meta}>Começar de um modelo</span>
          <div className={s.modelosLista}>
            {TRABALHOS.map((t) => (
              <button
                type="button"
                key={t.id}
                className="btn btn-contorno btn-peq"
                onClick={() => usarTrabalho(t.id)}
                aria-pressed={nome === t.nome}
              >
                {t.nome}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={s.identidade}>
        <button type="button" className={s.avatarBotao} onClick={() => setSeed(crypto.randomUUID())} title="Gerar outro avatar">
          <Avatar seed={seed} estilo={estilo} tamanho={72} />
          <span>Trocar</span>
        </button>
        <label className="campo" style={{ flex: 1 }}>
          <span>Nome</span>
          <input
            className="entrada"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            maxLength={40}
            placeholder="ex.: Guia de onboarding"
          />
        </label>
      </div>

      <div className={s.estilos} role="radiogroup" aria-label="Estilo do avatar">
        {ESTILOS.map((x) => (
          <button
            type="button"
            key={x}
            role="radio"
            aria-checked={estilo === x}
            className={s.estilo}
            onClick={() => setEstilo(x)}
            title={x}
          >
            <Avatar seed={seed} estilo={x} tamanho={30} />
          </button>
        ))}
      </div>

      <label className="campo">
        <span>Como ele deve trabalhar</span>
        <textarea
          className="entrada"
          value={instrucoes}
          onChange={(e) => setInstrucoes(e.target.value)}
          maxLength={4000}
          placeholder="ex.: Você ajuda pessoas novas no time. Explique do geral para o específico."
        />
        <small>Ele segue estas instruções, mas nunca deixa de citar o código nem lê repositórios fora da lista abaixo.</small>
      </label>

      <fieldset className={s.grupo}>
        <legend>Modo</legend>
        <label className={s.opcao} data-marcada={modo === "agente"}>
          <input type="radio" name="modo" checked={modo === "agente"} onChange={() => setModo("agente")} />
          <span>
            <strong>Agente</strong>
            Abre arquivos, procura termos e segue referências antes de responder. Mais lento, vai mais fundo.
          </span>
        </label>
        <label className={s.opcao} data-marcada={modo === "pipeline"}>
          <input type="radio" name="modo" checked={modo === "pipeline"} onChange={() => setModo("pipeline")} />
          <span>
            <strong>Busca direta</strong>
            Busca os trechos mais relevantes uma vez e responde. Rápido e previsível.
          </span>
        </label>
      </fieldset>

      <fieldset className={s.grupo}>
        <legend>Repositórios que ele pode ler</legend>
        {repos.length ? (
          repos.map((r) => (
            <label key={r.id} className={s.opcaoRepo}>
              <input
                type="checkbox"
                checked={repoIds.includes(r.id)}
                onChange={(e) => setRepoIds((x) => (e.target.checked ? [...x, r.id] : x.filter((i) => i !== r.id)))}
              />
              <span className="mono">
                {r.ghOwner}/{r.ghNome}
              </span>
              {r.status !== "pronto" && <span className="selo selo-vivo">indexando</span>}
            </label>
          ))
        ) : (
          <p className={s.meta}>
            Você ainda não conectou repositórios. <Link href="/app/repos">Conectar um</Link>
          </p>
        )}
      </fieldset>

      {erro && (
        <p className="erro-form" role="alert">
          {erro}
        </p>
      )}
      <div className={s.acoesLinha}>
        <button className="btn btn-primario" disabled={salvando}>
          {salvando ? "Salvando…" : bot ? "Salvar alterações" : "Criar e conversar"}
        </button>
        {bot && (
          <button type="button" className="btn btn-contorno" disabled={salvando} onClick={(e) => salvar(e, true)}>
            Salvar e conversar
          </button>
        )}
        {bot && (
          <button type="button" className="btn btn-fantasma btn-perigo" onClick={excluir}>
            Excluir bot
          </button>
        )}
      </div>
    </form>
  );
}

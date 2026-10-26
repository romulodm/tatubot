"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErroApi, ouvirEventos } from "@/components/api";
import { Avatar } from "@/components/Avatar";
import { Markdown, linkCitacao } from "@/components/Markdown";
import { useEspaco } from "../../Espaco";
import type { ConversaUI, MensagemUI } from "../../tipos-ui";
import s from "../../app.module.css";

const SUGESTOES = [
  "Como este projeto está organizado?",
  "Onde fica a autenticação e como ela funciona?",
  "Quais variáveis de ambiente o projeto lê?",
];

export default function Conversa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bots, repos, recarregar } = useEspaco();
  const [conversa, setConversa] = useState<ConversaUI | null>(null);
  const [mensagens, setMensagens] = useState<MensagemUI[]>([]);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [naoExiste, setNaoExiste] = useState(false);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [citacaoFoco, setCitacaoFoco] = useState<number | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const colarNoFim = useRef(true);

  const bot = bots.find((b) => b.id === conversa?.botId);
  const reposDoBot = repos.filter((r) => bot?.repoIds.includes(r.id));

  const carregarHistorico = useCallback(async () => {
    const r = await api<{ itens: MensagemUI[] }>(`/api/conversas/${id}/mensagens`);
    setMensagens(r.itens);
  }, [id]);

  useEffect(() => {
    setNaoExiste(false);
    api<ConversaUI>(`/api/conversas/${id}`)
      .then(setConversa)
      .catch((e) => e instanceof ErroApi && e.status === 404 && setNaoExiste(true));
    void carregarHistorico();
  }, [id, carregarHistorico]);

  useEffect(() => {
    const ctrl = new AbortController();
    void ouvirEventos(
      `/api/conversas/${id}/eventos`,
      (tipo, dado) => {
        if (tipo === "mensagem") {
          const m = dado as MensagemUI;
          setMensagens((xs) => (xs.some((x) => x.id === m.id) ? xs.map((x) => (x.id === m.id ? m : x)) : [...xs, m]));
          if (m.status === "concluida") void recarregar();
        } else if (tipo === "reconectando") {
          void carregarHistorico();
        }
      },
      ctrl.signal,
    );
    return () => ctrl.abort();
  }, [id, carregarHistorico, recarregar]);

  useEffect(() => {
    if (colarNoFim.current) fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  const respostas = mensagens.filter((m) => m.autor === "bot");
  const foco = useMemo(() => respostas.find((m) => m.id === selecionada) ?? respostas.at(-1) ?? null, [respostas, selecionada]);
  const trabalhando = respostas.some((m) => m.status === "pendente" || m.status === "processando");

  async function enviar(conteudo: string) {
    const c = conteudo.trim();
    if (!c || trabalhando) return;
    setErro("");
    setTexto("");
    colarNoFim.current = true;
    try {
      const r = await api<{ pergunta: MensagemUI; resposta: MensagemUI }>(`/api/conversas/${id}/mensagens`, {
        method: "POST",
        json: { conteudo: c },
      });
      setMensagens((xs) => [...xs.filter((x) => x.id !== r.resposta.id), r.pergunta, r.resposta]);
      setSelecionada(null);
      void recarregar();
    } catch (e) {
      setTexto(c);
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar.");
    }
  }

  if (naoExiste)
    return (
      <div className={s.pagina}>
        <h1 className={s.tituloPagina}>Conversa não encontrada</h1>
        <p className={s.subPagina}>
          Ela pode ter sido apagada. <Link href="/app">Voltar para os bots</Link>
        </p>
      </div>
    );

  return (
    <div className={s.conversa}>
      <section className={s.thread}>
        <header className={s.threadTopo}>
          {bot && <Avatar seed={bot.avatarSeed} estilo={bot.avatarEstilo} tamanho={32} />}
          <div className={s.threadTitulo}>
            <strong>{bot?.nome ?? " "}</strong>
            <span className={s.meta}>
              {reposDoBot.length ? reposDoBot.map((r) => `${r.ghOwner}/${r.ghNome}`).join(", ") : "sem repositórios"}
              {bot ? `, ${bot.modo === "agente" ? "modo agente" : "busca direta"}` : ""}
            </span>
          </div>
          {bot && (
            <Link href={`/app/bots/${bot.id}`} className="btn btn-fantasma btn-peq">
              Configurar
            </Link>
          )}
        </header>

        <div
          className={s.mensagens}
          onScroll={(e) => {
            const el = e.currentTarget;
            colarNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {!mensagens.length && bot && (
            <div className={s.boasVindas}>
              <Avatar seed={bot.avatarSeed} estilo={bot.avatarEstilo} tamanho={64} />
              <h2>Pergunte a {bot.nome}</h2>
              <p className={s.meta}>Toda resposta cita o arquivo e as linhas. Você vê o que ele está lendo enquanto trabalha.</p>
              <div className={s.sugestoes}>
                {SUGESTOES.map((x) => (
                  <button key={x} className="btn btn-contorno btn-peq" onClick={() => enviar(x)}>
                    {x}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mensagens.map((m) =>
            m.autor === "usuario" ? (
              <div key={m.id} className={s.falaUsuario}>
                {m.conteudo}
              </div>
            ) : (
              <Resposta
                key={m.id}
                m={m}
                bot={bot}
                ativa={foco?.id === m.id}
                aoSelecionar={() => setSelecionada(m.id)}
                aoFocarCitacao={setCitacaoFoco}
              />
            ),
          )}
          <div ref={fimRef} />
        </div>

        <form
          className={s.compositor}
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(texto);
          }}
        >
          {erro && (
            <p className="erro-form" role="alert">
              {erro}
            </p>
          )}
          <div className={s.compositorCaixa}>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void enviar(texto);
                }
              }}
              rows={1}
              placeholder={bot ? `Mensagem para ${bot.nome}` : "Mensagem"}
              aria-label="Mensagem"
              maxLength={4000}
            />
            <button className="btn btn-primario btn-peq" disabled={!texto.trim() || trabalhando}>
              {trabalhando ? "Trabalhando…" : "Enviar"}
            </button>
          </div>
        </form>
      </section>

      <Painel m={foco} citacaoFoco={citacaoFoco} />
    </div>
  );
}

function Resposta({
  m,
  bot,
  ativa,
  aoSelecionar,
  aoFocarCitacao,
}: {
  m: MensagemUI;
  bot?: { avatarSeed: string; avatarEstilo: string; nome: string };
  ativa: boolean;
  aoSelecionar: () => void;
  aoFocarCitacao: (i: number) => void;
}) {
  const vivo = m.status === "pendente" || m.status === "processando";
  const ultimoPasso = m.trilha.at(-1)?.descricao;
  return (
    <div className={s.falaBot} data-ativa={ativa} onClick={aoSelecionar}>
      {bot && <Avatar seed={bot.avatarSeed} estilo={bot.avatarEstilo} tamanho={28} />}
      <div className={s.falaBotCorpo}>
        {vivo && (
          <div className={s.trabalhando} aria-live="polite">
            <span className="pulso" />
            <span className="mono">{ultimoPasso ?? (m.status === "pendente" ? "Na fila" : "Começando")}</span>
          </div>
        )}
        {m.conteudo && <Markdown texto={m.conteudo} citacoes={m.citacoes} aoFocarCitacao={aoFocarCitacao} />}
        {m.status === "falhou" && <p className="erro-form">{m.erro ?? "Não consegui responder."}</p>}
        {m.status === "concluida" && m.citacoes.length > 0 && (
          <div className={s.fontesInline}>
            {m.citacoes.map((c, i) => (
              <a key={i} href={linkCitacao(c)} target="_blank" rel="noreferrer" className="mono">
                <span className="chip-citacao">{i + 1}</span>
                {c.path}:L{c.linhaInicio}-L{c.linhaFim}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ExecucaoUI {
  modo: string;
  status: string;
  tokensEntrada: number;
  tokensSaida: number;
  passos: { ordem: number; tipo: string; ferramenta: string | null; entrada: unknown; saidaResumo: string; duracaoMs: number }[];
  citacoesRemovidas: string[];
  iniciadoEm: string;
  finalizadoEm: string | null;
}

function Painel({ m, citacaoFoco }: { m: MensagemUI | null; citacaoFoco: number | null }) {
  const [exec, setExec] = useState<ExecucaoUI | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    setExec(null);
    if (m?.execucaoId && m.status === "concluida")
      void api<ExecucaoUI>(`/api/execucoes/${m.execucaoId}`)
        .then(setExec)
        .catch(() => {});
  }, [m?.execucaoId, m?.status]);

  if (!m)
    return (
      <aside className={s.painel} aria-label="Trilha da resposta">
        <h2 className={s.painelTitulo}>Trilha</h2>
        <p className={s.meta}>Quando o bot trabalhar, cada arquivo que ele ler e cada busca que ele fizer aparece aqui.</p>
      </aside>
    );

  const vivo = m.status === "pendente" || m.status === "processando";
  const inicio = m.trilha[0] ? new Date(m.trilha[0].em).getTime() : 0;
  const duracao = exec?.finalizadoEm ? (new Date(exec.finalizadoEm).getTime() - new Date(exec.iniciadoEm).getTime()) / 1000 : null;

  return (
    <aside className={s.painel} aria-label="Trilha da resposta" data-aberto={aberto}>
      <button className={s.painelAlternar} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        Trilha e fontes
      </button>
      <div className={s.painelCorpo}>
        <h2 className={s.painelTitulo}>
          Trilha
          {vivo ? (
            <span className="selo selo-vivo">
              <span className="pulso" /> trabalhando
            </span>
          ) : duracao !== null ? (
            <span className="selo">{duracao.toFixed(1)} s</span>
          ) : null}
        </h2>
        <ol className={s.trilha}>
          {m.trilha.map((p, i) => (
            <li key={i} data-ultimo={vivo && i === m.trilha.length - 1}>
              <span className="mono">{p.descricao}</span>
              <time className={s.meta}>+{((new Date(p.em).getTime() - inicio) / 1000).toFixed(1)}s</time>
            </li>
          ))}
          {!m.trilha.length && (
            <li className={s.meta}>{m.status === "pendente" ? "Na fila, esperando um worker livre." : "Sem passos registrados."}</li>
          )}
        </ol>

        {m.citacoes.length > 0 && (
          <>
            <h2 className={s.painelTitulo}>Fontes</h2>
            <ol className={s.fontes}>
              {m.citacoes.map((c, i) => (
                <li key={i} data-foco={citacaoFoco === i}>
                  <span className="chip-citacao">{i + 1}</span>
                  <a href={linkCitacao(c)} target="_blank" rel="noreferrer">
                    <span className="mono">{c.path}</span>
                    <span className={s.meta}>
                      linhas {c.linhaInicio}–{c.linhaFim} em {c.ghOwner}/{c.ghNome}@{c.commitSha.slice(0, 7)}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </>
        )}

        {exec && (
          <details className={s.bloco}>
            <summary>Execução completa ({exec.passos.length} passos)</summary>
            <p className={s.meta}>
              Modo {exec.modo}. {exec.tokensEntrada.toLocaleString("pt-BR")} tokens de entrada, {exec.tokensSaida.toLocaleString("pt-BR")}{" "}
              de saída.
              {exec.citacoesRemovidas.length ? ` ${exec.citacoesRemovidas.length} citação(ões) inválida(s) removida(s).` : ""}
            </p>
            <ol className={s.passosExec}>
              {exec.passos.map((p) => (
                <li key={p.ordem}>
                  <strong>
                    {p.ferramenta ?? p.tipo} <span className={s.meta}>{p.duracaoMs} ms</span>
                  </strong>
                  {p.entrada != null && <code>{JSON.stringify(p.entrada).slice(0, 200)}</code>}
                  <span className={s.meta}>{p.saidaResumo.slice(0, 220)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </aside>
  );
}

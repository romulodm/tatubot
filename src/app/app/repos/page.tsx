"use client";

import { useEffect, useState } from "react";
import { api, ErroApi } from "@/components/api";
import { useEspaco } from "../Espaco";
import type { RepoUI } from "../tipos-ui";
import { FormRepo } from "./FormRepo";
import s from "../app.module.css";

export default function Repos() {
  const { repos, recarregar, carregado } = useEspaco();
  const [aberto, setAberto] = useState<string | null>(null);

  // Enquanto algo indexa, atualiza o status a cada 2 s.
  const indexando = repos.some((r) => r.status === "pendente" || r.status === "indexando");
  useEffect(() => {
    if (!indexando) return;
    const t = setInterval(() => void recarregar(), 2000);
    return () => clearInterval(t);
  }, [indexando, recarregar]);

  return (
    <div className={s.pagina}>
      <h1 className={s.tituloPagina}>Repositórios</h1>
      <p className={s.subPagina}>O que seus bots podem ler. Cada repositório é indexado por função, classe e seção de documentação.</p>
      <FormRepo />

      <ul className={s.listaRepos}>
        {repos.map((r) => (
          <li key={r.id} className={s.repo} data-aberto={aberto === r.id}>
            <button className={s.repoLinha} onClick={() => setAberto(aberto === r.id ? null : r.id)} aria-expanded={aberto === r.id}>
              <span className={s.repoNome}>
                {r.ghOwner}/<strong>{r.ghNome}</strong>
              </span>
              <span className={`${s.meta} mono`}>{r.branch || "branch padrão"}</span>
              <Status r={r} />
            </button>
            {aberto === r.id && <DetalheRepo id={r.id} aoMudar={recarregar} aoRemover={() => setAberto(null)} />}
          </li>
        ))}
      </ul>
      {carregado && !repos.length && <p className={s.vazio}>Nenhum repositório ainda. Cole a URL de um repositório público acima.</p>}
    </div>
  );
}

function Status({ r }: { r: RepoUI }) {
  if (r.status === "pronto")
    return (
      <span className="selo selo-pronto">
        {r.totalArquivos} arquivos, {r.totalChunks} trechos
      </span>
    );
  if (r.status === "erro") return <span className="selo selo-erro">Falhou</span>;
  const p = r.progresso;
  return (
    <span className="selo selo-vivo">
      <span className="pulso" />
      {r.status === "pendente" ? "Na fila" : p ? `${capital(p.etapa)}${p.total ? ` ${p.processados}/${p.total}` : ""}` : "Indexando"}
    </span>
  );
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

interface Arquivo {
  path: string;
  status: string;
  motivo: string | null;
}

interface ResultadoBusca {
  path: string;
  simbolo: string | null;
  tipo: string;
  linhaInicio: number;
  linhaFim: number;
  viaGrafo: boolean;
  scores: { vetorial: number | null; textual: number | null; rrf: number; posVetorial: number | null; posTextual: number | null };
}

const MOTIVOS: Record<string, string> = {
  diretorio_ignorado: "pasta ignorada",
  lockfile: "lockfile",
  minificado: "minificado",
  binario: "binário",
  grande_demais: "maior que 200 KB",
  symlink: "link simbólico",
};

function motivoLegivel(m: string | null) {
  if (!m) return "";
  if (m.startsWith("segredo_detectado")) return `segredo detectado (${m.split(":")[1] ?? ""})`;
  return MOTIVOS[m] ?? m;
}

function DetalheRepo({ id, aoMudar, aoRemover }: { id: string; aoMudar: () => Promise<void>; aoRemover: () => void }) {
  const [repo, setRepo] = useState<RepoUI | null>(null);
  const [arquivos, setArquivos] = useState<{ itens: Arquivo[]; contagem: Record<string, number> } | null>(null);
  const [verSegredo, setVerSegredo] = useState(false);
  const [aviso, setAviso] = useState("");
  const [consulta, setConsulta] = useState("");
  const [busca, setBusca] = useState<{ resultados: ResultadoBusca[]; avisos: string[] } | null>(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    void api<RepoUI>(`/api/repos/${id}`).then(setRepo);
    void api<{ itens: Arquivo[]; contagem: Record<string, number> }>(`/api/repos/${id}/arquivos?status=ignorado`).then(setArquivos);
  }, [id]);

  async function sincronizar() {
    setAviso("");
    try {
      await api(`/api/repos/${id}/sincronizar`, { method: "POST" });
      setAviso("Sincronização na fila. Só os arquivos alterados serão reindexados.");
      await aoMudar();
    } catch (x) {
      setAviso(x instanceof ErroApi ? x.message : "Falhou.");
    }
  }

  async function remover() {
    if (!confirm("Remover este repositório? Os bots deixam de ler o código dele.")) return;
    await api(`/api/repos/${id}`, { method: "DELETE" });
    aoRemover();
    await aoMudar();
  }

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (!consulta.trim()) return;
    setBuscando(true);
    try {
      setBusca(await api(`/api/repos/${id}/busca`, { method: "POST", json: { consulta } }));
    } finally {
      setBuscando(false);
    }
  }

  if (!repo) return <div className={s.repoDetalhe}>Carregando…</div>;
  const webhook = typeof window !== "undefined" ? `${location.origin}/api/webhooks/github/${repo.id}` : "";
  const ignorados = arquivos?.itens ?? [];
  const segredos = ignorados.filter((a) => a.motivo?.startsWith("segredo"));

  return (
    <div className={s.repoDetalhe}>
      {repo.erro && <p className="erro-form">{repo.erro}</p>}
      <dl className={s.fatos}>
        <div>
          <dt>Commit indexado</dt>
          <dd className="mono">{repo.ultimoCommit ? repo.ultimoCommit.slice(0, 10) : "ainda não"}</dd>
        </div>
        <div>
          <dt>Última indexação</dt>
          <dd>
            {repo.ultimaIndexacao
              ? `${repo.ultimaIndexacao.modo}: ${repo.ultimaIndexacao.embeddingsGerados} embeddings novos, ${repo.ultimaIndexacao.embeddingsReaproveitados} reaproveitados`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Arquivos</dt>
          <dd>
            {arquivos?.contagem.indexado ?? 0} indexados, {arquivos?.contagem.ignorado ?? 0} ignorados
            {segredos.length ? `, ${segredos.length} com segredo` : ""}
          </dd>
        </div>
      </dl>

      <div className={s.acoesLinha}>
        <button className="btn btn-contorno btn-peq" onClick={sincronizar}>
          Sincronizar agora
        </button>
        <a className="btn btn-fantasma btn-peq" href={`https://github.com/${repo.ghOwner}/${repo.ghNome}`} target="_blank" rel="noreferrer">
          Abrir no GitHub
        </a>
        <button className="btn btn-fantasma btn-peq btn-perigo" onClick={remover}>
          Remover
        </button>
      </div>
      {aviso && <p className={s.meta}>{aviso}</p>}

      <details className={s.bloco}>
        <summary>Atualizar a cada push (webhook do GitHub)</summary>
        <p className={s.meta}>Em Settings → Webhooks do repositório, adicione esta URL com content type application/json, o segredo abaixo e o evento push. Em ambiente local, use um túnel como smee.io.</p>
        <div className={s.copiavel}>
          <span className="mono">{webhook}</span>
        </div>
        <div className={s.copiavel}>
          <span className="mono">{verSegredo ? repo.webhookSecret : "•".repeat(24)}</span>
          <button className="btn btn-fantasma btn-peq" onClick={() => setVerSegredo((v) => !v)}>
            {verSegredo ? "Ocultar" : "Mostrar segredo"}
          </button>
        </div>
      </details>

      {ignorados.length > 0 && (
        <details className={s.bloco}>
          <summary>Arquivos ignorados ({ignorados.length})</summary>
          <ul className={s.ignorados}>
            {ignorados.slice(0, 300).map((a) => (
              <li key={a.path} data-segredo={!!a.motivo?.startsWith("segredo")}>
                <span className="mono">{a.path}</span>
                <span>{motivoLegivel(a.motivo)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className={s.bloco}>
        <summary>Testar a busca</summary>
        <p className={s.meta}>Mostra o ranking que o bot recebe: posição na busca vetorial, na busca textual e a fusão (RRF).</p>
        <form onSubmit={buscar} className={s.formBusca}>
          <input className="entrada" value={consulta} onChange={(e) => setConsulta(e.target.value)} placeholder="ex.: onde o token é verificado" />
          <button className="btn btn-contorno btn-peq" disabled={buscando}>
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </form>
        {busca && (
          <>
            {busca.avisos.map((a) => (
              <p key={a} className={s.meta}>
                {a}
              </p>
            ))}
            <div className={s.tabelaRolagem}>
              <table className={s.tabela}>
                <thead>
                  <tr>
                    <th>Trecho</th>
                    <th>Vetorial</th>
                    <th>Textual</th>
                    <th>RRF</th>
                  </tr>
                </thead>
                <tbody>
                  {busca.resultados.map((r) => (
                    <tr key={`${r.path}:${r.linhaInicio}`}>
                      <td>
                        <a className="mono" href={`https://github.com/${repo.ghOwner}/${repo.ghNome}/blob/${repo.ultimoCommit}/${r.path}#L${r.linhaInicio}-L${r.linhaFim}`} target="_blank" rel="noreferrer">
                          {r.path}:{r.linhaInicio}-{r.linhaFim}
                        </a>
                        <div className={s.meta}>
                          {r.simbolo ?? r.tipo}
                          {r.viaGrafo ? ", via referências" : ""}
                        </div>
                      </td>
                      <td>{r.scores.posVetorial ? `#${r.scores.posVetorial} (${r.scores.vetorial?.toFixed(2)})` : "—"}</td>
                      <td>{r.scores.posTextual ? `#${r.scores.posTextual} (${r.scores.textual?.toFixed(1)})` : "—"}</td>
                      <td>{r.viaGrafo ? "—" : r.scores.rrf.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </details>
    </div>
  );
}

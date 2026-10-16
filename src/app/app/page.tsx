"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { useEspaco } from "./Espaco";
import { FormRepo } from "./repos/FormRepo";
import s from "./app.module.css";

export default function InicioApp() {
  const { usuario, bots, repos, conversas, carregado, novaConversa } = useEspaco();
  if (!carregado) return <div className={s.pagina} />;

  const primeiroNome = usuario.nome.split(" ")[0];

  // Primeiro acesso: o caminho é uma sequência real, então mostramos os passos.
  if (!repos.length || !bots.length) {
    return (
      <div className={s.pagina}>
        <h1 className={s.tituloPagina}>Olá, {primeiroNome}.</h1>
        <p className={s.subPagina}>Dois passos e você já pode perguntar sobre o seu código.</p>
        <ol className={s.onboarding}>
          <li data-feito={repos.length > 0}>
            <h2>Conecte um repositório do GitHub</h2>
            {repos.length ? (
              <p>
                {repos[0].ghOwner}/{repos[0].ghNome} conectado. <Link href="/app/repos">Ver status da indexação</Link>
              </p>
            ) : (
              <>
                <p>Repositórios públicos. A indexação roda em segundo plano enquanto você cria o bot.</p>
                <FormRepo />
              </>
            )}
          </li>
          <li data-feito={bots.length > 0}>
            <h2>Crie seu primeiro bot</h2>
            <p>Escolha um trabalho para ele e os repositórios que pode ler.</p>
            {!bots.length && (
              <Link href="/app/bots/novo" className="btn btn-primario" aria-disabled={!repos.length}>
                Criar bot
              </Link>
            )}
          </li>
        </ol>
      </div>
    );
  }

  return (
    <div className={s.pagina}>
      <h1 className={s.tituloPagina}>Seus bots</h1>
      <p className={s.subPagina}>Comece uma conversa ou ajuste o trabalho de cada um.</p>
      <div className={s.gradeBots}>
        {bots.map((b) => {
          const nomesRepos = b.repoIds.map((id) => repos.find((r) => r.id === id)).filter(Boolean).map((r) => `${r!.ghOwner}/${r!.ghNome}`);
          const ultima = conversas.find((c) => c.botId === b.id);
          return (
            <article key={b.id} className={s.cartaoBot}>
              <div className={s.cartaoTopo}>
                <Avatar seed={b.avatarSeed} estilo={b.avatarEstilo} tamanho={44} />
                <div>
                  <h2>{b.nome}</h2>
                  <span className={s.meta}>{b.modo === "agente" ? "Agente" : "Busca direta"}</span>
                </div>
              </div>
              <p className={s.cartaoInstrucoes}>{b.instrucoes || "Sem instruções. Responde de forma direta, com citações."}</p>
              <p className={s.meta}>{nomesRepos.length ? nomesRepos.join(", ") : "Nenhum repositório vinculado"}</p>
              <div className={s.cartaoAcoes}>
                <button className="btn btn-primario btn-peq" onClick={() => novaConversa(b.id)}>
                  Nova conversa
                </button>
                {ultima && (
                  <Link href={`/app/c/${ultima.id}`} className="btn btn-fantasma btn-peq">
                    Continuar a última
                  </Link>
                )}
                <Link href={`/app/bots/${b.id}`} className="btn btn-fantasma btn-peq">
                  Configurar
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Avatar } from "@/components/Avatar";
import { Marca } from "@/components/Marca";
import type { BotUI, ConversaUI, RepoUI } from "./tipos-ui";
import s from "./app.module.css";

interface Estado {
  usuario: { id: string; nome: string; papel: string };
  bots: BotUI[];
  repos: RepoUI[];
  conversas: ConversaUI[];
  carregado: boolean;
  recarregar: () => Promise<void>;
  novaConversa: (botId: string) => Promise<void>;
}

const Ctx = createContext<Estado | null>(null);
export const useEspaco = () => useContext(Ctx)!;

export function Espaco({ usuario, children }: { usuario: Estado["usuario"]; children: React.ReactNode }) {
  const [bots, setBots] = useState<BotUI[]>([]);
  const [repos, setRepos] = useState<RepoUI[]>([]);
  const [conversas, setConversas] = useState<ConversaUI[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const router = useRouter();
  const caminho = usePathname();

  const recarregar = useCallback(async () => {
    const [b, r, c] = await Promise.all([
      api<{ itens: BotUI[] }>("/api/bots"),
      api<{ itens: RepoUI[] }>("/api/repos?limite=100"),
      api<{ itens: ConversaUI[] }>("/api/conversas"),
    ]);
    setBots(b.itens);
    setRepos(r.itens);
    setConversas(c.itens);
    setCarregado(true);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  useEffect(() => setMenuAberto(false), [caminho]);

  const novaConversa = useCallback(
    async (botId: string) => {
      const c = await api<ConversaUI>(`/api/bots/${botId}/conversas`, { method: "POST", json: {} });
      setConversas((x) => [c, ...x]);
      router.push(`/app/c/${c.id}`);
    },
    [router],
  );

  async function sair() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return (
    <Ctx.Provider value={{ usuario, bots, repos, conversas, carregado, recarregar, novaConversa }}>
      <div className={s.espaco}>
        <aside className={s.lateral} data-aberto={menuAberto}>
          <div className={s.lateralTopo}>
            <button className={s.menuBotao} onClick={() => setMenuAberto((v) => !v)} aria-expanded={menuAberto} aria-label="Abrir menu">
              <span />
              <span />
            </button>
          </div>
          <div className={s.lateralCorpo}>
            <Link href="/app/bots/novo" className="btn btn-contorno btn-peq">
              Novo bot
            </Link>

            <nav aria-label="Bots e conversas" className={s.listaBots}>
              {bots.map((b) => {
                const dele = conversas.filter((c) => c.botId === b.id).slice(0, 6);
                return (
                  <div key={b.id} className={s.grupoBot}>
                    <div className={s.botLinha}>
                      <Link href={`/app/bots/${b.id}`} className={s.botNome} data-ativo={caminho === `/app/bots/${b.id}`}>
                        <Avatar seed={b.avatarSeed} estilo={b.avatarEstilo} tamanho={24} />
                        <span>{b.nome}</span>
                      </Link>
                      <button
                        className={s.botNova}
                        onClick={() => novaConversa(b.id)}
                        aria-label={`Nova conversa com ${b.nome}`}
                        title="Nova conversa"
                      >
                        +
                      </button>
                    </div>
                    {dele.map((c) => (
                      <Link key={c.id} href={`/app/c/${c.id}`} className={s.conversaLink} data-ativo={caminho === `/app/c/${c.id}`}>
                        {c.titulo}
                      </Link>
                    ))}
                  </div>
                );
              })}
              {carregado && !bots.length && <p className={s.vazioLateral}>Seus bots aparecem aqui.</p>}
            </nav>
          </div>
          <div className={s.lateralRodape}>
            <Link href="/app/repos" className={s.itemRodape} data-ativo={caminho === "/app/repos"}>
              Repositórios
              <span className={s.contador}>{repos.length}</span>
            </Link>
            <div className={s.usuario}>
              <span title={usuario.nome}>{usuario.nome}</span>
              <button className="btn btn-fantasma btn-peq" onClick={sair}>
                Sair
              </button>
            </div>
          </div>
        </aside>
        <main className={s.principal}>{children}</main>
      </div>
    </Ctx.Provider>
  );
}

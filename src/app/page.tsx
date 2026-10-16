import Link from "next/link";
import { Marca } from "@/components/Marca";
import { Avatar } from "@/components/Avatar";
import { usuarioAtual } from "@/lib/auth/sessao";
import { Trabalhos } from "./Trabalhos";
import s from "./landing.module.css";

export default async function Inicio() {
  const u = await usuarioAtual();
  return (
    <div className={s.pagina}>
      <header className={s.topo}>
        <Marca />
        <nav className={s.nav}>
          {u ? (
            <Link href="/app" className="btn btn-primario btn-peq">
              Abrir meus bots
            </Link>
          ) : (
            <>
              <Link href="/entrar" className="btn btn-fantasma btn-peq">
                Entrar
              </Link>
              <Link href="/entrar?modo=registrar" className="btn btn-primario btn-peq">
                Criar conta
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className={s.hero}>
          <h1 className={s.titulo}>
            Conheça
            <br />o RepoBot
          </h1>
          <div className={s.heroLado}>
            <p className={s.lede}>
              Colegas de IA que leram o seu código. Conecte um repositório do GitHub, dê um trabalho a cada bot e pergunte como as coisas funcionam. A resposta vem com o arquivo e as linhas de onde saiu.
            </p>
            <div className={s.acoes}>
              <Link href={u ? "/app" : "/entrar?modo=registrar"} className="btn btn-primario">
                Criar meu primeiro bot
              </Link>
              <a href="#como-funciona" className="btn btn-contorno">
                Ver como funciona
              </a>
            </div>
          </div>
        </section>

        <Demonstracao />

        <section className={s.secao}>
          <h2 className={s.h2}>Dê um trabalho a cada bot</h2>
          <p className={s.secaoLede}>Um bot é um nome, um jeito de trabalhar e os repositórios que ele pode ler. Comece por um destes ou escreva o seu.</p>
          <Trabalhos />
        </section>

        <section className={s.secao} id="como-funciona">
          <h2 className={s.h2}>Do repositório à primeira resposta</h2>
          <ol className={s.passos}>
            <li>
              <h3>Conecte um repositório</h3>
              <p>Cole a URL de um repositório público. O RepoBot clona, ignora dependências, binários e arquivos com segredo, e quebra o código por função e classe.</p>
            </li>
            <li>
              <h3>Crie um bot</h3>
              <p>Dê um nome, escreva como ele deve trabalhar e escolha o modo: busca direta para respostas rápidas ou agente, que abre arquivos e segue referências.</p>
            </li>
            <li>
              <h3>Pergunte como a um colega</h3>
              <p>Você acompanha o que ele está lendo enquanto trabalha. Cada afirmação aponta para as linhas no GitHub, fixadas no commit que ele leu.</p>
            </li>
          </ol>
        </section>

        <section className={s.secao}>
          <h2 className={s.h2}>Feito para você poder conferir</h2>
          <dl className={s.garantias}>
            <div>
              <dt>Cita ou fica quieto</dt>
              <dd>Citações para linhas que o bot não leu nesta conversa são removidas antes de a resposta chegar até você.</dd>
            </div>
            <div>
              <dt>Lê só o que é seu</dt>
              <dd>Cada bot enxerga apenas os repositórios que você vinculou a ele. Texto escondido no código não muda essas regras.</dd>
            </div>
            <div>
              <dt>Segredos ficam de fora</dt>
              <dd>Arquivos .env, chaves privadas e tokens são detectados antes da indexação e nunca chegam ao modelo.</dd>
            </div>
            <div>
              <dt>Acompanha o seu push</dt>
              <dd>Pelo webhook do GitHub ou pelo botão de sincronizar, só os arquivos que mudaram são reindexados.</dd>
            </div>
          </dl>
        </section>

        <section className={s.final}>
          <h2 className={s.finalTitulo}>Seu primeiro bot leva dois minutos.</h2>
          <Link href={u ? "/app" : "/entrar?modo=registrar"} className="btn btn-primario">
            Começar agora
          </Link>
        </section>
      </main>

      <footer className={s.rodape}>
        <Marca />
        <span>Projeto de nivelamento técnico. Next.js, MongoDB e uma fila no próprio banco.</span>
      </footer>
    </div>
  );
}

// Uma conversa de exemplo: a única animação da página é a trilha
// aparecendo linha a linha, como acontece no produto.
function Demonstracao() {
  const trilha = ["Procurando por refreshToken, rotate, revoke", "Lendo src/lib/auth/tokens.ts L58-L83", "Rastreando referências de rotacionarRefresh"];
  return (
    <section className={s.demo} aria-label="Exemplo de conversa com um bot">
      <div className={s.janela}>
        <div className={s.janelaTopo}>
          <Avatar seed="guia-onboarding" tamanho={28} />
          <strong>Guia de onboarding</strong>
          <span className="selo">acme/api</span>
        </div>
        <div className={s.thread}>
          <div className={s.falaUsuario}>Como funciona a renovação de sessão? Já vi o token sendo trocado duas vezes.</div>
          <ul className={s.trilha}>
            {trilha.map((t, i) => (
              <li key={t} style={{ animationDelay: `${0.5 + i * 0.7}s` }}>
                <span className={s.trilhaPonto} />
                <span className="mono">{t}</span>
              </li>
            ))}
          </ul>
          <div className={s.falaBot} style={{ animationDelay: "2.8s" }}>
            <p>
              A cada renovação o refresh token usado é revogado e um novo é emitido na mesma família<a className="chip-citacao" href="#">1</a>. Se um token já revogado aparecer de novo, a família inteira é revogada e a pessoa precisa entrar outra vez
              <a className="chip-citacao" href="#">2</a>.
            </p>
            <p>Ver o token trocar duas vezes é esperado quando duas abas renovam ao mesmo tempo: só uma ganha o sucessor, a outra recebe 401 e tenta de novo.</p>
            <div className={s.fontes}>
              <span className="mono">1 src/lib/auth/tokens.ts:L71-L80</span>
              <span className="mono">2 src/lib/auth/tokens.ts:L62-L66</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Copiar } from "@/components/Copiar";
import { usuarioAtual } from "@/lib/auth/sessao";
import { Trabalhos } from "./Trabalhos";
import s from "./landing.module.css";

// Landing page.
//
// Visual no mesmo estilo do seedicon.romulodm.dev: fundo quase preto, uma
// coluna de 960px, rótulos de seção em caixa alta, números em grade e um
// único acento (violeta) para o que é clicável ou "vivo". Os avatares dos
// bots são do próprio seedicon, então a página e o produto falam a mesma língua.

// Parede de avatares do hero: cada bot tem uma seed e um estilo.
const PAREDE = [
  ["guia-onboarding", "pixelart"],
  ["revisor-seguranca", "dither"],
  ["cacador-bugs", "pixels"],
  ["documentador", "lifehash"],
  ["arqueologo", "terrain"],
  ["tatubot", "identicon"],
  ["pr-review", "marble"],
  ["migracoes", "kaleidoscope"],
  ["infra", "stellar"],
  ["testes", "truchet"],
  ["frontend", "pixelart"],
  ["api-docs", "waves"],
  ["legado", "heraldry"],
  ["observabilidade", "randomart"],
  ["onboarding-2", "jdenticon"],
] as const;

const COMANDO = "docker compose up --build";

export default async function Inicio() {
  const u = await usuarioAtual();
  const destino = u ? "/app" : "/entrar?modo=registrar";

  return (
    <div className={s.pagina}>
      <header className={s.topo}>
        <nav className={`${s.container} ${s.nav}`} aria-label="Principal">
          <Link href="/" className={s.logo} aria-label="tatubot, página inicial">
            <Avatar seed="tatubot" estilo="pixelart" tamanho={24} forma="rounded" />
            tatubot
          </Link>
          <div className={s.navLinks}>
            <a href="#como-funciona">Como funciona</a>
            <a href="#por-dentro">Por dentro</a>
            <a href="#faq">FAQ</a>
            <span className={s.navSeparador} aria-hidden />
            {u ? (
              <Link href="/app" className={s.navDestaque}>
                Meus bots
              </Link>
            ) : (
              <>
                <Link href="/entrar">Entrar</Link>
                <Link href="/entrar?modo=registrar" className={s.navDestaque}>
                  Criar conta
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main className={s.container}>
        {/* ---------- hero ---------- */}
        <section className={s.hero}>
          <div>
            <h1 className={s.titulo}>
              Bots que lêem
              <br />o seu código.
            </h1>
            <p className={s.lede}>
              <strong>tatubot</strong> indexa um repositório do GitHub e cria colegas de IA que respondem perguntas sobre ele. Toda resposta cita o arquivo e as linhas de onde
              saiu, com link para o commit que o bot leu. Sem citação, sem afirmação.
            </p>
            <div className={s.acoes}>
              <Link href={destino} className={s.btnPrimario}>
                Criar meu primeiro bot
              </Link>
              <a href="#como-funciona" className={s.btnSecundario}>
                Como funciona
              </a>
              <div className={s.comando}>
                <code>
                  <span className={s.prompt}>$</span> {COMANDO}
                </code>
                <Copiar texto={COMANDO} className={s.copiar} />
              </div>
            </div>
            <p className={s.nota}>
              Funciona até sem LLM, em modo extrativo. Com uma chave da OpenAI, explica.{" "}
              <a href="#por-dentro" className={s.link}>
                Ver o caminho de uma pergunta <span aria-hidden>›</span>
              </a>
            </p>
          </div>
          <div className={s.parede} aria-hidden>
            {PAREDE.map(([seed, estilo]) => (
              <Avatar key={seed} seed={seed} estilo={estilo} tamanho={52} forma="rounded" />
            ))}
          </div>
        </section>

        {/* ---------- números ---------- */}
        <dl className={s.numeros}>
          <div>
            <dt>Rankings fundidos</dt>
            <dd>3</dd>
          </div>
          <div>
            <dt>Ferramentas do agente</dt>
            <dd>5</dd>
          </div>
          <div>
            <dt>Serviços</dt>
            <dd>2</dd>
          </div>
          <div>
            <dt>Segredos indexados</dt>
            <dd>0</dd>
          </div>
        </dl>

        {/* ---------- exemplo ---------- */}
        <section className={s.secao} id="exemplo">
          <h2 className={s.rotulo}>Exemplo</h2>
          <p className={s.secaoLede}>
            Uma pergunta, o que o bot fez para responder e a resposta. A trilha aparece ao vivo no chat, linha a linha, enquanto ele trabalha. Os números são citações: passe o
            mouse e veja de onde veio cada frase.
          </p>
          <Demonstracao />
        </section>

        {/* ---------- modelos ---------- */}
        <section className={s.secao} id="modelos">
          <h2 className={s.rotulo}>Modelos</h2>
          <p className={s.secaoLede}>
            Um bot é um nome, um jeito de trabalhar e os repositórios que ele pode ler. Dá para começar por um destes cinco ou escrever as instruções do zero.
          </p>
          <Trabalhos />
        </section>

        {/* ---------- como funciona ---------- */}
        <section className={s.secao} id="como-funciona">
          <h2 className={s.rotulo}>Como funciona</h2>
          <p className={s.secaoLede}>Três passos do repositório à primeira resposta. A parte demorada (clonar e indexar) roda em segundo plano enquanto você cria o bot.</p>
          <ol className={s.passos}>
            <li>
              <span className={s.passoNumero}>01</span>
              <h3>Conecte um repositório</h3>
              <p>Cole a URL de um repositório público. Dependências, binários e arquivos com segredo ficam de fora; o código é quebrado por função, classe e método.</p>
            </li>
            <li>
              <span className={s.passoNumero}>02</span>
              <h3>Crie um bot</h3>
              <p>Escreva como ele deve trabalhar e escolha o modo: busca direta, rápida, ou agente, que abre arquivos e segue referências até ter certeza.</p>
            </li>
            <li>
              <span className={s.passoNumero}>03</span>
              <h3>Pergunte como a um colega</h3>
              <p>Cada afirmação aponta para as linhas no GitHub, fixadas no commit lido. Um push no repositório reindexa só o que mudou.</p>
            </li>
          </ol>
        </section>

        {/* ---------- por dentro ---------- */}
        <section className={s.secao} id="por-dentro">
          <h2 className={s.rotulo}>Por dentro</h2>
          <p className={s.secaoLede}>
            É RAG, <em>retrieval-augmented generation</em>: antes de responder, o bot busca no seu código os trechos que importam e só então escreve, usando apenas o que leu. A
            qualidade da resposta é a qualidade da busca, então quase todo o trabalho está aqui.
          </p>
          <div className={s.fluxo}>
            <div>
              <h3>
                <span className={s.fluxoTag}>1</span> Indexação
              </h3>
              <p>Feita uma vez por commit, no worker.</p>
              <ul>
                <li>
                  <code>git clone</code> raso, sem shell
                </li>
                <li>filtros: lockfiles, binários, minificados</li>
                <li>varredura de segredos antes de tudo</li>
                <li>chunks pela AST (função, classe, método)</li>
                <li>embeddings, reaproveitados pelo hash</li>
              </ul>
            </div>
            <div>
              <h3>
                <span className={s.fluxoTag}>2</span> Busca
              </h3>
              <p>A cada pergunta, em três frentes.</p>
              <ul>
                <li>vetorial: significado (cosseno)</li>
                <li>textual: identificadores exatos (BM25)</li>
                <li>caminho: o nome da pasta e do arquivo</li>
                <li>
                  fusão por posição (<abbr title="Reciprocal Rank Fusion">RRF</abbr>)
                </li>
                <li>filtro por cobertura dos conceitos</li>
              </ul>
            </div>
            <div>
              <h3>
                <span className={s.fluxoTag}>3</span> Resposta
              </h3>
              <p>O modelo escreve; o código confere.</p>
              <ul>
                <li>pipeline: trechos prontos, uma chamada</li>
                <li>agente: ferramentas em loop, com limites</li>
                <li>citação fora do que foi lido é removida</li>
                <li>link fixado no commit indexado</li>
                <li>trilha e texto ao vivo via SSE</li>
              </ul>
            </div>
          </div>
          <p className={s.notaSecao}>
            Cada etapa está explicada, do básico ao detalhe, em <code>docs/rag/</code> no repositório.
          </p>
        </section>

        {/* ---------- garantias ---------- */}
        <section className={s.secao} id="garantias">
          <h2 className={s.rotulo}>Garantias</h2>
          <p className={s.secaoLede}>Feito para você poder conferir, não só confiar.</p>
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

        {/* ---------- faq ---------- */}
        <section className={`${s.secao} ${s.faq}`} id="faq">
          <div className={s.faqIntro}>
            <h2 className={s.rotulo}>FAQ</h2>
            <p>Perguntas que sempre aparecem.</p>
            <p className={s.faqMenor}>
              O resto está no <code>README.md</code> e em <code>docs/</code>, no repositório.
            </p>
          </div>
          <div className={s.faqLista}>
            <details>
              <summary>Preciso de uma chave da OpenAI?</summary>
              <p>
                Não. Sem chave o bot roda em modo extrativo: busca e devolve os trechos certos, agrupados por arquivo e com citação, mas não explica. Com <code>LLM_API_KEY</code>{" "}
                no <code>.env</code> ele passa a explicar, e os embeddings passam a entender sinônimos.
              </p>
            </details>
            <details>
              <summary>O que sai da minha máquina?</summary>
              <p>
                No modo local, nada. Com um LLM configurado, os trechos relevantes vão no prompt e o texto dos chunks vai para a API de embeddings. Arquivos com segredo
                detectado nunca entram no índice, então nunca vão para lugar nenhum.
              </p>
            </details>
            <details>
              <summary>Qual a diferença entre busca direta e agente?</summary>
              <p>
                A busca direta (pipeline) busca uma vez e pede uma resposta: rápida e barata. O agente decide sozinho o que buscar, abre arquivos, segue quem chama quem e só
                responde quando tem o suficiente, dentro de um limite de passos, tokens e tempo.
              </p>
            </details>
            <details>
              <summary>Como o bot sabe o que pode citar?</summary>
              <p>
                Cada busca e cada leitura de arquivo registra o intervalo de linhas visto. Depois que a resposta fica pronta, toda citação é conferida contra esses intervalos:
                o que estiver fora é removido e fica anotado em &quot;ver o raciocínio&quot;.
              </p>
            </details>
            <details>
              <summary>Funciona com repositório privado?</summary>
              <p>Por enquanto, só públicos. O clone roda sem credenciais e sem prompt de senha, então um repositório privado falha na hora, com o motivo na tela.</p>
            </details>
            <details>
              <summary>O que acontece quando eu dou push?</summary>
              <p>
                Com o webhook configurado, o GitHub avisa e o worker compara o commit novo com o indexado. Só os arquivos do diff são reindexados, e embeddings de trechos que não
                mudaram de texto são reaproveitados, mesmo que tenham mudado de linha.
              </p>
            </details>
          </div>
        </section>

        <section className={s.final}>
          <h2>Seu primeiro bot leva dois minutos.</h2>
          <Link href={destino} className={s.btnPrimario}>
            Começar agora
          </Link>
        </section>
      </main>

      <footer className={s.rodape}>
        <div className={`${s.container} ${s.rodapeGrade}`}>
          <div className={s.rodapeMarca}>
            <Link href="/" className={s.logo}>
              <Avatar seed="tatubot" estilo="pixelart" tamanho={24} forma="rounded" />
              tatubot
            </Link>
            <p>Colegas de IA que lêem o seu código. Respostas com arquivo e linha, ou nenhuma resposta.</p>
            <p className={s.rodapeMenor}>Projeto de nivelamento técnico · Next.js, Node.js e MongoDB</p>
          </div>
          <div className={s.rodapeColunas}>
            <div>
              <h3>Produto</h3>
              <ul>
                <li>
                  <Link href={u ? "/app" : "/entrar"}>{u ? "Meus bots" : "Entrar"}</Link>
                </li>
                <li>
                  <Link href="/entrar?modo=registrar">Criar conta</Link>
                </li>
                <li>
                  <a href="#modelos">Modelos</a>
                </li>
              </ul>
            </div>
            <div>
              <h3>Como funciona</h3>
              <ul>
                <li>
                  <a href="#como-funciona">Passo a passo</a>
                </li>
                <li>
                  <a href="#por-dentro">RAG por dentro</a>
                </li>
                <li>
                  <a href="#faq">FAQ</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Uma conversa de exemplo: a única animação da página é a trilha
// aparecendo linha a linha, como acontece no produto.
function Demonstracao() {
  const trilha = ["Procurando por refreshToken, rotate, revoke", "Lendo web/src/lib/auth/tokens.ts L69-L93", "Rastreando referências de rotacionarRefresh"];
  return (
    <div className={s.janela} role="figure" aria-label="Exemplo de conversa com um bot">
      <div className={s.janelaTopo}>
        <Avatar seed="guia-onboarding" tamanho={24} />
        <strong>Guia de onboarding</strong>
        <span className={s.janelaRepo}>acme/api</span>
      </div>
      <div className={s.thread}>
        <div className={s.falaUsuario}>Como funciona a renovação de sessão? Já vi o token sendo trocado duas vezes.</div>
        <ul className={s.trilha}>
          {trilha.map((t, i) => (
            <li key={t} style={{ animationDelay: `${0.5 + i * 0.7}s` }}>
              <span className={s.trilhaPonto} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <div className={s.falaBot} style={{ animationDelay: "2.8s" }}>
          <p>
            A cada renovação o refresh token usado é revogado e um novo é emitido na mesma família
            <a className="chip-citacao" href="#exemplo" title="web/src/lib/auth/tokens.ts:L83-L92">
              1
            </a>
            . Se um token já revogado aparecer de novo, a família inteira é revogada e a pessoa precisa entrar outra vez
            <a className="chip-citacao" href="#exemplo" title="web/src/lib/auth/tokens.ts:L77-L80">
              2
            </a>
            .
          </p>
          <p>Ver o token trocar duas vezes é esperado quando duas abas renovam ao mesmo tempo: só uma ganha o sucessor, a outra recebe 401 e tenta de novo.</p>
          <div className={s.fontes}>
            <span>1 web/src/lib/auth/tokens.ts:L83-L92</span>
            <span>2 web/src/lib/auth/tokens.ts:L77-L80</span>
          </div>
        </div>
      </div>
    </div>
  );
}

# tatubot

Colegas de IA que lêem o seu código. Você conecta repositórios do GitHub, cria bots
(nome, instruções, modo e repositórios que podem ler) e conversa com eles. Toda resposta
cita `arquivo:linhas`, com link para o GitHub fixado no commit indexado, e você acompanha
ao vivo o que o bot está lendo.

Dois serviços:

- **`web/`** — Next.js 16 + TypeScript: páginas e autenticação (cadastro, login, refresh, JWKS);
- **`api/`** — Node 22 + JavaScript, sem framework HTTP: repositórios, bots, conversas,
  a fila, a indexação e o RAG. Roda como `api` (HTTP + SSE) e `worker` (fila).

Ambos usam o mesmo MongoDB; a fila é uma coleção dele. O desenho completo está em
[`docs/arquitetura.md`](docs/arquitetura.md) e o RAG, do básico ao detalhe, em
[`docs/rag/`](docs/rag/README.md).

## Rodar com Docker

```bash
cp .env.example .env        # opcional: coloque sua LLM_API_KEY da OpenAI
docker compose up --build   # http://localhost:3000
```

O primeiro usuário cadastrado vira `admin`.

Sem `LLM_API_KEY`, o bot funciona em **modo extrativo**: busca e devolve os trechos
certos, com citações, mas não explica. Com a chave, usa `gpt-4.1-mini` para responder e
`text-embedding-3-small` para a busca por significado (dá para trocar no `.env`). Ao
trocar o modelo de embedding, sincronize os repositórios para reindexar.

Serviços do compose:

| Serviço | Porta | O que é |
|---|---|---|
| `web` | 3000 | o site; repassa `/api/*` para a api |
| `api` | 127.0.0.1:4000 | API HTTP (para depuração; o navegador passa pelo web) |
| `worker` | — | indexação e respostas do bot |
| `mongo` | 127.0.0.1:27017 | banco e fila |
| `ollama` | 127.0.0.1:11434 | opcional (`--profile ollama`), LLM local no lugar da OpenAI |

## Rodar sem Docker

Precisa de Node 22, git e um MongoDB em `localhost:27017`.

```bash
cp .env.example .env

# terminal 1: microsserviço (API + worker no mesmo processo)
cd api && npm install && npm run dev        # :4000

# terminal 2: web
cd web && npm install && npm run dev        # :3000
```

O web gera o par de chaves do JWT em `web/data/chaves/` no primeiro acesso; a api busca
a chave pública em `http://localhost:3000/.well-known/jwks.json`.

## Como funciona

```
navegador ──► web (Next) ─── /api/* ───► api (Node) ──► MongoDB
   ▲  SSE      │ login, refresh, JWKS        │ publica eventos   ├─ usuarios, refresh_tokens (web)
   │           ▼                             ▼                   ├─ repositorios, arquivos, chunks
   └────────── cookies ◄─────────── worker ◄─ fila ─────────────┤─ bots, conversas, mensagens
                                    indexação e runtime do bot   └─ eventos, eventos_processados, execucoes
```

1. `POST /api/repos` grava o repositório e publica `repo.cadastrado`.
2. O worker clona (`git` via `spawn`, sem shell), filtra dependências, binários e
   arquivos grandes, descarta arquivos com segredo, quebra JS/TS pela AST, Markdown por
   heading e o resto em blocos, e gera embeddings.
3. `POST /api/conversas/:id/mensagens` grava a pergunta, cria a resposta `pendente`,
   publica `mensagem.recebida` e devolve `202`.
4. O worker roda o bot: **busca direta** (reescreve a pergunta em termos de código,
   busca híbrida vetorial + BM25 + caminho com RRF e expansão por referências, responde)
   ou **agente** (loop com `buscar_semantico`, `buscar_texto`, `ler_arquivo`,
   `listar_diretorio`, `referencias`, com limite de passos, tokens e tempo).
5. Citações para linhas que o bot não viu são removidas. A trilha e o texto parcial são
   gravados na mensagem, e o SSE os envia ao navegador.

## Mapa do código

| Pasta | O que tem |
|---|---|
| `web/src/app` | landing, login, app (bots, chat com trilha e fontes, repositórios) |
| `web/src/app/api/auth` | registrar, login, refresh (rotação), logout, me |
| `web/src/lib/auth` | scrypt, JWT RS256, par de chaves e JWKS, cookies |
| `api/src/http` | roteador, parser de body, respostas e SSE, validação, rate limit, JWT à mão, JWKS |
| `api/src/rotas` | rotas HTTP (mesmo formato de erro em todas) |
| `api/src/fila` | publicar, reivindicar, retry/DLQ, idempotência, worker e consumidores |
| `api/src/indexacao` | git, filtros, segredos, chunker por AST, tokenizador, indexação completa e incremental |
| `api/src/busca` | análise da pergunta, busca híbrida, BM25, RRF, cobertura, grafo |
| `api/src/llm` | cliente compatível com OpenAI (streaming e tools) e embeddings |
| `api/src/agente` | runtime (extrativo, pipeline, agente), ferramentas, prompts, validação de citações |
| `docs/` | `arquitetura.md`, `rag/` (como o RAG funciona), `decisoes.md`, `context.md` |

## Testes

```bash
cd api && npm test     # node:test; o teste da fila roda se houver Mongo em MONGODB_URI
cd web && npm test     # vitest (senha, JWT RS256, JWKS)
cd web && npm run typecheck
```

Para testar os modos pipeline e agente sem gastar crédito, há um LLM falso:
`cd api && npm run llm-falso` (detalhes em [`docs/rag/08`](docs/rag/08-ajustando-e-depurando.md#testando-sem-gastar-crédito)).

## Segredos

O repositório é público, então:

- a chave da OpenAI só existe no `.env` (ignorado pelo git); o `.env.example` não tem valores;
- a chave privada do JWT é gerada na primeira execução, fora do git (`data/`, ou o
  volume `jwt_chaves` no Docker); não há segredo de JWT em configuração;
- o segredo de cada webhook é gerado por repositório e fica só no banco;
- arquivos com segredo nos repositórios indexados nunca entram no índice.

Lista completa de medidas de segurança em [`docs/arquitetura.md`](docs/arquitetura.md#segurança-em-uma-lista).

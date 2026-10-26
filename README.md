# tatubot

[![CI](https://github.com/romulodm/tatubot/actions/workflows/ci.yml/badge.svg)](https://github.com/romulodm/tatubot/actions/workflows/ci.yml)

Colegas de IA que lêem o seu código. Você conecta repositórios do GitHub, cria bots
(nome, instruções, modo e repositórios que podem ler) e conversa com eles. Toda resposta
cita `arquivo:linhas`, com link para o GitHub fixado no commit indexado.

Dois serviços, um MongoDB:

- **`web/`**: Next.js 16 + TypeScript. Páginas e autenticação (cadastro, login, refresh, JWKS).
- **`api/`**: Node 22 + JavaScript, sem framework HTTP. Repositórios, bots, conversas, fila,
  indexação e RAG. Roda como `api` (HTTP + SSE) e como `worker` (fila).

## Rodar

```bash
cp .env.example .env        # opcional: LLM_API_KEY da OpenAI
docker compose up --build   # http://localhost:3000
```

O primeiro usuário cadastrado vira `admin`. Sem `LLM_API_KEY` o bot roda em modo
extrativo: acha os trechos certos e cita, mas não explica.

Sem Docker (precisa de Node 22, git e um MongoDB em `localhost:27017`):

```bash
cd api && npm install && npm run dev   # :4000, api + worker no mesmo processo
cd web && npm install && npm run dev   # :3000
```

## Como funciona

```
navegador ──► web (Next) ─── /api/* ───► api (Node) ──► MongoDB
   ▲  SSE      │ login, refresh, JWKS        │ publica eventos
   └────────── cookies ◄─────────── worker ◄─ fila (coleção eventos)
                                    indexação e runtime do bot
```

1. `POST /api/repos` grava o repositório e publica `repo.cadastrado`.
2. O worker clona, descarta dependências, binários e arquivos com segredo, quebra JS/TS
   pela AST e gera os embeddings.
3. `POST /api/conversas/:id/mensagens` grava a pergunta, publica `mensagem.recebida` e
   devolve `202`.
4. O worker responde em modo **busca direta** (busca híbrida: vetorial + BM25 + caminho,
   fundidas com RRF) ou **agente** (loop de ferramentas com limite de passos, tokens e tempo).
5. Citação para linha que o bot não leu é removida. O texto chega ao navegador por SSE.

Mais detalhes em [`docs/arquitetura.md`](docs/arquitetura.md) e, sobre o RAG, em
[`docs/rag/`](docs/rag/README.md). Decisões e o porquê delas em [`docs/decisoes.md`](docs/decisoes.md).

## Código

```
api/src/
├── server.js, worker.js   pontos de entrada
├── app.js                 servidor HTTP, checagem de origem, /api/health
├── http.js                roteador, corpo, respostas, SSE, validação, rate limit
├── auth.js                JWKS e verificação do JWT à mão
├── fila.js                fila no Mongo, worker e consumidores
├── llm.js                 cliente OpenAI-compatível e embeddings
├── rotas/                 repos (+ webhook), bots, conversas
├── indexacao/             git, filtros e segredos, chunker, indexar
├── busca/                 consulta (entender a pergunta), buscar
└── agente/                executar, ferramentas, prompts, citacoes

web/src/
├── app/                   landing, login, app (bots, chat, repositórios), rotas de auth
├── components/            avatar, marca, markdown, cliente da api
└── lib/                   db, http, auth (chaves, senha, tokens, cookies), trabalhos
```

## Testes e CI

```bash
npm install && npm run lint && npm run format:check   # na raiz
cd api && npm test                                    # node:test
cd web && npm test && npm run typecheck               # vitest
```

Os testes da api sobem o servidor numa porta aleatória e usam um banco em memória
(`api/test/apoio/banco.js`); o da fila usa o Mongo de `MONGODB_URI` quando ele existe.
O CI (`.github/workflows/ci.yml`) roda lint, testes com um Mongo de verdade, o build do
web e, no fim, sobe o `docker compose` e faz um cadastro e uma chamada autenticada.

Para testar os modos pipeline e agente sem gastar crédito: `cd api && npm run llm-falso`
(ver [`docs/rag/08`](docs/rag/08-ajustando-e-depurando.md#testando-sem-gastar-crédito)).

## Segredos

- a chave da OpenAI só existe no `.env`, que o git ignora;
- a chave privada do JWT é gerada no primeiro boot, fora do git (`data/` ou o volume `jwt_chaves`);
- o segredo do webhook é gerado por repositório e fica só no banco;
- arquivos com segredo nos repositórios indexados nunca entram no índice.

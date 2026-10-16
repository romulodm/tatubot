# RepoBot

Colegas de IA que leram o seu código. Você conecta repositórios do GitHub, cria
bots (nome, instruções, modo e repositórios que podem ler) e conversa com eles.
Toda resposta cita `arquivo:linhas`, com link para o GitHub fixado no commit
indexado, e você acompanha ao vivo o que o bot está lendo.

MVP em **Next.js 16 + MongoDB**, a partir do `docs/context.md`. As diferenças em
relação ao desenho original estão em `docs/decisoes.md`.

## Rodar

Com Docker:

```bash
docker compose up --build            # app em http://localhost:3000
```

Sem Docker (Node 22, git e um MongoDB em localhost:27017):

```bash
cp .env.example .env.local
npm install
npm run dev
```

O primeiro usuário cadastrado vira `admin`.

### Com um LLM

Sem LLM (`LLM_PROVIDER=local`) o bot funciona em modo extrativo: busca e devolve
os trechos certos, com citações, mas sem explicar. Para respostas de verdade,
qualquer API compatível com OpenAI serve:

```bash
# Ollama local
docker compose --profile llm up -d ollama
docker compose exec ollama ollama pull qwen2.5:7b
docker compose exec ollama ollama pull nomic-embed-text
LLM_PROVIDER=openai_compat LLM_EMBED_MODEL=nomic-embed-text \
EMBED_PREFIX_DOC="search_document: " EMBED_PREFIX_QUERY="search_query: " \
docker compose up -d web
```

O modo agente precisa de um modelo com tool calling. Ao trocar o modelo de
embedding, sincronize os repositórios para reindexar.

Para testar pipeline e agente sem modelo nenhum há um LLM falso
determinístico: `node scripts/llm-falso.mjs 11999` e
`LLM_BASE_URL=http://localhost:11999/v1`.

## Como funciona

```
navegador ──► Next.js (rotas /api)  ──► MongoDB
   ▲  SSE          │ publica eventos        ├─ usuarios, refresh_tokens
   │               ▼                        ├─ repositorios, arquivos, chunks
   └──────── worker da fila ◄── eventos ───┤─ bots, conversas, mensagens
             (indexação e runtime do bot)   └─ eventos, eventos_processados, execucoes
```

1. `POST /api/repos` grava o repositório e publica `repo.cadastrado`.
2. O worker clona (`git` via `spawn`, sem shell), filtra dependências, binários
   e arquivos grandes, descarta arquivos com segredo, quebra JS/TS pela AST
   (compilador do TypeScript como parser), Markdown por heading e o resto em
   blocos, e gera embeddings.
3. `POST /api/conversas/:id/mensagens` grava a pergunta, cria a resposta
   `pendente`, publica `mensagem.recebida` e devolve `202`.
4. O worker roda o bot: **busca direta** (reescreve a pergunta em termos de
   código, busca híbrida vetorial + BM25 com RRF e expansão por referências,
   responde) ou **agente** (loop com `buscar_semantico`, `buscar_texto`,
   `ler_arquivo`, `listar_diretorio`, `referencias`, com limite de passos,
   tokens e tempo).
5. Citações para linhas que o bot não viu são removidas. A trilha e o texto
   parcial são gravados na mensagem, e o SSE os envia ao navegador.

## Mapa do código

| Pasta | O que tem |
|---|---|
| `src/lib/auth` | scrypt, JWT, refresh com rotação e detecção de reuso, cookies |
| `src/lib/fila` | publicar, reivindicar, retry/DLQ, idempotência, worker e consumidores |
| `src/lib/indexacao` | git, filtros, segredos, chunker por AST, tokenizador, indexação completa e incremental |
| `src/lib/busca` | busca híbrida, BM25, RRF, expansão por grafo |
| `src/lib/llm` | cliente OpenAI-compatível (streaming e tools) e embeddings |
| `src/lib/agente` | runtime (extrativo, pipeline, agente), ferramentas, prompts, validação de citações |
| `src/app/api` | rotas HTTP (mesmo formato de erro em todas) |
| `src/app/app` | interface: bots, conversas com trilha e fontes, repositórios |

## Testes

```bash
npm test          # vitest; o teste da fila precisa de MongoDB em MONGODB_URI
npm run typecheck
```

## Segurança

- Senhas com scrypt; refresh token só como hash; reuso de token revogado derruba a família.
- Recurso de outro usuário responde 404. Bot só lê repositórios do próprio dono.
- Toda busca e toda ferramenta do agente filtram pelos repositórios do bot.
- URL de repositório validada por regex; `git` sem shell; symlinks não são seguidos; `ler_arquivo` não lê arquivos ignorados.
- Webhook do GitHub validado por HMAC com `timingSafeEqual`; delivery id como eventId (reentrega idempotente).
- Mutação com `Origin` de outro host é recusada; cookies `SameSite=Lax`.
- Rate limit em login, cadastro e envio de mensagem.

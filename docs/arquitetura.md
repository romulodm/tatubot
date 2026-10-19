# Arquitetura

Dois serviços, um banco e uma fila dentro do banco.

```
                         ┌───────────────────────────────┐
  navegador ───────────► │ web  (Next.js, TypeScript)    │
   (cookies httpOnly)    │ páginas, login, cadastro,     │
                         │ refresh, /.well-known/jwks    │
                         └───────┬───────────────┬───────┘
                                 │ /api/*        │ usuarios, refresh_tokens
                                 │ (rewrite)     ▼
                         ┌───────▼───────┐   ┌────────┐
                         │ api  (Node)   │──►│ MongoDB│◄──────────┐
                         │ HTTP + SSE    │   └────────┘           │
                         └───────────────┘    eventos (fila)      │
                                                  │               │
                                          ┌───────▼───────┐       │
                                          │ worker (Node) │───────┘
                                          │ indexação e   │──► OpenAI (opcional)
                                          │ runtime do bot│──► GitHub (git clone)
                                          └───────────────┘
```

| Serviço | Pasta | Responsável por | Coleções |
|---|---|---|---|
| **web** | `web/` | Páginas (landing, app, chat), cadastro, login, refresh, logout, JWKS | `usuarios`, `refresh_tokens` |
| **api** | `api/src/server.js` | Repositórios, bots, conversas, mensagens, SSE, webhook, execuções | todas as outras |
| **worker** | `api/src/worker.js` | Indexação, busca e respostas do bot | todas as outras |

`api` e `worker` são o **mesmo código e o mesmo Dockerfile**, com comandos
diferentes. Em desenvolvimento, `WORKER_MODE=inline` roda os dois no mesmo processo.

## Por que dividir assim

O Next ficou com o que ele faz bem: renderizar páginas e cuidar da sessão (cookies,
refresh com rotação). O resto virou um microsserviço em Node puro, sem framework HTTP,
como o `context.md` pede para o "indexador": roteador, parser de body, validação,
logger e verificação de JWT escritos à mão (`api/src/http/`).

Separar o worker da API HTTP evita que uma indexação pesada deixe as requisições lentas
e permite escalar cada um à parte (`docker compose up --scale worker=3`: a fila garante
que cada evento vai para um worker só).

## O caminho de uma requisição

O navegador só conhece o web. O `next.config.ts` repassa `/api/*` (menos `/api/auth/*`)
para a api:

```
GET /api/bots  ──►  web (rewrite)  ──►  api :4000/api/bots
                    cookies vão junto       lê o cookie rb_access e verifica o JWT
```

Consequências:

- **mesma origem**: cookies `httpOnly` e `SameSite=Lax` funcionam sem CORS;
- o **SSE** do chat passa pelo mesmo caminho (por isso `compress: false` no Next e
  `cache-control: no-transform` na api: compressão seguraria os eventos num buffer);
- os rewrites são gravados **no build** (`output: "standalone"`), por isso o
  `API_URL` é um build arg no `web/Dockerfile`.

## Autenticação entre os serviços

```
1. login          navegador ──► web: confere a senha (scrypt), assina o access token
                                     com a chave PRIVADA (RS256, kid no cabeçalho)
                                     e grava rb_access + rb_refresh (httpOnly)
2. chamada        navegador ──► web ──► api: cookie rb_access
3. verificação    api: separa o JWT, exige alg RS256, acha a chave pelo kid,
                       crypto.verify, confere exp / iss / aud
4. chave          api ──► web: GET /.well-known/jwks.json (só a parte PÚBLICA)
                       na subida, e de novo quando aparece um kid desconhecido
                       (no máximo 1x por minuto)
5. expirou (401)  navegador ──► web: POST /api/auth/refresh (rotação) e repete
```

Por que RS256 e não um segredo compartilhado (HS256)? Com HS256, o mesmo segredo que
verifica também assina: se a api vazasse o segredo, daria para fabricar um token de
admin. Com RS256 a api só tem a chave pública.

A chave privada é gerada no primeiro boot do web em `data/chaves/` (no Docker, no
volume `jwt_chaves`). Não existe nenhum segredo de JWT em arquivo de configuração.
Para trocar a chave: apague o arquivo e reinicie o web; a api busca a nova pelo `kid`
e todo mundo entra de novo.

Arquivos: `web/src/lib/auth/chaves.ts` (par RSA e JWKS), `web/src/lib/auth/tokens.ts`
(emissão e refresh), `api/src/http/jwks.js` (cache de chaves), `api/src/http/auth.js`
(verificação à mão). Testes dos ataques clássicos (`alg: none`, HS256 com a chave
pública, assinatura adulterada, expirado, `aud` errado, `kid` desconhecido) em
`api/test/jwt.test.js`.

## A fila

Uma coleção `eventos` no próprio Mongo, em vez de RabbitMQ (ver `decisoes.md`):

```
pendente ──reivindicar──► processando ──ok──► feito
   ▲                          │
   └──── erro (5 s, 30 s, 2 min) ◄──┤
                              └── erro permanente / tentativas esgotadas ──► dlq
```

- **reivindicar** é um `findOneAndUpdate` atômico: dois workers nunca pegam o mesmo
  evento. O evento fica "travado" por um tempo; se o worker morrer, a trava vence e
  outro retoma.
- **idempotência**: `(eventId, consumidor)` é único em `eventos_processados`; um evento
  entregue de novo não roda duas vezes.
- **outbox de graça**: o evento é gravado no mesmo banco que o efeito (a mensagem
  pendente, o repositório novo), então não existe "gravou no banco mas o broker caiu".

| Consumidor | Eventos | Concorrência |
|---|---|---|
| `indexador.repos` | `repo.cadastrado`, `repo.sincronizar`, `repo.atualizado_config`, `repo.removido` | 1 |
| `indexador.mensagens` | `mensagem.recebida` | 4 |

`GET /api/health` mostra quantos eventos estão na fila e na DLQ.

## Rotas

| Serviço | Rota | |
|---|---|---|
| web | `POST /api/auth/registrar`, `login`, `refresh`, `logout`; `GET /api/auth/me` | sessão |
| web | `GET /.well-known/jwks.json` | chave pública |
| api | `GET/POST /api/repos`, `GET/PATCH/DELETE /api/repos/:id` | repositórios |
| api | `POST /api/repos/:id/sincronizar`, `GET .../arquivos`, `POST .../busca` | indexação e depuração |
| api | `GET/POST /api/bots`, `GET/PATCH/DELETE /api/bots/:id`, `PUT .../repos`, `POST .../conversas` | bots |
| api | `GET /api/conversas`, `GET/DELETE /api/conversas/:id` | conversas |
| api | `GET/POST /api/conversas/:id/mensagens`, `GET .../eventos` (SSE) | chat |
| api | `GET /api/execucoes/:id` | "ver o raciocínio" |
| api | `POST /api/webhooks/github/:repoId` | webhook (HMAC) |
| api | `GET /api/health` | saúde |

Todas as rotas da api respondem erros no mesmo formato:

```json
{ "erro": { "codigo": "BOT_NAO_ENCONTRADO", "mensagem": "Bot não encontrado", "detalhes": {} } }
```

## Segurança, em uma lista

- Senhas com scrypt; refresh token opaco, guardado só como hash, com rotação e detecção
  de reuso (reuso revoga a família inteira).
- Access token RS256 verificado com lista fechada de algoritmos; nunca na URL.
- Recurso de outro usuário responde 404 (a autorização está no filtro da consulta).
- Bot só lê repositórios do próprio dono; toda busca e toda ferramenta do agente ficam
  dentro dessa lista.
- URL de repositório validada por regex e remontada; `git` sem shell; symlinks não
  seguidos; caminhos fora do clone recusados.
- Arquivos com segredo nunca entram no índice.
- Webhook com HMAC e `timingSafeEqual`; delivery id como eventId.
- Mutação com `Origin` de outro site é recusada (além do `SameSite=Lax`).
- Rate limit em login, cadastro, envio de mensagem e sincronização.
- Mongo e api expostos só em `127.0.0.1` no docker compose.

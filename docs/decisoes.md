# Registro de decisões

Formato: data, decisão, motivo. As linhas de 2026-10-16 são do MVP em um app Next.js
só; as de 2026-10-19 são da separação em dois serviços (ver `arquitetura.md`).
Quando uma decisão nova substitui uma antiga, as duas ficam aqui,
para dar para seguir o raciocínio.

| Data | Decisão | Motivo |
|---|---|---|
| 2026-10-16 | MVP em um app Next.js 16 (App Router, TypeScript strict) em vez de `api` Fastify + `indexador` Node puro | Pedido explícito do time para validar o produto rápido. As fronteiras foram mantidas como módulos (`lib/auth`, `lib/indexacao`, `lib/busca`, `lib/agente`, `lib/fila`) para facilitar a separação depois. |
| 2026-10-16 | MongoDB no lugar de PostgreSQL + pgvector | Pedido explícito. Coleções espelham as tabelas do `context.md`; índices únicos substituem as constraints. Ids são UUID em string, não ObjectId. |
| 2026-10-16 | Fila na coleção `eventos` do próprio Mongo, sem RabbitMQ | Um serviço a menos para subir. Mantém envelope, backoff 5 s / 30 s / 2 min, DLQ (`status: "dlq"`) e idempotência por `(eventId, consumidor)`. Por estar no mesmo banco do efeito, funciona como outbox e elimina o dual-write. Reivindicação com `findOneAndUpdate` (atômico por documento). |
| 2026-10-16 | Worker inline (`instrumentation.ts`) por padrão; `npm run worker` para processo separado | Um comando para rodar tudo; o worker separado é o caminho para virar microsserviço. |
| 2026-10-16 | JWT HS256 com `jose`, em cookie httpOnly | Só um processo verifica o token. RS256 + JWKS volta quando houver um segundo serviço. Cookie resolve o SSE autenticado sem JWT na URL. Refresh opaco com rotação e detecção de reuso por família, como no `context.md`. |
| 2026-10-16 | Busca vetorial e BM25 em memória, sobre os chunks carregados do Mongo, com fusão RRF | Não depende de Atlas Vector Search e deixa cada etapa visível na rota de depuração. Cache por repositório invalidado por `versaoIndice`. Para repositórios grandes, trocar por `$vectorSearch`. |
| 2026-10-16 | Embedding local por feature hashing (512 dim) quando `LLM_EMBED_MODEL` está vazio | O MVP roda sem modelo nenhum. Serve como baseline para a avaliação da fase 6 contra um modelo real. |
| 2026-10-16 | Modo extrativo quando `LLM_PROVIDER=local` | Sem LLM, o bot devolve os trechos mais relevantes com citações válidas em vez de falhar. |
| 2026-10-16 | Um cliente só, compatível com OpenAI (`/v1/chat/completions`, `/v1/embeddings`) | Ollama, OpenAI, Groq, xAI e vLLM falam o mesmo formato; trocar de provedor é trocar `LLM_BASE_URL`. |
| 2026-10-16 | Reaproveitamento de embedding pelo hash do texto embedado, não por símbolo | Mover uma função de linha não muda o texto (cabeçalho + conteúdo), então não gera embedding novo. Robusto mesmo quando o agrupamento de funções pequenas muda. |
| 2026-10-16 | Branch vazia = branch padrão do repositório, descoberta no clone | Evita erro em repositórios com `master` ou `trunk`. |
| 2026-10-16 | `git ls-files` para listar arquivos | Respeita o `.gitignore` sem reimplementar o parser. |
| 2026-10-16 | Polling curto do Mongo no SSE em vez de change streams | Change streams exigem replica set; o MVP roda com um `mongod` simples. |
| 2026-10-16 | Projeção do indexador = a própria coleção `repositorios` | Num processo só não há o que projetar. O tombstone vira "documento não existe": eventos de repo removido são descartados. |
| 2026-10-16 | Roteador de intenção antes da busca (`conversa`, `localizar`, `explicar`) | "Oi, como vai?" disparava busca e devolvia trechos aleatórios. Conversa agora é respondida sem busca (modelo de resposta sem LLM; LLM sem contexto de código quando há LLM). |
| 2026-10-16 | Pergunta vira conceitos com glossário PT→EN; relevância por cobertura ponderada | A busca casava "autenticação" com a política de privacidade em português. Agora cada palavra de assunto vira um conceito com sinônimos do código (auth, login, session...), pesado pela raridade; só ficam trechos que cobrem tanto quanto o melhor e com nota acima de 35% da maior. |
| 2026-10-16 | Terceiro ranking no RRF: conceitos no caminho do arquivo | O nome da pasta e do arquivo é a melhor pista para "onde fica". Segmentos dinâmicos (`[locale]`) são ignorados. |
| 2026-10-16 | Prior por tipo de arquivo (traduções, testes, migrações, docs) | Raramente são a resposta, a menos que a pergunta fale deles. |
| 2026-10-16 | Resposta extrativa agrupada por arquivo, separando "é do assunto" de "também usa" | Para "onde fica", o que importa é o arquivo; quem só importa o componente vai numa linha à parte. |
| 2026-10-19 | Backend sai do Next para o microsserviço `api/` em Node 22 + JavaScript (ESM), sem framework HTTP | Volta ao desenho de dois serviços do `context.md`. O Next fica com páginas e autenticação; repositórios, bots, conversas, fila, indexação e RAG vão para a api. Roteador, parser de body, validação, logger e verificação de JWT escritos à mão, como pede o `indexador`. |
| 2026-10-19 | `api` e `worker` = mesmo Dockerfile, dois comandos (`server.js` e `worker.js`) | Uma indexação pesada não deixa a API lenta e cada um escala à parte. `WORKER_MODE=inline` junta os dois no dev. Substitui o worker inline no `instrumentation.ts` do Next. |
| 2026-10-19 | JWT passa de HS256 para RS256 com JWKS em `/.well-known/jwks.json` | Agora há um segundo serviço verificando o token (a condição registrada em 2026-10-16). A api só tem a chave pública e não consegue fabricar token. Verificação à mão com `crypto.verify`; recarga do JWKS por `kid` desconhecido, no máximo 1x/min. |
| 2026-10-19 | Chave privada gerada no primeiro boot do web, em `data/chaves/` (volume no Docker) | Nenhum segredo de JWT em `.env` ou no compose: o repositório é público. `JWT_SECRET` deixa de existir. |
| 2026-10-19 | Navegador fala só com o web; `/api/*` (menos `/api/auth/*`) vai para a api por rewrite do Next | Mesma origem: cookies httpOnly e SSE funcionam sem CORS. `compress: false` no Next para o SSE não ficar preso em buffer. O rewrite é gravado no build (`API_URL` é build arg). |
| 2026-10-19 | Web dono de `usuarios` e `refresh_tokens`; api dona do resto. Mesmo banco, coleções separadas | A api não lê usuários: tudo que precisa vem nas claims do JWT. Banco único mantém o compose simples e os dados do MVP. |
| 2026-10-19 | Checagem de `Origin` na api aceita `WEB_ORIGIN` ou o `x-forwarded-host` do rewrite | Atrás do rewrite o `Host` que chega na api é `api:4000`, não o do navegador. |
| 2026-10-19 | OpenAI como provedor padrão quando há `LLM_API_KEY`: `gpt-4.1-mini` e `text-embedding-3-small` | Provedor escolhido pelo time. Sem chave, continua o modo local. O cliente manda `max_completion_tokens` para a OpenAI e `max_tokens` para os compatíveis; modelos de raciocínio (`o*`, `gpt-5*`) recebem margem extra de tokens e não recebem `temperature`. |
| 2026-10-19 | `LLM_EMBED_MODEL=local` força o embedding local mesmo com LLM | Provedores sem `/embeddings` (ou o LLM falso dos testes). |
| 2026-10-19 | Testes da api com `node:test`; da web com `vitest` | `node:test` é o que o `context.md` pede para o serviço em Node puro. O teste da fila roda se houver Mongo em `MONGODB_URI` e é pulado se não houver. |
| 2026-10-19 | `seedicon` também como dependência da api | Validar `avatarEstilo` contra `SEEDICON_STYLES`: estilo novo na lib passa a ser aceito sem mexer na api. Lib pequena e sem dependências. |
| 2026-10-19 | Landing no visual do seedicon.romulodm.dev (coluna de 960px, `#0a0a0a`, acento `#7c7cff`); app logado mantém o visual atual | Pedido explícito. Os tokens ficam no escopo da landing (`.pagina`), sem mexer no app. |
| 2026-10-19 | Embeddings remotos em lotes de até 128 textos / ~80 mil tokens, 4 em paralelo, texto cortado em 16 mil caracteres, retry de 429/5xx na hora e checkpoint em `embeddings_checkpoint` | A primeira indexação de um repo com ~3 mil chunks ficava lenta e voltava do zero: lotes de 32 em série, um 429 (limite de tokens por minuto) ou um texto acima de 8191 tokens derrubava o evento inteiro, e a fila recomeçava tudo. |

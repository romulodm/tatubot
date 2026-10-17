# Registro de decisões

Formato: data, decisão, motivo. Decisões do MVP em Next.js + MongoDB, que diverge
de propósito do desenho de dois serviços do `context.md`.

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

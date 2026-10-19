# RAG no tatubot

Como o bot encontra o pedaço certo do seu código antes de responder, e por que ele
não consegue citar uma linha que não leu.

Os textos vão do simples ao detalhado. Dá para parar em qualquer ponto: o 01 sozinho
já explica a ideia; do 02 em diante cada capítulo abre uma etapa e aponta os arquivos
onde ela mora.

| # | Capítulo | O que você sai sabendo |
|---|---|---|
| 01 | [O que é RAG](01-o-que-e-rag.md) | A ideia em cinco minutos e onde cada peça mora no projeto |
| 02 | [Indexação](02-indexacao.md) | Do `git clone` até o índice no Mongo: filtros, segredos, progresso |
| 03 | [Chunking](03-chunking.md) | Por que cortar código pela AST e não a cada N linhas |
| 04 | [Embeddings](04-embeddings.md) | O que é um vetor de texto, o modelo da OpenAI e o embedding local |
| 05 | [Busca híbrida](05-busca-hibrida.md) | Vetorial + BM25 + caminho, fusão RRF, cobertura e grafo |
| 06 | [Resposta e citações](06-resposta-e-citacoes.md) | Pipeline, agente, extrativo e a validação que remove citação inventada |
| 07 | [Reindexação incremental](07-reindexacao-incremental.md) | Push, webhook, `git diff` e reaproveitamento de embedding |
| 08 | [Ajustando e depurando](08-ajustando-e-depurando.md) | Os botões que mudam a qualidade, a rota de depuração e como medir |

A visão geral dos serviços (web, api, worker, fila) está em
[`docs/arquitetura.md`](../arquitetura.md).

## Mapa rápido do código

Tudo de RAG está no microsserviço `api/`:

```
api/src/
├── indexacao/   git.js, filtros.js, segredos.js, chunker.js, tokenizar.js, indexar.js
├── llm/         embeddings.js (vetores), chat.js (cliente OpenAI-compatível)
├── busca/       consulta.js (entender a pergunta), buscar.js (busca híbrida)
├── agente/      executar.js (runtime), ferramentas.js, prompts.js, citacoes.js, extrativo.js
└── fila/        fila.js, worker.js, consumidores.js (quem dispara cada etapa)
```

# 01 · O que é RAG

**RAG** (*retrieval-augmented generation*, geração aumentada por busca) é um jeito de
fazer um modelo de linguagem responder sobre algo que ele nunca viu no treino: o seu
código.

A ideia cabe numa frase: **antes de perguntar ao modelo, a gente busca os trechos que
importam e coloca no prompt.** O modelo não "sabe" o seu repositório; ele lê, na hora,
os pedaços que a busca entregou.

```
pergunta ──► busca no índice ──► trechos relevantes ──► prompt ──► LLM ──► resposta
                 ▲
                 └── índice montado antes, a partir do repositório
```

## Por que não mandar o repositório inteiro?

Porque não cabe, custa caro e piora a resposta.

- Um repositório médio tem centenas de milhares de tokens. O contexto do modelo tem limite.
- Você paga por token de entrada. Mandar tudo a cada pergunta multiplica o custo.
- Com muito texto irrelevante, o modelo se distrai e erra mais.

Buscar primeiro resolve os três: o prompt leva só alguns trechos, e trechos certos.

## As duas metades

O RAG tem uma parte que roda **uma vez por commit** e outra que roda **a cada pergunta**.

**Indexação** (offline, no worker) — prepara o repositório para ser buscado:

1. clona o repositório;
2. joga fora o que não interessa (dependências, binários, arquivos com segredo);
3. quebra cada arquivo em pedaços que façam sentido sozinhos (*chunks*);
4. transforma cada pedaço num vetor de números (*embedding*) e guarda tudo no Mongo.

**Consulta** (online, a cada mensagem) — usa o índice para responder:

1. entende a pergunta (que palavras são assunto, em que língua o código está);
2. busca os chunks mais relevantes;
3. monta o prompt com esses trechos e pede a resposta ao modelo;
4. confere as citações da resposta contra o que foi realmente lido.

## O que o tatubot faz de diferente

Duas coisas, e as duas vêm do fato de a fonte ser **código**:

- **Cita ou fica quieto.** Toda afirmação precisa apontar `arquivo:linhas`. Depois que o
  modelo responde, o código confere cada citação e **remove** as que apontam para linhas
  que o bot não leu nesta conversa. Ver [06](06-resposta-e-citacoes.md).
- **Busca pensada para código.** Perguntas vêm em português ("onde fica a autenticação?")
  e o código está em inglês (`authMiddleware`). Por isso a busca combina três sinais
  (significado, termo exato e nome do arquivo) e traduz conceitos. Ver [05](05-busca-hibrida.md).

## Onde cada etapa mora

| Etapa | Arquivo | Capítulo |
|---|---|---|
| Disparar indexação | `api/src/fila/consumidores.js` | [02](02-indexacao.md) |
| Clonar, filtrar, varrer segredos | `api/src/indexacao/indexar.js`, `git.js`, `filtros.js`, `segredos.js` | [02](02-indexacao.md) |
| Quebrar em chunks | `api/src/indexacao/chunker.js` | [03](03-chunking.md) |
| Gerar embeddings | `api/src/llm/embeddings.js` | [04](04-embeddings.md) |
| Entender a pergunta | `api/src/busca/consulta.js` | [05](05-busca-hibrida.md) |
| Buscar | `api/src/busca/buscar.js` | [05](05-busca-hibrida.md) |
| Responder | `api/src/agente/executar.js` | [06](06-resposta-e-citacoes.md) |
| Validar citações | `api/src/agente/citacoes.js` | [06](06-resposta-e-citacoes.md) |

## Funciona sem LLM?

Funciona, com menos. Sem `LLM_API_KEY` o projeto roda em **modo local**:

- os embeddings são calculados localmente, por *hashing* de termos (sem rede);
- o bot responde em **modo extrativo**: devolve os trechos encontrados, agrupados por
  arquivo e com citação, mas não explica o que o código faz.

Com a chave da OpenAI, o embedding passa a ser `text-embedding-3-small` (entende
sinônimos) e o chat passa a ser `gpt-4.1-mini` (explica). Os dois podem ser trocados
no `.env`.

Próximo: [02 · Indexação](02-indexacao.md)

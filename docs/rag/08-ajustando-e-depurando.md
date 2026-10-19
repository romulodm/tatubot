# 08 · Ajustando e depurando

Quando o bot responde mal, quase sempre a busca trouxe os trechos errados. Este
capítulo é sobre achar onde, e quais botões existem.

## Primeiro: a resposta veio de onde?

1. **"Ver o raciocínio"** no chat (`GET /api/execucoes/:id`): passos, ferramentas
   chamadas, tokens, tempo e as citações removidas. Muitas citações removidas = o modelo
   está inventando, ou a busca trouxe pouca coisa e ele "completou".
2. **"Testar a busca"** na tela do repositório (`POST /api/repos/:id/busca`): faça a
   mesma pergunta e veja o ranking com `vetorial`, `textual`, `caminho`, posições, `rrf`,
   `cobertura` e `final` de cada trecho.
3. **Arquivos ignorados** na mesma tela: o arquivo que deveria responder pode ter sido
   filtrado (grande demais, segredo detectado, pasta ignorada).

## Lendo o ranking

| Sintoma | Provável causa | O que tentar |
|---|---|---|
| O arquivo certo não aparece em nenhum ranking | Ignorado na indexação, ou nome/conteúdo sem nada da pergunta | Ver arquivos ignorados; perguntar com o nome de uma função ou pasta |
| Aparece no vetorial mas é cortado | Cobertura baixa: a pergunta tem um conceito que o trecho não contém | Ver `faltando`; tirar palavras que não estão no código |
| Só documentação e testes no topo | Pesos por tipo de arquivo, ou o código usa outro vocabulário | Acrescentar o termo ao `GLOSSARIO` em `consulta.js` |
| Vetorial vazio com aviso | Repositório indexado com outro modelo de embedding | Sincronizar o repositório |
| Bons trechos, resposta ruim | Modelo, prompt ou modo | Testar o modo agente; ajustar as instruções do bot |

## Os botões

### Configuração (`.env`)

| Variável | Efeito |
|---|---|
| `LLM_API_KEY` | Liga o LLM. Sem ela, modo local/extrativo |
| `LLM_CHAT_MODEL` | Modelo de chat. `gpt-4.1-mini` é o padrão; modelos de raciocínio (`o*`, `gpt-5*`) funcionam, com mais latência |
| `LLM_EMBED_MODEL` | Modelo de embedding. Trocar exige sincronizar os repositórios |
| `LLM_BASE_URL` | Outro provedor compatível com a OpenAI (Ollama, Groq, vLLM) |

### No código

| Onde | O quê | Padrão |
|---|---|---|
| `indexacao/chunker.js` | `MAX_LINHAS`, `OVERLAP`, `MIN_LINHAS`, `BLOCO_TEXTO` | 120, 15, 5, 60 |
| `busca/buscar.js` | `K_RRF`, `TOP` (candidatos por ranking) | 60, 40 |
| `busca/buscar.js` | corte de cobertura e corte relativo | 60% e 35% do melhor |
| `busca/buscar.js` | pesos por tipo de arquivo | 0,35 / 0,5 / 0,7 |
| `busca/consulta.js` | `GLOSSARIO` PT → EN | ~100 conceitos |
| `agente/executar.js` | quantos trechos por modo | extrativo 10–16, pipeline 8 + grafo |
| `config.js` | limites do agente | 12 passos, 60 mil tokens, 2 min |

Mexa em um de cada vez e compare com a rota de busca, com as mesmas perguntas.

## Medindo em vez de achar

A fase 6 do `context.md` propõe um conjunto de avaliação: 20 a 30 perguntas com os
arquivos esperados, e duas métricas:

- **recall@5** da busca: em quantas perguntas pelo menos um arquivo esperado aparece
  entre os 5 primeiros;
- **acerto de citação** da resposta: quantas citações apontam para os arquivos esperados.

Rodando as mesmas perguntas com e sem cada peça (embedding local vs. OpenAI, com e sem
BM25, pipeline vs. agente) dá para saber o que cada uma contribui, em vez de ajustar no
olho. A rota `/api/repos/:id/busca` já devolve tudo que o script de avaliação precisa.

## Testando sem gastar crédito

Há um LLM falso, determinístico, compatível com a API da OpenAI:

```bash
cd api
npm run llm-falso                       # sobe em http://localhost:11999/v1
LLM_API_KEY=qualquer LLM_BASE_URL=http://localhost:11999/v1 LLM_EMBED_MODEL=local npm run dev
```

Ele pede `buscar_semantico`, depois `ler_arquivo`, e responde com uma citação válida e
uma inventada, que precisa ser removida. Serve para testar o loop do agente, o
streaming e a validação de citações.

Anterior: [07 · Reindexação incremental](07-reindexacao-incremental.md) · Voltar ao [índice](README.md)

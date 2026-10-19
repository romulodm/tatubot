# 05 · Busca híbrida

A busca recebe uma pergunta e uma lista de repositórios **já autorizados** e devolve os
melhores trechos. Mora em `api/src/busca/`:

- `consulta.js` — entende a pergunta;
- `buscar.js` — busca, funde e filtra.

```
pergunta ─► conceitos (com sinônimos PT→EN) ─┬─► vetorial (cosseno)
                                              ├─► textual (BM25)
                                              └─► caminho (conceitos no path)
                      fusão RRF ─► × cobertura² ─► × peso do tipo de arquivo ─► filtro ─► grafo
```

## Antes de buscar: entender a pergunta

`analisarConsulta()` faz três coisas.

**1. Separa assunto de forma.** Em "onde ficam os arquivos do modal de autenticação?",
só `modal` e `autenticação` dizem *o que* procurar. "onde", "ficam", "arquivos" dizem
*como* perguntar e são descartados (`PALAVRAS_DE_PERGUNTA`).

**2. Transforma cada palavra de assunto em um conceito.** Um conceito é a palavra mais
os termos que contam como presença dela no código:

- a **raiz** da palavra (`raiz()`, um *stemmer* mínimo: "autenticação" e "autenticar"
  viram `autentic`; "modais" vira `modal`);
- as partes de identificadores (`verifyToken` → `verify`, `token`);
- as **traduções** do glossário (`GLOSSARIO`): `autentic` → `auth`, `login`, `signin`,
  `session`...

O glossário existe porque a pergunta costuma vir em português e o código em inglês. É
determinístico e didático, não mágico: cobre o vocabulário comum de aplicações web.

**3. Detecta a intenção.**

| Intenção | Exemplo | Efeito |
|---|---|---|
| `conversa` | "oi, tudo bem?", "valeu" | não busca nada (ver [06](06-resposta-e-citacoes.md)) |
| `localizar` | "onde fica...", "qual arquivo..." | resposta em lista de arquivos |
| `explicar` | "como funciona...", o resto | resposta explicando, com citações |

## Os três rankings

Cada um vê a pergunta de um jeito e erra de um jeito diferente; por isso usamos os três.

### 1. Vetorial

Cosseno entre o vetor da pergunta e o de cada chunk ([04](04-embeddings.md)). Bom em
**significado** ("onde o usuário entra" ≈ `handleSignIn`). Ruim em identificador exato:
para o embedding, `rotacionarRefresh` e `revogarRefresh` são quase a mesma coisa.

### 2. Textual (BM25)

O clássico da busca textual, sobre as raízes dos termos. Para cada termo da pergunta:

```
score += idf(termo) × tf saturado ÷ correção pelo tamanho do trecho
```

- **idf**: termo raro vale mais (`rotacionarRefresh` aparece em 2 trechos; `const` em todos);
- **tf saturado**: repetir o termo ajuda, mas cada repetição ajuda menos;
- **tamanho**: um trecho enorme não ganha só por ter mais palavras.

Bom em **nomes exatos**, que é o que o embedding erra.

### 3. Caminho

Quantos conceitos aparecem no caminho do arquivo e no nome dele. Em código, a pasta e
o nome costumam ser a melhor pista: `components/auth/AuthModal.tsx` responde "onde fica
o modal de autenticação?" melhor do que qualquer trecho de dentro dele. Segmentos de rota
dinâmica (`app/[locale]/...`) são ignorados: são parâmetro, não assunto.

## Fusão: RRF

Como juntar três listas com escalas diferentes (cosseno de 0 a 1, BM25 de 0 a "quanto
for")? O **Reciprocal Rank Fusion** ignora o valor e usa só a **posição**:

```
rrf(trecho) = Σ  1 / (60 + posição na lista)
```

Quem aparece bem colocado em mais de uma lista sobe. O 60 é a constante do artigo
original; ela suaviza a diferença entre o 1º e o 5º lugar.

## Cobertura: o que é relevante

O RRF ordena, mas não decide o que é relevante. Um trecho que fala muito de
"autenticação" e nada de "modal" pode ficar bem colocado e não responde "onde fica o
**modal** de autenticação?".

A **cobertura** é a fração dos conceitos da pergunta que o trecho contém, ponderada pela
raridade de cada conceito (como o idf): em "componente de troca de idioma",
"componente" aparece em quase tudo e pesa pouco; "idioma" pesa muito.

```
final = rrf × (0,15 + cobertura²) × peso do tipo de arquivo
```

E dois cortes:

- só ficam trechos com cobertura ≥ 60% da melhor cobertura encontrada;
- só ficam trechos com `final` ≥ 35% do melhor resultado.

Se nenhum trecho cobre nenhum conceito: com embedding de verdade, vale a similaridade
semântica sozinha (cosseno ≥ 85% do melhor); com embedding local, não há resultado
confiável e a lista volta vazia.

Os conceitos que nenhum trecho do topo cobriu voltam em `faltando` ("não encontrei nada
sobre **X**").

### Peso do tipo de arquivo

Alguns arquivos raramente são a resposta, a menos que a pergunta fale deles:

| Tipo | Peso | Deixa de ser penalizado quando a pergunta fala de |
|---|---|---|
| traduções, JSON, YAML | 0,35 | i18n, tradução, config |
| testes | 0,5 | teste, spec |
| migrações | 0,5 | migração |
| seções de documentação | 0,7 | doc, readme, instalação |

## 4. Expansão por grafo

No modo pipeline (`grafo: true`), depois do corte, a busca olha os 5 melhores trechos
de código e acrescenta até 5 vizinhos pelo campo `referencias`
([03](03-chunking.md#as-referências)): funções que eles chamam e funções que os chamam.
Esses entram marcados com `viaGrafo: true`.

É o que faz "como funciona o login?" trazer também `verificarSenha()` e `emitirToken()`,
que o handler de login chama mas que não têm "login" no texto.

## O índice em memória

Os chunks ficam no Mongo, mas a busca roda **em memória**: na primeira busca num
repositório, os chunks são carregados e os dados derivados (raízes, frequências, df)
são calculados uma vez (`indiceDe()`). O cache é por repositório e é invalidado
sozinho: cada indexação incrementa `versaoIndice`, conferido a cada busca.

Para os tamanhos deste projeto (até 4000 arquivos por repo) isso é rápido e deixa cada
etapa visível. Para repositórios muito maiores, o passo natural é trocar o vetorial por
um índice dedicado (`$vectorSearch` do Atlas, pgvector...).

## Autorização mora aqui também

`buscar()` recebe `repoIds` e **nunca sai dessa lista**. Quem chama é responsável por
passar só os repositórios do bot (o runtime confere o dono de novo antes de buscar).
Não existe busca "global".

## Vendo por dentro

A rota de depuração devolve o ranking com o score de cada etapa:

```bash
curl -X POST http://localhost:3000/api/repos/<id>/busca \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"consulta":"onde fica a autenticação?"}'
```

Cada resultado traz `scores.vetorial`, `textual`, `caminho`, as posições em cada lista,
`rrf`, `cobertura` e `final`. A tela do repositório tem um campo de busca que usa essa
rota. Mais em [08](08-ajustando-e-depurando.md).

Anterior: [04 · Embeddings](04-embeddings.md) · Próximo: [06 · Resposta e citações](06-resposta-e-citacoes.md)

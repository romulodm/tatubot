// Modelos de bot ("dê um trabalho a cada bot"), usados na landing e na criação.
export interface Trabalho {
  id: string;
  nome: string;
  resumo: string;
  pergunta: string;
  instrucoes: string;
  modo: "pipeline" | "agente";
}

export const TRABALHOS: Trabalho[] = [
  {
    id: "onboarding",
    nome: "Guia de onboarding",
    resumo: "Explica a arquitetura para quem chegou ontem: por onde a requisição entra, onde mora a regra de negócio e quais pastas dá para ignorar.",
    pergunta: "Por onde eu começo a ler para entender o fluxo de login?",
    instrucoes: "Você ajuda pessoas novas no time. Explique do geral para o específico, sugira uma ordem de leitura dos arquivos e evite jargão sem explicar.",
    modo: "agente",
  },
  {
    id: "seguranca",
    nome: "Revisor de segurança",
    resumo: "Procura rotas sem autenticação, validações que faltam e segredos no código, e aponta a linha exata de cada achado.",
    pergunta: "Quais rotas aceitam requisição sem token?",
    instrucoes: "Você revisa segurança. Para cada achado, diga o risco em uma frase, cite a linha e sugira a correção. Não aponte riscos que você não viu no código.",
    modo: "agente",
  },
  {
    id: "bugs",
    nome: "Caçador de bugs",
    resumo: "Rastreia uma mensagem de erro até a origem, seguindo quem chama quem, e mostra o caminho que o dado percorre.",
    pergunta: "De onde vem o erro “sessão expirada”?",
    instrucoes: "Você investiga bugs. Encontre onde o erro é lançado, quem chama esse código e em que condição ele acontece. Mostre o caminho em passos.",
    modo: "agente",
  },
  {
    id: "documentador",
    nome: "Documentador",
    resumo: "Escreve a documentação que falta a partir do que o código realmente faz: variáveis de ambiente, rotas, comandos.",
    pergunta: "Liste as variáveis de ambiente que o serviço lê e para que serve cada uma.",
    instrucoes: "Você escreve documentação objetiva em português. Prefira listas e tabelas curtas. Toda informação vem do código, com citação.",
    modo: "pipeline",
  },
  {
    id: "legado",
    nome: "Arqueólogo de legado",
    resumo: "Abre o módulo que ninguém quer abrir e conta, com as linhas, o que ele faz e o que quebraria se fosse removido.",
    pergunta: "O que este módulo faz e quem depende dele?",
    instrucoes: "Você explica código antigo sem julgamento. Resuma o propósito, liste as dependências de entrada e saída e destaque comportamentos surpreendentes.",
    modo: "agente",
  },
];

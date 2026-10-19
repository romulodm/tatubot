// Respostas para mensagens que não pedem nada do código ("oi", "valeu", "o que você faz?").
// Sem LLM, usamos modelos de resposta; com LLM, o modelo responde livremente,
// mas sem busca e sem inventar nada sobre o código.

/**
 * @param {{ nome: string, instrucoes: string }} bot
 * @param {string[]} repos
 */
export function promptConversa(bot, repos) {
  return [
    `Você é ${bot.nome}, um assistente que conhece o código dos repositórios: ${repos.join(", ") || "nenhum ainda"}.`,
    bot.instrucoes ? `Instruções do seu dono:\n${bot.instrucoes.slice(0, 2000)}` : "",
    "A mensagem atual é conversa (cumprimento, agradecimento, pergunta sobre você), não uma pergunta sobre o código.",
    "Responda em português, de forma breve e natural, como um colega de equipe. Se fizer sentido, sugira um tipo de pergunta sobre o código que você pode responder.",
    "Não afirme nada específico sobre o código: você não leu nenhum arquivo nesta resposta.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {string} texto
 * @param {{ nome: string }} bot
 * @param {string[]} repos
 * @param {boolean} temLlm
 */
export function respostaConversaLocal(texto, bot, repos, temLlm) {
  const t = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const onde = repos.length ? repos.map((r) => `\`${r}\``).join(", ") : "nenhum repositório ainda";
  const exemplos = 'Por exemplo: "onde fica a autenticação?" ou "como funciona o envio de e-mail?".';

  if (/\b(obrigad|valeu|vlw|brigad|thank|agradec)/.test(t)) return "De nada! Quando quiser, é só mandar a próxima pergunta sobre o código.";
  if (/\b(tchau|ate mais|ate logo|falou|bye)\b/.test(t)) return "Até mais!";
  if (/\b(quem e voce|o que voce|como voce funciona|ajuda|help)\b/.test(t)) {
    return [
      `Sou ${bot.nome}. Leio o código de ${onde} e respondo perguntas sobre ele: onde algo está implementado, quais arquivos fazem parte de uma funcionalidade, quem chama uma função.`,
      "Toda resposta aponta o arquivo e as linhas, com link para o GitHub.",
      temLlm ? exemplos : `${exemplos} Sem um modelo de linguagem configurado, eu localizo o código, mas não explico o que ele faz.`,
    ].join(" ");
  }
  if (/\b(oi+|ola|e ai|eai|opa|hey|hello|hi|salve|fala|bom dia|boa tarde|boa noite|tudo bem|tudo bom|tudo certo|como vai|beleza)\b/.test(t)) {
    const tudoBem = /\b(tudo bem|tudo bom|tudo certo|como vai|beleza)\b/.test(t) ? "Tudo certo por aqui. " : "";
    return `Oi! ${tudoBem}Sou ${bot.nome} e conheço o código de ${onde}. Em que parte do código posso ajudar? ${exemplos}`;
  }
  return `Não entendi o que você quer procurar. Me diga o nome de uma tela, função ou funcionalidade. ${exemplos}`;
}

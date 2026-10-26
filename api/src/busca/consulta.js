const STOP = new Set(
  (
    "a o e de da do das dos que em um uma para com por no na nos nas se como mais ao os as é ou the of and to in is it for on with as be this that are by an at from or not " +
    "const let var function return import export from if else new true false null undefined"
  ).split(" "),
);

export function tokenizar(texto) {
  const saida = [];
  const brutos = texto.match(/[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|[À-ÿ]+/g) ?? [];
  for (const b of brutos) {
    const inteiro = normalizar(b);
    if (inteiro.length < 2 || inteiro.length > 60) continue;
    const partes = b
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_$]+/)
      .map(normalizar)
      .filter((p) => p.length >= 2);
    if (partes.length > 1) {
      saida.push(inteiro);
      for (const p of partes) if (!STOP.has(p)) saida.push(p);
    } else if (!STOP.has(inteiro)) {
      saida.push(inteiro);
    }
  }
  return saida;
}

export function normalizar(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const PALAVRAS_DE_PERGUNTA = new Set(
  (
    "onde fica ficam esta estao localizado localizada localiza cade qual quais que quem como porque por quando " +
    "o a os as de do da dos das no na nos nas em um uma uns umas eu me meu minha meus minhas voce vc " +
    "arquivo arquivos codigo codigos parte partes trecho trechos existe existem tem ha pra para com sobre isso esse essa " +
    "este esta isto aquele aquela implementado implementada implementados implementacao feito feita mostre mostra " +
    "liste lista listar explique explica explicar funciona funcionam faz fazem serve servem acontece pasta pastas " +
    "projeto repo repositorio sistema aqui ai la ele ela eles elas seu sua seus suas dele dela tudo todo toda todos " +
    "e ou mas se nao sim ja so tambem mais menos muito pouco bem ser estar ter vai vou foi sao era " +
    "where is are the a an of in on to how what which does do file files code find show me i my it this that"
  ).split(" "),
);

// A pergunta vem em português e o código está em inglês: cada raiz vira os termos
// que costumam aparecer no código ("autenticação" -> auth, login, session...).
const GLOSSARIO = {
  autentic: ["auth", "login", "signin", "session", "authenticate", "credential"],
  login: ["auth", "login", "signin", "session"],
  logar: ["auth", "login", "signin"],
  logout: ["logout", "signout", "session"],
  sair: ["logout", "signout"],
  cadastr: ["register", "signup", "registration", "create"],
  registr: ["register", "signup", "registration"],
  senh: ["password", "passwd", "credential"],
  usuari: ["user", "account", "profile"],
  conta: ["account", "user", "profile"],
  sess: ["session", "cookie", "token"],
  permiss: ["permission", "role", "authorize", "guard", "acl"],
  autoriz: ["authorize", "authorization", "permission", "role", "guard"],
  modal: ["modal", "dialog", "popup", "overlay"],
  dialog: ["dialog", "modal"],
  janel: ["window", "modal", "dialog"],
  popup: ["popup", "modal", "dialog"],
  tela: ["screen", "page", "view"],
  pagin: ["page", "pagination"],
  botao: ["button", "btn"],
  formulari: ["form"],
  campo: ["field", "input"],
  component: ["component"],
  estil: ["style", "css", "theme"],
  tema: ["theme", "dark", "light"],
  traduc: ["i18n", "translation", "locale", "messages", "intl"],
  idiom: ["language", "locale", "i18n", "lang"],
  rota: ["route", "router", "endpoint", "api"],
  endpoint: ["endpoint", "route", "api"],
  envi: ["send", "dispatch", "deliver"],
  envio: ["send", "dispatch", "deliver"],
  mail: ["email", "mail", "smtp", "ses"],
  notific: ["notification", "notify", "toast", "alert"],
  avis: ["toast", "alert", "notification", "warning"],
  mensag: ["message", "msg"],
  erro: ["error", "exception", "throw", "fail"],
  falh: ["fail", "error", "exception"],
  test: ["test", "spec"],
  banco: ["database", "db", "prisma", "mongo", "sql", "schema"],
  migrac: ["migration", "migrate"],
  fila: ["queue", "job", "worker"],
  tarefa: ["task", "job", "cron"],
  agend: ["schedule", "cron", "job"],
  pagament: ["payment", "billing", "stripe", "checkout"],
  assinatur: ["subscription", "subscribe", "signature"],
  inscr: ["subscribe", "subscription", "signup"],
  busc: ["search", "query", "find"],
  pesquis: ["search", "query"],
  upload: ["upload", "file"],
  imag: ["image", "img", "picture"],
  foto: ["photo", "image", "avatar"],
  configur: ["config", "settings", "env", "options"],
  variavel: ["env", "variable", "config"],
  ambient: ["env", "environment"],
  log: ["log", "logger", "logging"],
  comentari: ["comment"],
  perfil: ["profile", "avatar", "user"],
  publicac: ["post", "publish"],
  public: ["publish", "post", "public"],
  artig: ["article", "post", "blog"],
  recuper: ["recover", "reset", "forgot"],
  esquec: ["forgot", "reset"],
  redefin: ["reset"],
  token: ["token", "jwt"],
  chav: ["key", "secret"],
  segur: ["security", "secure", "csrf", "sanitize"],
  valid: ["validate", "validation", "schema", "zod"],
  esquem: ["schema"],
  cabecalh: ["header"],
  rodap: ["footer"],
  menu: ["menu", "nav", "navbar"],
  naveg: ["nav", "navigation", "navbar", "router"],
  contat: ["contact"],
  suport: ["support", "help"],
  moder: ["moderation", "moderate", "admin"],
  administr: ["admin", "dashboard"],
  painel: ["dashboard", "panel", "admin"],
  grafic: ["chart", "graph"],
  inici: ["home", "index", "landing", "init", "start"],
  limit: ["limit", "rate", "throttle"],
  provedor: ["provider"],
  cliente: ["client"],
  servic: ["service"],
  gancho: ["hook"],
  hook: ["hook", "use"],
  estad: ["state", "store"],
  rastre: ["tracking", "analytics", "track"],
  metric: ["metric", "analytics", "stats"],
  cookie: ["cookie", "consent"],
  privacidad: ["privacy"],
  troc: ["switch", "change", "toggle", "select"],
  troca: ["switch", "change", "toggle", "select"],
  mud: ["change", "switch", "update"],
  muda: ["change", "switch", "update"],
  selec: ["select", "picker", "dropdown"],
  alter: ["change", "update", "edit"],
  edit: ["edit", "update"],
  exclu: ["delete", "remove", "destroy"],
  apag: ["delete", "remove"],
  remov: ["remove", "delete"],
  criar: ["create", "new", "add"],
  lista: ["list", "index"],
  curtid: ["like", "reaction", "vote"],
  vot: ["vote", "upvote", "downvote"],
  doac: ["donation", "donate"],
  backup: ["backup", "dump", "restore"],
};

const CONVERSA = [
  /^(oi+|ola|e ai|eai|opa|hey|hello|hi|salve|fala)\b/i,
  /\b(bom dia|boa tarde|boa noite|tudo bem|tudo certo|tudo bom|como vai|como voce esta|beleza)\b/i,
  /\b(obrigad[oa]|valeu|vlw|brigad[oa]|thanks|thank you|agradeco)\b/i,
  /\b(tchau|ate mais|ate logo|falou|bye)\b/i,
  /\b(quem e voce|o que voce (faz|sabe|consegue)|como voce funciona|me ajuda|ajuda\??$|help)\b/i,
];

const LOCALIZAR = /\b(onde|cad[eê]|em que arquivo|qual arquivo|quais arquivos|que arquivo|localiza|where)\b/i;

// stemmer simples de português, só para juntar plural, gênero e -ção/-mento
export function raiz(palavra) {
  const t = palavra
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // prettier-ignore
  const sufixos = ["amentos", "imentos", "amento", "imento", "acoes", "icoes", "acao", "icao", "coes", "cao", "mente", "idades", "idade", "ados", "adas", "idos", "idas", "ado", "ada", "ido", "ida", "ais", "oes", "ao", "ar", "er", "ir", "es", "s"];
  if (t.length >= 6 && t.endsWith("ais")) return t.slice(0, -3) + "al";
  for (const s of sufixos) {
    if (s !== "ais" && t.length - s.length >= 4 && t.endsWith(s)) return t.slice(0, -s.length);
  }
  return t;
}

// Pergunta -> intenção (conversa, localizar, explicar) e conceitos com sinônimos do código.
export function analisarConsulta(texto, termosExtras = []) {
  const palavras = (texto.match(/[A-Za-zÀ-ÿ_$][A-Za-zÀ-ÿ0-9_$-]*/g) ?? []).map((p) => p.replace(/^e-?mail$/i, "email"));
  const conceitos = [];
  const vistos = new Set();
  for (const p of palavras) {
    const norm = p
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (norm.length < 2 || PALAVRAS_DE_PERGUNTA.has(norm)) continue;
    const r = raiz(norm);
    if (vistos.has(r)) continue;
    vistos.add(r);
    const partes = tokenizar(p).map(raiz);
    const traducoes = Object.entries(GLOSSARIO)
      .filter(([k]) => r === k || (r.length >= 4 && r.startsWith(k) && k.length >= 4))
      .flatMap(([, v]) => v.map(raiz));
    conceitos.push({ palavra: p, termos: [...new Set([r, ...partes, ...traducoes])].filter((x) => x.length >= 2) });
  }

  const extras = termosExtras.flatMap((t) => tokenizar(t)).map(raiz);
  const semAcento = texto
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const conversa = CONVERSA.some((re) => re.test(semAcento)) && conceitos.every((c) => ehPalavraDeConversa(c.palavra));
  const intencao = conversa || conceitos.length === 0 ? "conversa" : LOCALIZAR.test(texto) ? "localizar" : "explicar";
  return {
    original: texto,
    intencao,
    conceitos,
    termosBusca: [...new Set([...conceitos.flatMap((c) => c.termos), ...extras])],
  };
}

const VOCAB_CONVERSA =
  /^(oi+|ola|eai|opa|hey|hello|hi|salve|fala|bom|boa|dia|tarde|noite|tudo|bem|certo|vai|beleza|obrigad[oa]|valeu|vlw|brigad[oa]|thanks|thank|you|agradeco|tchau|ate|logo|falou|bye|quem|sabe|consegue|ajuda|help|funciona|tranquilo|show|legal|top|ok|okay|blz|kkk+|haha+)$/i;

function ehPalavraDeConversa(p) {
  return VOCAB_CONVERSA.test(p.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

export function cobre(conceito, raizes) {
  for (const t of conceito.termos) {
    for (const r of raizes) {
      if (r === t || (t.length >= 4 && r.startsWith(t))) return true;
    }
  }
  return false;
}

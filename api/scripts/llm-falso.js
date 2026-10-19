// LLM falso compatível com a API da OpenAI, para testar os modos pipeline e
// agente sem gastar crédito nem baixar modelo. Responde de forma determinística.
//
// Uso: npm run llm-falso   ->   LLM_BASE_URL=http://localhost:11999/v1 LLM_API_KEY=qualquer
import http from "node:http";

const porta = Number(process.argv[2] ?? 11999);

function responder(corpo) {
  const msgs = corpo.messages;
  const ultima = msgs.at(-1);
  const ferramentas = msgs.filter((m) => m.role === "tool");
  if (corpo.max_tokens <= 60) return { conteudo: "decoratorName jwt decorator fastifyJwt" };
  if (corpo.tools && ferramentas.length === 0) {
    const pergunta = [...msgs].reverse().find((m) => m.role === "user").content;
    return { chamadas: [{ id: "c1", nome: "buscar_semantico", args: { consulta: pergunta } }] };
  }
  if (corpo.tools && ferramentas.length === 1) {
    const m = /^1\. (\S+) (\S+):L(\d+)-L(\d+)/m.exec(ferramentas[0].content);
    if (m) return { chamadas: [{ id: "c2", nome: "ler_arquivo", args: { repo: m[1], path: m[2], linhaInicio: Number(m[3]), linhaFim: Number(m[3]) + 9 } }] };
  }
  // resposta final: cita o primeiro intervalo visto e inventa um que deve ser removido
  const texto = msgs.map((m) => m.content ?? "").join("\n");
  const lido = /^(\S+) \(L(\d+)-L(\d+)\)/m.exec(ferramentas.at(-1)?.content ?? "");
  const trecho = /arquivo="([^"]+)" linhas="(\d+)-(\d+)"/.exec(texto);
  const [path, a, b] = lido ? [lido[1], lido[2], lido[3]] : trecho ? [trecho[1], trecho[2], trecho[3]] : ["x", 1, 1];
  return {
    conteudo: `A opção está definida em \`${path}\` [${path}:L${a}-L${b}]. **Resumo:** ela muda o nome do decorator.\n\n- Também aparece aqui [src/inventado.js:L1-L9].`,
  };
}

http
  .createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      const corpo = JSON.parse(b || "{}");
      const r = responder(corpo);
      const uso = { prompt_tokens: Math.ceil(b.length / 4), completion_tokens: 40 };
      if (!corpo.stream) {
        res.setHeader("content-type", "application/json");
        const message = r.chamadas
          ? {
              role: "assistant",
              content: null,
              tool_calls: r.chamadas.map((c) => ({ id: c.id, type: "function", function: { name: c.nome, arguments: JSON.stringify(c.args) } })),
            }
          : { role: "assistant", content: r.conteudo };
        return res.end(JSON.stringify({ choices: [{ message }], usage: uso }));
      }
      res.setHeader("content-type", "text/event-stream");
      const partes = r.conteudo.match(/.{1,12}/gs);
      let i = 0;
      const t = setInterval(() => {
        if (i < partes.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: partes[i++] } }] })}\n\n`);
        else {
          res.write(`data: ${JSON.stringify({ choices: [], usage: uso })}\n\ndata: [DONE]\n\n`);
          clearInterval(t);
          res.end();
        }
      }, 40);
    });
  })
  .listen(porta, () => console.log(`LLM falso em http://localhost:${porta}/v1`));

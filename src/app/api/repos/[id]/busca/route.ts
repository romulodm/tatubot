import { rota, json, lerJson } from "@/lib/http";
import { texto } from "@/lib/validar";
import { exigirUsuario } from "@/lib/auth/sessao";
import { repoDoUsuario } from "@/lib/recursos";
import { buscar } from "@/lib/busca/buscar";

// Rota de depuração: mostra o ranking com os scores de cada etapa.
export const POST = rota<{ id: string }>(async (req, { params }) => {
  const u = await exigirUsuario();
  const r = await repoDoUsuario(u, params.id);
  const consulta = texto(await lerJson(req), "consulta", { nome: "Consulta", obrigatorio: true, max: 500 })!;
  const { resultados, avisos } = await buscar({ repoIds: [r._id], consulta, k: 10, grafo: true });
  return json({
    avisos,
    resultados: resultados.map((x) => ({
      path: x.chunk.path,
      simbolo: x.chunk.simbolo,
      tipo: x.chunk.tipo,
      linhaInicio: x.chunk.linhaInicio,
      linhaFim: x.chunk.linhaFim,
      commitSha: x.chunk.commitSha,
      viaGrafo: x.viaGrafo,
      scores: x.scores,
      previa: x.chunk.conteudo.split("\n").slice(0, 8).join("\n"),
    })),
  });
});

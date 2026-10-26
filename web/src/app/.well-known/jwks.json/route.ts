import { jwks } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await jwks(), { headers: { "cache-control": "public, max-age=300" } });
}

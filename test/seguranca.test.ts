import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { detectarSegredo } from "@/lib/indexacao/segredos";
import { motivoIgnorarCaminho, motivoIgnorarConteudo } from "@/lib/indexacao/filtros";
import { assinaturaValida } from "@/lib/webhook";
import { hashSenha, conferirSenha } from "@/lib/auth/senha";
import { REGEX_REPO_URL } from "@/lib/validar";

describe("varredura de segredos", () => {
  it("ignora .env mas não .env.example", () => {
    expect(detectarSegredo(".env", "A=1")).toBe("arquivo_sensivel");
    expect(detectarSegredo("config/.env.production", "")).toBe("arquivo_sensivel");
    expect(detectarSegredo(".env.example", "A=")).toBeNull();
  });
  it("detecta tokens e chaves no conteúdo", () => {
    expect(detectarSegredo("a.ts", `const t = "ghp_${"a".repeat(36)}"`)).toBe("github_token");
    expect(detectarSegredo("a.ts", "-----BEGIN RSA PRIVATE KEY-----")).toBe("chave_privada");
    expect(detectarSegredo("a.ts", "AKIAABCDEFGHIJKLMNOP")).toBe("aws_access_key");
  });
  it("não acusa URL de exemplo em docs", () => {
    expect(detectarSegredo("README.md", "postgres://user:password@localhost/db")).toBeNull();
  });
});

describe("filtros", () => {
  it("ignora dependências, lockfiles e binários", () => {
    expect(motivoIgnorarCaminho("node_modules/x/index.js")).toBe("diretorio_ignorado");
    expect(motivoIgnorarCaminho("package-lock.json")).toBe("lockfile");
    expect(motivoIgnorarCaminho("public/logo.png")).toBe("binario");
    expect(motivoIgnorarCaminho("src/index.ts")).toBeNull();
    expect(motivoIgnorarConteudo(Buffer.from([65, 0, 66]), 1000)).toBe("binario");
  });
});

describe("webhook e senha", () => {
  it("valida HMAC do GitHub", () => {
    const corpo = '{"ref":"refs/heads/main"}';
    const sig = "sha256=" + createHmac("sha256", "s3gr3do").update(corpo).digest("hex");
    expect(assinaturaValida(corpo, sig, "s3gr3do")).toBe(true);
    expect(assinaturaValida(corpo, sig, "outro")).toBe(false);
    expect(assinaturaValida(corpo, "sha256=abc", "s3gr3do")).toBe(false);
  });
  it("scrypt confere a senha certa e rejeita a errada", async () => {
    const h = await hashSenha("correta horse");
    expect(await conferirSenha("correta horse", h)).toBe(true);
    expect(await conferirSenha("errada", h)).toBe(false);
  });
  it("só aceita URLs do GitHub", () => {
    expect(REGEX_REPO_URL.test("https://github.com/vercel/ms")).toBe(true);
    expect(REGEX_REPO_URL.test("https://github.com/vercel/ms.git")).toBe(true);
    expect(REGEX_REPO_URL.test("https://evil.com/vercel/ms")).toBe(false);
    expect(REGEX_REPO_URL.test("https://github.com/a/b;rm -rf /")).toBe(false);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { detectarSegredo } from "../src/indexacao/segredos.js";
import { motivoIgnorarCaminho, motivoIgnorarConteudo } from "../src/indexacao/filtros.js";
import { assinaturaValida } from "../src/dominio/webhook.js";
import { REGEX_REPO_URL } from "../src/http/validar.js";

describe("varredura de segredos", () => {
  it("ignora .env mas não .env.example", () => {
    assert.equal(detectarSegredo(".env", "A=1"), "arquivo_sensivel");
    assert.equal(detectarSegredo("config/.env.production", ""), "arquivo_sensivel");
    assert.equal(detectarSegredo(".env.example", "A="), null);
  });
  it("detecta tokens e chaves no conteúdo", () => {
    assert.equal(detectarSegredo("a.ts", `const t = "ghp_${"a".repeat(36)}"`), "github_token");
    assert.equal(detectarSegredo("a.ts", "-----BEGIN RSA PRIVATE KEY-----"), "chave_privada");
    assert.equal(detectarSegredo("a.ts", "AKIAABCDEFGHIJKLMNOP"), "aws_access_key");
    assert.equal(detectarSegredo("a.ts", `OPENAI="sk-proj-${"x".repeat(40)}"`), "openai_key");
  });
  it("não acusa URL de exemplo em docs", () => {
    assert.equal(detectarSegredo("README.md", "postgres://user:password@localhost/db"), null);
  });
});

describe("filtros", () => {
  it("ignora dependências, lockfiles e binários", () => {
    assert.equal(motivoIgnorarCaminho("node_modules/x/index.js"), "diretorio_ignorado");
    assert.equal(motivoIgnorarCaminho("package-lock.json"), "lockfile");
    assert.equal(motivoIgnorarCaminho("public/logo.png"), "binario");
    assert.equal(motivoIgnorarCaminho("src/index.ts"), null);
    assert.equal(motivoIgnorarConteudo(Buffer.from([65, 0, 66]), 1000), "binario");
    assert.equal(motivoIgnorarCaminho("public/flags/es.svg"), "imagem");
    assert.equal(motivoIgnorarConteudo(Buffer.from(`[${'"exemplo.com",'.repeat(1000)}]`), 200_000), "linha_longa");
    assert.equal(motivoIgnorarConteudo(Buffer.from("const a = 1;\nconst b = 2;\n"), 200_000), null);
  });
});

describe("webhook e URL", () => {
  it("valida HMAC do GitHub", () => {
    const corpo = '{"ref":"refs/heads/main"}';
    const sig = "sha256=" + createHmac("sha256", "s3gr3do").update(corpo).digest("hex");
    assert.equal(assinaturaValida(corpo, sig, "s3gr3do"), true);
    assert.equal(assinaturaValida(corpo, sig, "outro"), false);
    assert.equal(assinaturaValida(corpo, "sha256=abc", "s3gr3do"), false);
  });
  it("só aceita URLs do GitHub", () => {
    assert.equal(REGEX_REPO_URL.test("https://github.com/vercel/ms"), true);
    assert.equal(REGEX_REPO_URL.test("https://github.com/vercel/ms.git"), true);
    assert.equal(REGEX_REPO_URL.test("https://evil.com/vercel/ms"), false);
    assert.equal(REGEX_REPO_URL.test("https://github.com/a/b;rm -rf /"), false);
  });
});

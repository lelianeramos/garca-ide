/**
 * Testes de segurança e contrato de api/github/commit.js
 * -------------------------------------------------------
 * Chamam o handler REAL diretamente, sem servidor: request/response falsos no
 * formato Vercel. Se a validação de caminho regressar, isto falha.
 *
 * O caso que motivou o teste: "../../evil.py" era "limpo" para "evil.py" por
 * um replace() e o commit seguia em frente. Sanitizar e aceitar é sanitização
 * silenciosa — o caminho tem de ser RECUSADO.
 *
 * Uso: npm run test:api
 */

import assert from "node:assert/strict";
import handler from "../api/github/commit.js";

const ENV_BACKUP = { ...process.env };

function setupEnv() {
  process.env.GITHUB_TOKEN = "github_pat_teste_invalido";
  process.env.GITHUB_REPOSITORY = "organizacao/repositorio";
  process.env.GITHUB_BRANCH = "main";
  process.env.CONTRIBUTOR_1_NAME = "João Vitor";
  process.env.CONTRIBUTOR_1_USERNAME = "vitorino2011";
  process.env.CONTRIBUTOR_1_EMAIL = "joao@example.test";
}

function teardownEnv() {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ENV_BACKUP);
}

/** Executa o handler e devolve { status, payload }. */
async function call(body, method = "POST") {
  let captured = { status: 200, payload: null };
  const response = {
    status(code) { captured.status = code; return response; },
    json(payload) { captured.payload = payload; return response; },
  };
  await handler({ method, url: "/api/github/commit", headers: {}, body }, response);
  return captured;
}

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

/* ------------------------------------------------------------------ */
/* Travessia de diretório — falhar fechado                             */
/* ------------------------------------------------------------------ */

teste("rejeita ../ no caminho", async () => {
  const { status, payload } = await call({
    author: "1",
    files: [{ path: "../../evil.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
  assert.match(payload.error, /travessia|inseguro/i);
});

teste("rejeita ../ aninhado no meio do caminho", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "programacao/../segredo.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
});

teste("rejeita caminho absoluto", async () => {
  const { status, payload } = await call({
    author: "1",
    files: [{ path: "/etc/passwd.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
  assert.match(payload.error, /travessia|inseguro/i);
});

teste("rejeita caminho Windows", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "C:\\projetos\\evil.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
});

teste("rejeita byte nulo no caminho", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "programacao/main.py\0.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
});

teste("não escreve fora de programacao/", async () => {
  const { status, payload } = await call({
    author: "1",
    files: [{ path: "evil.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
  assert.match(payload.error, /programacao/);
});

/* ------------------------------------------------------------------ */
/* Estrutura do repositório (19.1)                                     */
/* ------------------------------------------------------------------ */

teste("rejeita extensão que não é .py", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "programacao/index.html", content: "<html>" }],
  });
  assert.equal(status, 400);
});

teste("rejeita caminho com espaço", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "programacao/meu arquivo.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
});

teste("rejeita caminho começando por dígito", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "programacao/1saida.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
});

teste("rejeita saída com número fora do padrão", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "programacao/saidas/saida_abc.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
});

/* ------------------------------------------------------------------ */
/* Limites                                                             */
/* ------------------------------------------------------------------ */

teste("rejeita mais de 100 arquivos", async () => {
  const files = Array.from({ length: 101 }, (_, i) => ({
    path: `programacao/modulo_${i}.py`, content: "x = 1\n",
  }));
  const { status } = await call({ author: "1", files });
  assert.equal(status, 400);
});

teste("rejeita arquivo maior que 500 KB", async () => {
  const { status, payload } = await call({
    author: "1",
    files: [{ path: "programacao/main.py", content: "x = 1\n".repeat(90_000) }],
  });
  assert.equal(status, 413);
  assert.match(payload.error, /grande/);
});

teste("rejeita lista de arquivos vazia", async () => {
  const { status } = await call({ author: "1", files: [] });
  assert.equal(status, 400);
});

teste("rejeita content que não é string", async () => {
  const { status } = await call({
    author: "1",
    files: [{ path: "programacao/main.py", content: { malicioso: true } }],
  });
  assert.equal(status, 413);
});

/* ------------------------------------------------------------------ */
/* Autor e método                                                      */
/* ------------------------------------------------------------------ */

teste("rejeita integrante inexistente (id 9)", async () => {
  const { status, payload } = await call({
    author: "9",
    files: [{ path: "programacao/main.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
  assert.match(payload.error, /[Ii]ntegrante/);
});

teste("rejeita integrante sem e-mail configurado (S02: nunca usa e-mail alheio)", async () => {
  delete process.env.CONTRIBUTOR_2_NAME;
  const { status } = await call({
    author: "2",
    files: [{ path: "programacao/main.py", content: "x = 1\n" }],
  });
  assert.equal(status, 400);
});

teste("rejeita método diferente de POST", async () => {
  const { status } = await call({}, "GET");
  assert.equal(status, 405);
});

teste("sem credenciais devolve 503 explicando o que falta (N18)", async () => {
  delete process.env.GITHUB_TOKEN;
  const { status, payload } = await call({
    author: "1",
    files: [{ path: "programacao/main.py", content: "x = 1\n" }],
  });
  assert.equal(status, 503);
  assert.match(payload.error, /GITHUB_TOKEN/);
  setupEnv();
});

/* ------------------------------------------------------------------ */
/* O token nunca volta na resposta (S01)                               */
/* ------------------------------------------------------------------ */

teste("a resposta nunca ecoa o token", async () => {
  const { payload } = await call({
    author: "1",
    files: [{ path: "programacao/main.py", content: "x = 1\n" }],
  });
  const serialized = JSON.stringify(payload ?? {});
  assert.ok(!serialized.includes(process.env.GITHUB_TOKEN), "token vazou na resposta");
  assert.ok(!serialized.includes("github_pat_teste_invalido"));
});

teste("a resposta nunca ecoa o e-mail do integrante (S02)", async () => {
  const { payload } = await call({
    author: "1",
    files: [{ path: "programacao/main.py", content: "x = 1\n" }],
  });
  const serialized = JSON.stringify(payload ?? {});
  assert.ok(!serialized.includes("joao@example.test"), "e-mail vazou na resposta");
});

/* ------------------------------------------------------------------ */
/* Caminhos válidos passam pela validação                              */
/* ------------------------------------------------------------------ */

const VALIDOS = [
  "programacao/main.py",
  "programacao/saidas/saida_1.py",
  "programacao/saidas/saida_42.py",
  "programacao/libraries/movements.py",
  "programacao/movements.py",
  "programacao/utils/pid/giro.py",
];

for (const path of VALIDOS) {
  teste(`aceita caminho válido ${path}`, async () => {
    const { status, payload } = await call({
      author: "1",
      message: "atualizar código",
      files: [{ path, content: "x = 1\n" }],
    });
    // o token é falso: a validação de caminho PASSA e a falha vem da rede/GitHub
    assert.notEqual(status, 400, `caminho válido foi rejeitado: ${payload?.error}`);
    assert.notEqual(status, 413);
  });
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

setupEnv();
for (const { nome, fn } of testes) {
  setupEnv();
  try {
    await fn();
    passed += 1;
    console.log(`\u001b[32m✓\u001b[0m ${nome}`);
  } catch (error) {
    failures.push({ nome, error });
    console.log(`\u001b[31m✗ ${nome}\u001b[0m\n    ${error.message.split("\n")[0]}`);
  } finally {
    setupEnv();
  }
}
teardownEnv();

console.log(`\n${passed}/${testes.length} testes do handler de commit passaram.`);
if (failures.length) {
  console.log(`\u001b[31m${failures.length} falha(s).\u001b[0m`);
  process.exit(1);
}

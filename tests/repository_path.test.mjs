/**
 * Teste de integração: caminho gerado no frontend x caminho aceito no backend
 * ---------------------------------------------------------------------------
 * `repositoryPath()` (src/ui/githubPanel.js) monta o caminho que vai no corpo
 * do commit; `api/github/commit.js` valida esse caminho. Os dois evoluem em
 * arquivos diferentes — este teste impede que se desacoplem e o botão
 * "Atualizar código" comece a falhar só em produção.
 *
 * Uso: npm run test:api
 */

import assert from "node:assert/strict";
import { repositoryPath } from "../src/ui/githubPanel.js";

/** O mesmo regex de api/github/commit.js (19.1). */
const VALID_PATH = /^programacao\/(?:saidas\/saida_\d+|main|(?!saidas\/)(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*)\.py$/;

const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

/* ------------------------------------------------------------------ */
/* Saídas — cada aba vira programacao/saidas/saida_N.py                */
/* ------------------------------------------------------------------ */

teste("Saída 1 vira programacao/saidas/saida_1.py", () => {
  const path = repositoryPath({ path: "/missions/saida_1.py" }, 1);
  assert.equal(path, "programacao/saidas/saida_1.py");
  assert.match(path, VALID_PATH);
});

teste("Saída 12 mantém o número", () => {
  const path = repositoryPath({ path: "/missions/saida_12.py" }, 12);
  assert.equal(path, "programacao/saidas/saida_12.py");
  assert.match(path, VALID_PATH);
});

teste("trocar de aba muda o caminho automaticamente (19.1)", () => {
  const file = { path: "/missions/saida_5.py" };
  assert.equal(repositoryPath(file, 5), "programacao/saidas/saida_5.py");
  // o caminho sai do arquivo, não do número da aba ativa
  assert.equal(repositoryPath({ path: "/missions/saida_3.py" }, 5), "programacao/saidas/saida_3.py");
});

teste("main.py vira programacao/main.py", () => {
  const path = repositoryPath({ path: "main.py" });
  assert.equal(path, "programacao/main.py");
  assert.match(path, VALID_PATH);
});

/* ------------------------------------------------------------------ */
/* Módulos e bibliotecas                                               */
/* ------------------------------------------------------------------ */

const MODULOS = [
  ["/libraries/movements.py", "programacao/libraries/movements.py"],
  ["/movements.py", "programacao/movements.py"],
  ["/utils/pid.py", "programacao/utils/pid.py"],
  ["/sensores/cor.py", "programacao/sensores/cor.py"],
];

for (const [origem, esperado] of MODULOS) {
  teste(`${origem} -> ${esperado}`, () => {
    const path = repositoryPath({ path: origem });
    assert.equal(path, esperado);
    assert.match(path, VALID_PATH, "o backend rejeitaria este caminho");
  });
}

/* ------------------------------------------------------------------ */
/* Todo arquivo do projeto padrão precisa ser publicável               */
/* ------------------------------------------------------------------ */

teste("todos os arquivos do projeto inicial geram caminhos aceitos", () => {
  // espelha VirtualFileSystem.emptyProject() (B16: só main.py + saida_1.py)
  const arquivos = ["/main.py", "/missions/saida_1.py"];
  for (const arquivo of arquivos) {
    const path = repositoryPath({ path: arquivo });
    assert.match(path, VALID_PATH, `${arquivo} gerou ${path}, que o backend rejeita`);
  }
});

teste("arquivo de biblioteca criado pelo modelo é publicável", () => {
  const path = repositoryPath({ path: "/libraries/movements.py" });
  assert.match(path, VALID_PATH);
});

/* ------------------------------------------------------------------ */
/* Robustez                                                            */
/* ------------------------------------------------------------------ */

teste("não duplica barras nem mantém barra inicial", () => {
  const path = repositoryPath({ path: "///missions//saida_2.py" });
  assert.ok(!path.includes("//"), path);
  assert.ok(!path.startsWith("/"), path);
});

teste("objeto vazio não quebra", () => {
  assert.doesNotThrow(() => repositoryPath({}));
  assert.doesNotThrow(() => repositoryPath(null));
});

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];
for (const { nome, fn } of testes) {
  try { await fn(); passed += 1; console.log(`\u001b[32m✓\u001b[0m ${nome}`); }
  catch (error) { failures.push(nome); console.log(`\u001b[31m✗ ${nome}\u001b[0m\n    ${error.message.split("\n")[0]}`); }
}

console.log(`\n${passed}/${testes.length} testes de caminho do repositório passaram.`);
if (failures.length) process.exit(1);

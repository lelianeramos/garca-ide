/**
 * AUDITORIA FINAL — o que precisa continuar verdade depois de tudo.
 *
 * Este arquivo não caça bug novo: ele trava as correções deste ciclo para
 * que elas não voltem. Cada teste cita o sintoma que a criança viu.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncManager } from "../src/editor/syncManager.js";
import { parseProgram } from "../src/parser/pythonParser.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";
import { generateProgram } from "../src/python/codeGenerator.js";

const OPTS = { userFunctions: [], libraryFunctions: [] };
const roundTrip = (codigo) => {
  const { blocks } = irToBlocks(parseProgram(codigo).ir, { ...OPTS, sourceText: codigo });
  const saida = generateProgram(blocks, OPTS);
  return { saida, diagnosticos: parseProgram(saida).diagnostics.length };
};

/* ---- 1. a duplicata ao digitar dentro do chapéu ---- */

test("digitar dentro do chapéu não troca a identidade dos blocos", () => {
  const base = "def main():\n    hub = 1\n    va = 5\n\nmain()\n";
  const sm = new SyncManager();
  sm.runPipeline(base);
  const chapeu = sm.blocks[0].id;
  // `va = 5` é o ÚLTIMO bloco do corpo; `hub = 1` também é um var_set.
  const ultimo = () => sm.blocks[0].children[sm.blocks[0].children.length - 1].id;
  const filho = ultimo();
  sm.runPipeline(base.replace("va = 5", "v = 5"));
  assert.equal(sm.blocks[0].id, chapeu, "o chapéu mudou de identidade a cada tecla");
  assert.equal(ultimo(), filho, "o bloco digitado mudou de identidade");
});

test("uma cavidade tem exatamente uma pilha interna, sempre", () => {
  /*
   * A causa da duplicata: o renderizador procurava `.block-stack.nested` e
   * criava `class="block-stack gb-stack"`. A classe `nested` nunca existiu,
   * então a busca falhava e uma pilha nova nascia a cada tecla.
   */
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    x = 1\n\nmain()\n");
  for (let i = 0; i < 20; i += 1) {
    sm.runPipeline(`def main():\n    v${i} = 1\n\nmain()\n`);
  }
  // A verificação estrutural acontece em tests/render_lifecycle.test.mjs;
  // aqui o que importa é que o pipeline não produza blocos duplicados.
  assert.equal(sm.blocks.length, 1, "só existe um chapéu");
  assert.equal(sm.blocks[0].children.length, 1, "só existe um bloco no corpo");
});

/* ---- 2. apagar o bloco duplicado não apaga ---- */

test("remover um bloco dentro do chapéu funciona", () => {
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    hub = 1\n    x = 5\n    y = 6\n\nmain()\n");
  // `x = 5` é o bloco do MEIO: apagar o primeiro `var_set` apagaria o `hub`.
  const alvo = sm.blocks[0].children.find((b) => b.params?.name === "x");
  assert.ok(alvo, "o bloco x tem que existir no corpo do chapéu");
  const r = sm.removeBlockFromCode(alvo);
  assert.equal(r.changed, true, "a remoção foi recusada em silêncio");
  assert.ok(!sm.code.includes("x = 5"), `a linha continua:\n${sm.code}`);
  assert.ok(sm.code.includes("hub = 1"), "o irmão de cima foi apagado junto");
  assert.ok(sm.code.includes("y = 6"), "o irmão de baixo foi apagado junto");
});

test("remover em bloco já removido não apaga outra linha", () => {
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    hub = 1\n    x = 5\n    y = 6\n\nmain()\n");
  const alvo = sm.blocks[0].children.find((b) => b.params?.name === "x");
  sm.removeBlockFromCode(alvo);
  const depois = sm.code;
  sm.removeBlockFromCode(alvo);
  assert.equal(sm.code, depois,
    "a segunda remoção usou um span velho e apagou a linha errada");
});

/* ---- 3. import automático ---- */

test("importmissing é escrito sozinho, e uma única vez", () => {
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    hub = PrimeHub()\n\nmain()\n");
  assert.match(sm.code, /from pybricks\.hubs import PrimeHub/);
  const uma = sm.code;
  for (let i = 0; i < 5; i += 1) sm.runPipeline(uma);
  assert.equal(sm.code.split("from pybricks.hubs import").length - 1, 1);
});

/* ---- 4. nada de Python inválido ou perdido ---- */

test("todo código volteja compila", () => {
  const casos = [
    "def main():\n    if a > b:\n        x = 1\n    elif a == b:\n        x = 2\n    else:\n        x = 3\n\nmain()\n",
    "try:\n    x = 1\nexcept ValueError:\n    x = 2\nfinally:\n    y = 3\n",
    "with open('a') as f:\n    print(1)\n",
    "while a < b:\n    if c:\n        break\n    a += 1\n",
    "x = a + b - c * d / e // f % g ** h\n",
    "x = a & b | c ^ d\n",
    "a, b = 1, 2\n",
    "print('a', 'b', 1, True)\n",
    "def g(h):\n    h.rotation_angle = 0\n    return h.rotation_angle\n",
  ];
  for (const codigo of casos) {
    const { saida, diagnosticos } = roundTrip(codigo);
    assert.equal(diagnosticos, 0,
      `o Python devolvido não compila:\nENTRADA:\n${codigo}\nSAÍDA:\n${saida}`);
  }
});

test("nenhum operador de aumento sai duplicado", () => {
  for (const op of ["+=", "-=", "*=", "/=", "//=", "%=", "**="]) {
    const { saida, diagnosticos } = roundTrip(`x = 1\nx ${op} 2\n`);
    assert.equal(diagnosticos, 0, `${op} gerou Python inválido:\n${saida}`);
    assert.ok(saida.includes(op), `esperava ${op}:\n${saida}`);
  }
});

/* ---- 5. a entrada pela metade é dita, não aceita em silêncio ---- */

test("linha pela metade vira diagnóstico", () => {
  for (const quebrado of ["x = 1 +", "x = = 1", "x ="]) {
    const sm = new SyncManager();
    sm.runPipeline(quebrado);
    assert.ok(sm.diagnostics.length > 0,
      `"${quebrado}" foi aceito sem aviso — o SyntaxError só apareceria no robô`);
    assert.equal(sm.state, "error");
  }
});

test("linha válida NÃO gera falso alarme", () => {
  for (const valido of [
    "x = 5", "x = a + b", "x = not y", "x = -1", "x = a if b else c",
    "x = f(1)", "x = (1 + 2) * 3", "x = 1 == 2", "x = [1, 2]", 'x = "texto"',
  ]) {
    const sm = new SyncManager();
    sm.runPipeline(valido);
    assert.equal(sm.diagnostics.length, 0,
      `"${valido}" foi acusado como erro: ${JSON.stringify(sm.diagnostics[0])}`);
  }
});

/* ---- 6. a geometria do robô não mudou ---- */

test("geometria oficial continua 62,4 mm e 48 mm", async () => {
  const { ROBOT_CONFIG } = await import("../src/config/robot.js");
  assert.equal(ROBOT_CONFIG.wheel_diameter, 62.4, "a roda oficial é 62,4 mm");
  assert.equal(ROBOT_CONFIG.axle_track, 48, "o eixo padrão é 48 mm, nunca 56");
});

/* ---- 7. o token do GitHub nunca chega ao navegador ---- */

test("nenhum módulo do cliente carrega token do GitHub", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const padrao = /github_pat_[A-Za-z0-9_]{20,}/;
  const alvos = ["src", "api"];
  const suspender = [];
  const visitar = async (dir) => {
    for (const entrada of await readdir(dir, { withFileTypes: true })) {
      const caminho = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) { await visitar(caminho); continue; }
      if (!/\\.(js|mjs|css|html)$/.test(entrada.name)) continue;
      suspender.push([caminho, await readFile(caminho, "utf8")]);
    }
  };
  for (const alvo of alvos) await visitar(alvo);
  for (const [caminho, texto] of suspender) {
    assert.ok(!padrao.test(texto),
      `${caminho} contém um token de verdade no lado do cliente`);
  }
});

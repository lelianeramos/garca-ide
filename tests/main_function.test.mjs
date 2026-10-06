/**
 * Testes do pipeline real: catálogo -> blocos -> Python.
 *
 *   node tests/main_function.test.mjs
 *
 * Aqui mora a regressão mais importante do projeto: o bloco
 * "quando o programa iniciar" precisa virar a função `main()` DE VERDADE,
 * com corpo, indentação e a chamada `main()` no final. Antes ele gerava só
 * um comentário — os blocos soltos abaixo dele iam parar fora de qualquer
 * função e o robô não executava nada.
 */

import assert from "node:assert/strict";

import { BLOCK_BY_ID, BLOCK_CATALOG, blockDefaults } from "../src/blocks/blockCatalog.js";
import { makeBlock } from "../src/blocks/blockFactory.js";
import { generateProgram, insertBlock, insertIntoBlock, isMainBlock } from "../src/python/codeGenerator.js";

let passed = 0;
const failures = [];

/*
 * `test` aceita funções async: sem `await` dentro dela, uma rejeição viraria
 * uma "UnhandledPromiseRejection" e o processo derrubaria com um relatório
 * que não aponta o teste que falhou.
 */
const queue = [];
function test(name, fn) {
  queue.push([name, fn]);
}

async function run() {
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed += 1;
      process.stdout.write(`✓ ${name}\n`);
    } catch (error) {
      failures.push({ name, error });
      process.stdout.write(`✗ ${name}\n  ${error.message}\n`);
    }
  }
  process.stdout.write(`\n${passed} passaram, ${failures.length} falharam.\n`);
  if (failures.length) process.exit(1);
}

const spec = (id) => {
  const found = BLOCK_BY_ID.get(id);
  assert.ok(found, `Bloco ${id} não existe no catálogo`);
  return found;
};

const instance = (id, params = {}) => makeBlock(id, { ...blockDefaults(spec(id)), ...params });

/* ------------------------------------------------------------------ */

test("o chapéu do programa é a função main(), não um comentário", () => {
  const generated = spec("event_program_start").py({});
  assert.equal(generated, "def main():");
  assert.ok(!generated.startsWith("#"), "não pode ser apenas um comentário");
});

test("o chapéu do programa aceita blocos dentro dele", () => {
  const found = spec("event_program_start");
  assert.equal(found.block, true, "precisa ter corpo para receber blocos");
  assert.equal(found.isMain, true);
  assert.equal(found.shape, "hat");
});

test("isMainBlock identifica o chapéu pelo nome do bloco", () => {
  assert.equal(isMainBlock({ blockId: "event_program_start" }), true);
  assert.equal(isMainBlock({ blockId: "myblock_define" }), false);
  assert.equal(isMainBlock(null), false);
});

test("programa com o chapéu + um bloco gera main() com corpo indentado", () => {
  const hat = instance("event_program_start");
  hat.children = [instance("movement_straight", { rotations: 10 })];
  const code = generateProgram([hat]);

  assert.match(code, /def main\(\):/, "falta a função main");
  assert.match(code, /\n {4}robot\.straight\(1960\)\n/, `corpo não indentado:\n${code}`);
  assert.match(code, /\nmain\(\)\s*$/, `falta a chamada main():\n${code}`);
});

test("o corpo fica DENTRO da função, nunca depois dela", () => {
  const hat = instance("event_program_start");
  hat.children = [instance("movement_turn", { degrees: 90 })];
  const code = generateProgram([hat]);
  const lines = code.split("\n");
  const mainAt = lines.findIndex((l) => l === "def main():");
  const callAt = lines.findIndex((l) => l === "main()");
  const bodyAt = lines.findIndex((l) => l.includes("robot.turn"));
  assert.ok(mainAt >= 0 && callAt > mainAt, `main()/main() fora de ordem:\n${code}`);
  assert.ok(bodyAt > mainAt && bodyAt < callAt, `corpo fora da função:\n${code}`);
  assert.match(lines[bodyAt], /^ {4}\S/, `corpo sem indentação: "${lines[bodyAt]}"`);
});

test("sem o chapéu não aparece main() — nada é inventado", () => {
  const code = generateProgram([instance("movement_turn", { degrees: 90 })]);
  assert.doesNotMatch(code, /^main\(\)$/m, `main() sem def main:\n${code}`);
});

test("dois blocos dentro do chapéu ficam na ordem, ambos indentados", () => {
  const hat = instance("event_program_start");
  hat.children = [
    instance("movement_straight", { rotations: 10 }),
    instance("movement_turn", { degrees: 90 }),
  ];
  const code = generateProgram([hat]);
  const lines = code.split("\n").filter((l) => l.includes("robot."));
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^ {4}robot\./, `sem indentação: "${line}"`);
  assert.ok(lines[0].includes("straight"), "o primeiro bloco foi para o fim");
  assert.ok(lines[1].includes("turn"), "o segundo bloco foi para o fim");
});

/* ---------------------- inserção ---------------------- */

test("inserir o chapéu cria def main() e a chamada no fim", () => {
  const { code } = insertBlock("", instance("event_program_start"), "top");
  assert.match(code, /def main\(\):/, `sem def main:\n${code}`);
  assert.match(code, /\nmain\(\)\s*$/, `sem main() no fim:\n${code}`);
});

test("inserir no fim depois do chapéu coloca DENTRO da função", () => {
  const { code } = insertBlock("", instance("event_program_start"), "top");
  const again = insertBlock(code, instance("movement_straight", { rotations: 10 }), "bottom");
  const lines = again.code.split("\n");
  const mainAt = lines.findIndex((l) => l === "def main():");
  const bodyAt = lines.findIndex((l) => l.includes("robot.straight"));
  const callAt = lines.findIndex((l) => l === "main()");
  assert.ok(mainAt >= 0, `sem main:\n${again.code}`);
  assert.ok(bodyAt > mainAt, `bloco antes da função:\n${again.code}`);
  assert.ok(bodyAt < callAt, `bloco depois da chamada main():\n${again.code}`);
  assert.match(lines[bodyAt], /^ {4}\S/, `sem indentação: "${lines[bodyAt]}"`);
});

test("inserir várias vezes não duplica a chamada main()", () => {
  let { code } = insertBlock("", instance("event_program_start"), "top");
  for (let i = 0; i < 3; i += 1) {
    code = insertBlock(code, instance("movement_turn", { degrees: 90 }), "bottom").code;
  }
  const calls = code.split("\n").filter((l) => l === "main()");
  assert.equal(calls.length, 1, `main() chamado ${calls.length}x:\n${code}`);
});

test("o corpo vazio ganha 'pass' em vez de main() sem corpo", () => {
  const { code } = insertBlock("", instance("event_program_start"), "top");
  assert.match(code, / {4}pass/, `main() sem corpo e sem pass:\n${code}`);
});

test("inserir dentro do pai usa o span do pai e a indentação do arquivo", () => {
  const source = [
    "from pybricks.robotics import DriveBase",
    "",
    "def main():",
    "    wait(10)",
    "",
    "main()",
  ].join("\n");
  const { code } = insertIntoBlock(source, instance("movement_straight", { rotations: 10 }), 3);
  const lines = code.split("\n");
  const straightAt = lines.findIndex((l) => l.includes("robot.straight"));
  assert.ok(straightAt > 2, `fora do main:\n${code}`);
  assert.equal(lines[straightAt - 1].trim(), "wait(10)", `não foi para o fim do corpo:\n${code}`);
  assert.match(lines[straightAt], /^ {4}robot\.straight\(1960\)$/, `indentação errada: "${lines[straightAt]}"`);
});

test("inserir dentro de um corpo com 'pass' substitui o pass", () => {
  const source = ["def main():", "    pass", "", "main()"].join("\n");
  const { code } = insertIntoBlock(source, instance("movement_turn", { degrees: 90 }), 1);
  const lines = code.split("\n");
  assert.equal(lines[1].trim(), "robot.turn(90)", `não substituiu o pass:\n${code}`);
  assert.doesNotMatch(code, /pass/, `o pass sobrou:\n${code}`);
});

test("inserir dentro de um pai inexistente não corrompe o arquivo", () => {
  const source = "x = 1\n";
  const result = insertIntoBlock(source, instance("movement_turn", { degrees: 90 }), 99);
  assert.equal(result.changed, false);
  assert.equal(result.code, source);
});

/* ---------------------- rótulos visíveis ---------------------- */

/**
 * Item #5/#6: a forma e o texto do bloco precisam ensinar a função sem
 * repetir informação.
 *
 * A duplicação mais comum era a UNIDADE: o campo numérico já desenha a
 * unidade ao lado do número, e o texto do template dizia de novo — o bloco
 * aparecia como "girar ↻ por (90) graus ) graus". Este teste percorre o
 * catálogo inteiro para que isso não volte.
 */
function unitIsDuplicatedInTemplate(template, field, unit) {
  if (!unit) return false;
  const marker = `{${field}}`;
  const withoutMarker = String(template).split(marker).join(" ");
  // palavra inteira, para "mm" não casar dentro de "mm/s" ou de outro termo
  return new RegExp(`(^|[^\\w/])${unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w/]|$)`).test(withoutMarker);
}

test("nenhum bloco repete a unidade no texto (ela já está no campo)", () => {
  const offenders = [];
  for (const spec of BLOCK_CATALOG) {
    const template = spec.template ?? "";
    for (const [field, paramSpec] of Object.entries({ ...(spec.params ?? {}), ...(spec.advanced ?? {}), ...(spec.geometry ?? {}) })) {
      if (unitIsDuplicatedInTemplate(template, field, paramSpec.unit)) {
        offenders.push(`${spec.id}.${field} (unidade "${paramSpec.unit}") — "${template}"`);
      }
    }
  }
  assert.equal(offenders.length, 0, `unidade repetida no texto:\n  ${offenders.join("\n  ")}`);
});

test("a geometria do robô fica no painel, não na frase", () => {
  const movement = spec("movement_setup");
  assert.ok(movement.geometry, "o bloco de movimento tem painel de geometria");
  assert.ok(
    !/roda|eixo/i.test(movement.template),
    `a geometria voltou para a frase: "${movement.template}"`,
  );
  assert.match(movement.template, /\{left\}/);
  assert.match(movement.template, /\{right\}/);
});

test("todo bloco tem template em português e forma declarada", () => {
  for (const spec of BLOCK_CATALOG) {
    assert.ok(spec.template, `${spec.id} sem template`);
    assert.ok(
      ["hat", "stack", "c-block", "reporter", "boolean", "cap", "code"].includes(spec.shape),
      `${spec.id} com forma desconhecida: ${spec.shape}`,
    );
  }
});

test("o chapéu do programa é o único que marca o início", () => {
  const hats = BLOCK_CATALOG.filter((spec) => spec.shape === "hat").map((spec) => spec.id);
  assert.ok(hats.includes("event_program_start"), "faltou o chapéu do programa");
  // Um chapéu de evento e um de "defina" são legítimos; o que não pode
  // existir é um comando comum em formato de chapéu.
  for (const id of hats) {
    assert.ok(
      id.startsWith("event_") || id === "myblock_define",
      `${id} é um chapéu mas não é início de programa nem de evento`,
    );
  }
});



test("a base de movimento usa roda 62,4 mm e eixos 48 mm", async () => {
  const { ROBOT_CONFIG } = await import("../src/config/robot.js");
  assert.equal(ROBOT_CONFIG.wheel_diameter, 62.4);
  assert.equal(ROBOT_CONFIG.axle_track, 48);

  const { cmPerRotation, mmPerRotation } = await import("../src/config/robot.js");
  // circunferência = pi * diâmetro; em cm divide por 10
  assert.ok(Math.abs(mmPerRotation() - Math.PI * 62.4) < 0.001, `mm por rotação: ${mmPerRotation()}`);
  assert.ok(Math.abs(cmPerRotation() - (Math.PI * 62.4) / 10) < 0.001, `conversão errada: ${cmPerRotation()}`);

  // o catálogo tem que usar a configuração central, não números soltos
  const code = generateProgram([instance("movement_setup")]);
  assert.match(
    code,
    /robot = DriveBase\(motor_a, motor_b, 62\.4, 48\)/,
    `base de movimento com geometria errada:\n${code}`,
  );
  // nenhum outro diâmetro pode aparecer no catálogo de movimento
  assert.doesNotMatch(code, /5[0-9](?:\.\d+)?/, `geometria antiga no código:\n${code}`);
});

await run();

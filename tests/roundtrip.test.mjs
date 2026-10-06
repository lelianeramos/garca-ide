/**
 * ROUND-TRIP OBRIGATÓRIO (itens 25, 26, 58, 68).
 *
 *   Python A -> IR -> Blocos -> Python B
 *
 * Python B precisa ser SEMANTICAMENTE equivalente a A. Comparar texto não
 * serve: `erro * KP` e `(erro * KP)` são o mesmo programa, e um bom
 * round-trip vai legitimately adicionar parênteses. O que não pode mudar é
 * a ÁRVORE.
 *
 * O programa de stress é o do item 26 — o mesmo que a IDE precisa suportar
 * inteiro, porque é código real de FLL, não um exemplo artificial.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProgram } from "../src/parser/pythonParser.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";
import { generateProgram, requiredImports } from "../src/python/codeGenerator.js";
import { firstDifference } from "../tools/probe/diff.mjs";

const STRESS = readFileSync(new URL("./fixtures/stress.py", import.meta.url), "utf8");

function roundTrip(code) {
  const { ir } = parseProgram(code);
  const { blocks } = irToBlocks(ir, { userFunctions: [], libraryFunctions: [] });
  return { blocks, python: generateProgram(blocks, { comments: false }) };
}

/* ---------------- casos unitários do item 57 ---------------- */

const CASOS = [
  ["atribuicao de literal", "KP_STRAIGHT = 1.8\n", "KP_STRAIGHT = 1.8\n"],
  ["atribuicao de variavel", "erro = heading_alvo\n", "erro = heading_alvo\n"],
  ["operador com duas variaveis", "correcao = erro * KP_STRAIGHT\n", "correcao = (erro * KP_STRAIGHT)\n"],
  ["divisao por variavel", "v = distancia / 5\n", "v = (distancia / 5)\n"],
  ["divisao inteira", "v = distancia // 5\n", "v = (distancia // 5)\n"],
  ["potencia", "v = a ** 2\n", "v = (a ** 2)\n"],
  ["comparacao", "if a < b:\n    x = 1\n", "if (a < b):\n    x = 1\n"],
  ["and", "x = a < b and c > d\n", "x = (((a < b)) and ((c > d)))\n"],
  ["or", "x = a or b\n", "x = ((a) or (b))\n"],
  ["not", "if not a:\n    x = 1\n", "if (not (a)):\n    x = 1\n"],
  ["chamada aninhada", "e = f(g(h(x)))\n", "e = f(g(h(x)))\n"],
  ["builtin", "p = max(1, int(v / 5))\n", "p = max(1, int((v / 5)))\n"],
  ["ternario", "d = 1 if distancia >= 0 else -1\n", "d = (1 if (distancia >= 0) else -1)\n"],
  ["condicao de while", "while abs(gb.distance()) < alvo:\n    x = 1\n", "while (abs(gb.distance()) < alvo):\n    x = 1\n"],
  ["condicao de if", "if abs(e) <= t:\n    x = 1\n", "if (abs(e) <= t):\n    x = 1\n"],
  ["elif", "if a:\n    x = 1\nelif b:\n    x = 2\n", "if a:\n    x = 1\nelif b:\n    x = 2\n"],
  ["return com expressao", "def f():\n    return a * b\n", "def f():\n    return (a * b)\n"],
  ["parametro com default", "def f(g, v=300):\n    x = 1\n", "def f(g, v=300):\n    x = 1\n"],
  ["argumento nomeado na chamada", "f(1, v=2)\n", "f(1, v=2)\n"],
  ["range um argumento", "for i in range(10):\n    x = 1\n", "for i in range(10):\n    x = 1\n"],
  ["range tres argumentos", "for i in range(int(v), 0, -p):\n    x = 1\n", "for i in range(int(v), 0, (-p)):\n    x = 1\n"],
  ["matematica aninhada", "v = (a / b) * 1000\n", "v = ((a / b) * 1000)\n"],
  ["lista", "v = [1, 2, 3]\n", "v = [1, 2, 3]\n"],
  ["subscrito", "v = xs[0]\n", "v = xs[0]\n"],
  ["atribuicao composta", "erro -= 360\n", "erro -= 360\n"],
  ["break", "while a:\n    break\n", "while a:\n    break\n"],
];

for (const [nome, entrada, esperado] of CASOS) {
  test(`round-trip: ${nome}`, () => {
    const { python } = roundTrip(entrada);
    assert.equal(python.trim(), esperado.trim());
  });
}

/* ---------------- teste de stress (item 26) ---------------- */

test("programa de stress: 90%+ das linhas viram bloco", () => {
  const { ir, lines } = parseProgram(STRESS);
  const { representedLines } = irToBlocks(ir, { userFunctions: [], libraryFunctions: [] });
  const total = lines.filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  const pct = Math.round((representedLines.size / total) * 100);
  assert.ok(pct >= 90, `cobertura visual de ${pct}% (${representedLines.size}/${total}) — abaixo de 90%`);
});

test("programa de stress: cada função é semanticamente preservada", () => {
  const nomes = [...STRESS.matchAll(/^def (\w+)/gm)].map((m) => m[1]);
  assert.ok(nomes.length >= 5, "o fixture deve ter as 5 funções do item 26");
  const { python } = roundTrip(STRESS);

  /*
    Recorta cada função pelo TEXTO, e não por regex com flag `m`: em
    multilinha, `$` casa fim de LINHA, e a função era cortada no primeiro
    `def`. Um teste que passa por acidente não vale nada.
  */
  const recortar = (texto, nome) => {
    const inicio = texto.search(new RegExp(`^def ${nome}\\(`, "m"));
    if (inicio === -1) return null;
    const resto = texto.slice(inicio);
    const proximo = resto.slice(1).search(/\ndef /);
    return proximo === -1 ? resto : resto.slice(0, proximo + 1);
  };

  for (const nome of nomes) {
    const original = recortar(STRESS, nome);
    const regerado = recortar(python, nome);
    assert.ok(original, `não achei ${nome} no fixture`);
    assert.ok(regerado, `a função ${nome} não apareceu no Python regerado`);

    const diff = firstDifference(original, regerado);
    assert.equal(diff, null, `${nome} diverge em ${diff?.path}\n  esperado: ${JSON.stringify(diff?.esperado)}\n  obtido:   ${JSON.stringify(diff?.obtido)}`);
  }
});

test("programa de stress: toda linha sem bloco fica registrada como pythonOnly", () => {
  const { ir, lines } = parseProgram(STRESS);
  const { blocks, pythonOnly, representedLines } = irToBlocks(ir, { userFunctions: [], libraryFunctions: [] });
  const total = lines.filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  const registradas = new Set(pythonOnly.map((p) => p.line));

  // Toda linha que NÃO ganhou representação precisa estar registrada.
  // O inverso seria o pior defeito possível: código que some sem aviso.
  const semRastro = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const numero = index + 1;
    if (representedLines.has(numero) || registradas.has(numero)) continue;
    semRastro.push(numero);
  }
  assert.equal(semRastro.length, 0, `linhas sem bloco e sem registro: ${semRastro.join(", ")}`);
  assert.ok(blocks.length >= 8, `esperava ao menos 8 blocos de topo, veio ${blocks.length}`);
  assert.ok(total > 200, "o fixture deve ter mais de 200 linhas de código");
});

/* ================== IMPORTS: só o que o programa usa ================== */

/*
 * Regressão do `DIVERGE` do stress: o arquivo tinha
 * `from pybricks.tools import wait` e voltava com um
 * `from pybricks.robotics import DriveBase` que o autor nunca escreveu.
 *
 * A causa NÃO era o gerador de imports: `requiredImports` estava certo. A
 * causa era o CATÁLOGO — 11 blocos de movimento declaravam
 * `imports: ["DriveBase"]` só por chamar `.stop()`/`.straight()` num objeto
 * que o próprio programa já tinha construído.
 *
 * A regra: importar uma CLASSÉ é responsabilidade do bloco que a CONSTRÓI.
 * Chamar método de uma instância não importa nada — quem construiu já
 *importou. Por isso só `movement_setup` e `movement_wheel_distance` declaram
 * o import; os outros 11 dependem do construtor que estiver no programa.
 */

test("programa que não constrói DriveBase não recebe o import", () => {
  const src = "from pybricks.tools import wait\n\nwait(100)\n";
  const { blocks } = irToBlocks(parseProgram(src).ir, { userFunctions: [], libraryFunctions: [] });
  const py = generateProgram(blocks, { userFunctions: [], libraryFunctions: [] });
  assert.ok(!py.includes("robotics"), `não deveria importar robotics:\n${py}`);
  assert.match(py, /from pybricks\.tools import wait/);
});

test("só o bloco que CONSTRÓI a base declara o import", () => {
  const { blocks } = irToBlocks(
    parseProgram("from pybricks.motor import Motor\nfrom pybricks.robotics import DriveBase\n" +
      "robot = DriveBase(Motor(Port.A), Motor(Port.B), 62.4, 48)\nrobot.straight(100)\n").ir,
    { userFunctions: [], libraryFunctions: [] },
  );
  const py = generateProgram(blocks, { userFunctions: [], libraryFunctions: [] });
  assert.match(py, /from pybricks\.robotics import DriveBase/, "quem constrói precisa importar");
});

test("blocos de método não arrastam a classe para dentro", () => {
  // `robot.stop()` sozinho NÃO pode criar a necessidade de importar DriveBase.
  const { blocks } = irToBlocks(
    parseProgram("robot = motor_a\nrobot.stop()\n").ir,
    { userFunctions: [], libraryFunctions: [] },
  );
  const need = requiredImports(blocks);
  const robotics = need.get("pybricks.robotics");
  assert.ok(!robotics || !robotics.has("DriveBase"),
    `stop() não deveria exigir DriveBase, veio ${robotics && [...robotics]}`);
});

test("o stress de 229 linhas não inventa nenhum import", () => {
  const src = readFileSync(
    new URL("./fixtures/stress.py", import.meta.url), "utf8",
  );
  const { blocks } = irToBlocks(parseProgram(src).ir, { userFunctions: [], libraryFunctions: [] });
  const py = generateProgram(blocks, { userFunctions: [], libraryFunctions: [] });
  const origImports = parseProgram(src).ir.body
    .filter((n) => n.type === "importFrom" || n.type === "import")
    .map((n) => `${n.type}:${n.module ?? ""}:${(n.names ?? []).map((x) => x.name).join(",")}`)
    .sort();
  const novosImports = parseProgram(py).ir.body
    .filter((n) => n.type === "importFrom" || n.type === "import")
    .map((n) => `${n.type}:${n.module ?? ""}:${(n.names ?? []).map((x) => x.name).join(",")}`)
    .sort();
  assert.deepEqual(novosImports, origImports,
    "os imports do round-trip têm que ser os mesmos do arquivo original");
});

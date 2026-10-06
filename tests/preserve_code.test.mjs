/**
 * NENHUMA LINHA DO PROGRAMA PODE SUMIR.
 *
 * Regra do projeto: código que a IDE não sabe mostrar como bloco é
 * PRESERVADO e sinalizado, nunca apagado. Este arquivo percorre os
 * construtores que não têm bloco próprio e verifica os dois lados:
 *
 *   - o Python devolvido continua válido e com o mesmo conteúdo;
 *   - a criança recebe aviso, em vez de um programa silenciosamente
 *     incompleto na tela.
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
  let valido = true;
  try { parseProgram(saida); } catch { valido = false; }
  return { saida, valido, diag: parseProgram(saida).diagnostics.length };
};

/* ---------------- construtos sem bloco próprio ---------------- */

const PRESERVADOS = [
  ["try/except", "def g():\n    try:\n        x = 1\n    except ValueError:\n        x = 2\n"],
  ["try/except/finally", "try:\n    x = 1\nexcept E:\n    x = 2\nfinally:\n    y = 3\n"],
  ["with", "with open('a') as f:\n    print(1)\n"],
  ["with múltiplo", "with open('a') as f, open('b') as g:\n    print(1)\n"],
  ["atribuição em atributo", "def g():\n    hub.rotation_angle = 0\n"],
  ["aumento em atributo", "def g():\n    x.total += 1\n"],
  ["del", "del lista[0]\n"],
  ["global", "x = 1\ndef g():\n    global x\n    x = 2\n"],
  ["match", "match x:\n    case 1:\n        y = 1\n    case _:\n        y = 2\n"],
  ["print com vários argumentos", "print('a', 'b')\n"],
  ["print com end=", "print('a', end='')\n"],
  ["desempacotamento", "a, b = 1, 2\n"],
  ["desempacotamento de chamada", "a, b = f(1, 2)\n"],
  ["lambda", "f = lambda a: a + 1\n"],
  ["yield", "def g():\n    yield 1\n"],
  ["f-string", "x = f'{a}b'\n"],
];

for (const [nome, codigo] of PRESERVADOS) {
  test(`preserva: ${nome}`, () => {
    const { saida, valido } = roundTrip(codigo);
    assert.ok(valido, `o Python devolvido não é válido:\n${saida}`);
    // Toda palavra-chave e todo número do original aparece na saída.
    const numeros = codigo.match(/\d+/g) ?? [];
    for (const n of numeros) {
      assert.ok(saida.includes(n), `o número ${n} sumiu:\nIN:\n${codigo}\nOUT:\n${saida}`);
    }
    for (const palavra of codigo.split(/\W+/).filter((w) => w.length > 3 && !["print", "open"].includes(w))) {
      assert.ok(saida.includes(palavra), `"${palavra}" sumiu:\nIN:\n${codigo}\nOUT:\n${saida}`);
    }
  });
}

test("aumento com operador composto não gera Python inválido", () => {
  // Regressão: `x.total += 1` virava `x.total +== 1`, que não compila.
  for (const op of ["+=", "-=", "*=", "//=", "%="]) {
    const codigo = `def g():\n    x.total ${op} 1\n`;
    const { saida, valido } = roundTrip(codigo);
    assert.ok(valido, `\`${op}\` gerou Python inválido:\n${saida}`);
    assert.ok(saida.includes(op), `esperava ${op}:\n${saida}`);
    assert.ok(!saida.includes(op + "="), `operador duplicado:\n${saida}`);
  }
});

test("desempacotamento mantém os dois nomes e a tupla", () => {
  const { saida, valido } = roundTrip("a, b = 1, 2\n");
  assert.ok(valido);
  assert.match(saida, /a, b = /, `faltou o segundo alvo:\n${saida}`);
  assert.match(saida, /1/, `faltou o valor:\n${saida}`);
});

test("try preserva o except e continua compilável", () => {
  const { saida, valido } = roundTrip("def g():\n    try:\n        x = 1\n    except ValueError:\n        x = 2\n");
  assert.ok(valido, `try/except pela metade não compila:\n${saida}`);
  assert.match(saida, /except/, `o except sumiu:\n${saida}`);
});

/* ---------------- o aviso é sempre visível ---------------- */

test("código não entendido gera aviso, nunca silêncio", () => {
  // O walrus (`:=`) não é suportado pelo parser. O texto precisa ficar no
  // editor E a criança precisa de um aviso — senão ela vê um programa
  // incompleto e acredita que ele está certo.
  const sm = new SyncManager();
  sm.runPipeline("if (n := 5) > 1:\n    x = 1\n");
  assert.equal(sm.state, "error", "o estado tem que avisar que algo não foi lido");
  assert.ok(sm.diagnostics.length > 0, "sem diagnóstico a falha fica invisível");
  assert.ok(sm.diagnostics[0].cause, "o diagnóstico precisa explicar em português");
  assert.ok(sm.code.includes(":="), "o texto original não pode ser perdido");
});

test("toda linha de código não-vazia tem alguma representação", () => {
  const codigo =
    "def g():\n    try:\n        x = 1\n    except E:\n        x = 2\n" +
    "def h():\n    with open('a') as f:\n        print(1)\n";
  const { representedLines, pythonOnly } = irToBlocks(parseProgram(codigo).ir,
    { ...OPTS, sourceText: codigo });
  const relevantes = codigo.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.trim() && !/^\s*def\s/.test(l) && !/^\s*(from|import)\s/.test(l));
  for (const [linha, texto] of relevantes) {
    assert.ok(representedLines.has(linha) || pythonOnly.some((p) => p.line === linha),
      `a linha ${linha} (${texto.trim()}) não tem representação nem aviso`);
  }
});

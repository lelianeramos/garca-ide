/**
 * Sonda do pipeline: Python -> IR -> Blocos -> Python.
 * Nao altera nada. Apenas mede o comportamento REAL (linha de base).
 */
import { parseProgram } from "../../src/parser/pythonParser.js";
import { irToBlocks } from "../../src/blocks/blockFactory.js";
import { generateProgram } from "../../src/python/codeGenerator.js";
import { assertSemanticEquivalent } from "./semantic-equivalence.mjs";

const CASOS = [
  ["operador com variaveis", "correcao = erro * KP_STRAIGHT\n"],
  ["divisao por variavel",    "velocidade = distancia / 5\n"],
  ["while com abs()",         "while abs(gb.distance()) < distancia_alvo:\n    pass\n"],
  ["and curto-circuit",       "x = a < b and c > d\n"],
  ["max com builtin",         "passo = max(1, int(velocidade / 5))\n"],
  ["ternario",                "direcao = 1 if distancia >= 0 else -1\n"],
  ["aug assign",              "erro -= 360\n"],
  ["return composto",         "return progress * progress * (3 - 2 * progress)\n"],
  ["range 3 args",            "for v in range(int(velocidade), 0, -passo):\n    pass\n"],
  ["atrib parenthesizada",    "tempo = (distancia_alvo / velocidade) * 1000\n"],
  ["pybricks drive",          "gb.drive(velocidade * direcao, correcao)\n"],
  ["if/elif/else",            "if a:\n    x = 1\nelif b:\n    x = 2\nelse:\n    x = 3\n"],
];

const fmt = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : JSON.stringify(v));
const arv = (b, prof = 0) => {
  const p = "  ".repeat(prof);
  if (!b) return `${p}(vazio)`;
  const params = Object.entries(b.params ?? {}).map(([k, v]) => `${k}=${fmt(v)}`).join(" ");
  return `${p}${b.blockId} { ${params} }${b.children?.length ? "\n" + b.children.map(c => arv(c, prof + 1)).join("\n") : ""}`;
};

let ok = 0, falha = 0;
for (const [nome, src] of CASOS) {
  console.log("\n" + "=".repeat(74));
  console.log("CASO:", nome);
  console.log("PY  :", JSON.stringify(src));
  try {
    const ir = parseProgram(src);
    const { blocks, pythonOnly } = irToBlocks(ir.ir, { userFunctions: [], libraryFunctions: [] });
    console.log("BLOCOS:\n" + blocks.map(b => arv(b)).join("\n"));
    if (pythonOnly?.length) console.log("PYTHON-ONLY:", pythonOnly.length, "linha(s) ->", JSON.stringify(pythonOnly.map(p => p.text ?? p)));
    const volta = generateProgram(blocks);
    const eq = assertSemanticEquivalent(src, String(volta));
    eq.equal ? ok++ : falha++;
    console.log("PY DE VOLTA:", JSON.stringify(volta));
    console.log("SEMANTICO:", eq.equal ? "EQUIVALENTE" : `DIVERGE em ${eq.at}\n     esperado: ...${eq.expected}...\n     obtido:   ...${eq.got}...`);
  } catch (e) {
    falha++;
    console.log("ERRO:", e.message);
  }
}
console.log("\n" + "=".repeat(74));
console.log(`ROUND-TRIP: ${ok} identicos, ${falha} diferentes/erro`);

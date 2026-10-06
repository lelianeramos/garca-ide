/**
 * COBERTURA DO PROGRAMA DE STRESS (item 26 / 68).
 * Mede, por linha, se a linha virou bloco — e por que não virou.
 */
import { readFileSync } from "node:fs";
import { parseProgram } from "../../src/parser/pythonParser.js";
import { irToBlocks, expressionToBlock } from "../../src/blocks/blockFactory.js";
import { generateProgram } from "../../src/python/codeGenerator.js";
import { assertSemanticEquivalent } from "./semantic-equivalence.mjs";

const src = readFileSync(new URL("../../tests/fixtures/stress.py", import.meta.url), "utf8");
const { ir, lines, diagnostics, valid } = parseProgram(src);
const total = lines.filter((l) => l.trim() && !l.trim().startsWith("#")).length;

const { blocks, pythonOnly, representedLines } = irToBlocks(ir, { userFunctions: [], libraryFunctions: [], sourceText: src });

/*
 * Uma linha em branco NÃO é Python que ficou de fora — é espaço vazio no
 * arquivo. Contá-la como "só em Python" fazia a cobertura parecer incompleta
 * quando, na verdade, o arquivo inteiro estava representado. Aqui removemos
 * só o que não tem texto: a lista decobertura continua honesta.
 */
const linhas = src.split("\n");
const pythonOnlyReal = pythonOnly.filter((item) => (linhas[item.line - 1] ?? "").trim() !== "");
const cover = representedLines.size;
const pct = Math.round((cover / total) * 100);

console.log("=".repeat(72));
console.log("PROGRAMA DE STRESS — COBERTURA VISUAL");
console.log("=".repeat(72));
console.log(`linhas com código      : ${total}`);
console.log(`linhas com bloco       : ${cover}  (${pct}%)`);
console.log(`linhas python-only     : ${total - cover}`);
console.log(`blocos gerados         : ${blocks.length}`);
console.log(`parse válido           : ${valid}  | diagnósticos: ${diagnostics.length}`);

// variáveis exigidas pelo item 9
const REQUIRED = ["KP_STRAIGHT","KP_TURN","KP_CURVE","error","heading_alvo","direcao","distancia_alvo","erro","correcao","passo","velocidade_atual","heading_final","tempo_estimado_ms","timeout_ms","max_loops_curva","zona_frenagem","velocidade_minima","contador_loops","distancia_atual","progresso","progresso_efetivo","distancia_restante","fator","velocidade_final","contador_ajuste"];
const seen = new Set();
const walkExpr = (n) => {
  if (!n || typeof n !== "object") return;
  if (n.type === "variableReference") seen.add(n.name);
  for (const v of Object.values(n)) walkExpr(v);
};
walkExpr(ir);
const faltando = REQUIRED.filter((v) => !seen.has(v));
console.log(`\nvariáveis do item 9    : ${REQUIRED.length - faltando.length}/${REQUIRED.length} aparecem na IR`);
if (faltando.length) console.log(`  ausentes: ${faltando.join(", ")}`);

// round-trip completo
const volta = generateProgram(blocks);
const eq = assertSemanticEquivalent(src, volta);
console.log(`\nROUND-TRIP do arquivo inteiro: ${eq.equal ? "SEMANTICAMENTE EQUIVALENTE" : "DIVERGE"}`);
if (!eq.equal) console.log(`  em ${eq.at}\n  esperado: ...${eq.expected}...\n  obtido:   ...${eq.got}...`);

// onde ainda falta
if (pythonOnlyReal.length) {
  console.log(`\nLINHAS AINDA SÓ EM PYTHON (${pythonOnlyReal.length}):`);
  const porLinha = new Map();
  for (const item of pythonOnlyReal) porLinha.set(item.line, item.text);
  for (const [line, text] of [...porLinha.entries()].sort((a,b)=>a[0]-b[0]).slice(0, 25)) {
    console.log(`  ${String(line).padStart(3)}: ${String(text).slice(0, 90)}`);
  }
  if (porLinha.size > 25) console.log(`  ... e mais ${porLinha.size - 25}`);
}

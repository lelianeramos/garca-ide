/**
 * EQUIVALÊNCIA SEMÂNTICA — item 58.
 *
 * Comparar texto é inútil: `erro * KP` e `(erro * KP)` são o mesmo
 * programa, e `x = (a + b)` vs `x = a + b` também. O que importa é se a
 * ÁRVORE é a mesma. Este módulo normaliza a IR (descarta parênteses que
 * não mudam nada, normaliza literais) e compara.
 */
import { parseProgram } from "../../src/parser/pythonParser.js";

/** Remove tudo que é apresentação: parênteses redundantes, espaços. */
function normalize(node) {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) return node.map(normalize);
  if (typeof node !== "object") return node;

  const out = {};
  for (const key of Object.keys(node).sort()) {
    // `block: true` marca "este no tem um corpo". Depois de normalizado o
    // corpo esta dentro, e o marcador em si nao diz nada sobre o programa.
    if (["source", "rawText", "line", "absorbedByChain", "block"].includes(key)) continue;
    /*
      `kind` num laço (`for` / `while`) é SEMÂNTICO e precisa ser comparado.
      `kind` numa condição (`if` / `elif`) é só Representação: depois de
      normalizado, uma cadeia if/elif/else é UM só construto, e o Python
      regerado é um `if` só. Comparar os dois separadamente acusaria
      divergência onde o programa é idêntico.
    */
    if (key === "kind" && node.type === "condition") {
      out.kind = "if";
      continue;
    }
    out[key] = normalize(node[key]);
  }
  return out;
}

/** Achata astatements para comparar só o que importa. */
export function semanticShape(code) {
  const { ir } = parseProgram(code);
  return JSON.stringify(normalize(ir));
}

/**
 * Dois programas são equivalentes quando, reparseados, dão a mesma
 * árvore. `1 + 2 * 3` e `1 + (2 * 3)` batem; `1 + 2 * 3` e `(1 + 2) * 3`
 * não — que é exatamente a distinção que importa.
 */
export function assertSemanticEquivalent(a, b) {
  const left = semanticShape(a);
  const right = semanticShape(b);
  if (left === right) return { equal: true };
  // Diagnóstico do primeiro ponto de divergência.
  const l = left, r = right;
  let i = 0;
  while (i < l.length && i < r.length && l[i] === r[i]) i += 1;
  return {
    equal: false,
    at: i,
    expected: l.slice(Math.max(0, i - 40), i + 40),
    got: r.slice(Math.max(0, i - 40), i + 40),
  };
}

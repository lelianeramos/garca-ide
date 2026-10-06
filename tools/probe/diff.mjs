/** Mostra o caminho exato da primeira diferença entre duas árvores. */
import { parseProgram } from "../../src/parser/pythonParser.js";

function normalize(node) {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) return node.map(normalize);
  if (typeof node !== "object") return node;
  const out = {};
  for (const key of Object.keys(node).sort()) {
    /*
      Campos que NÃO descrevem o programa:

        source/rawText/line/indent — posição de origem;
        absorbedByChain           — marcação interna do conversor;
        block                     — diz que o nó TEM um corpo, mas depois
                                    de normalizado o corpo já está dentro,
                                    e o marcador nada acrescenta;
        kind (em condição)         — `if` vs `elif` é representação: uma
                                    cadeia if/elif/else normalizada é um
                                    único construto.
    */
    if (["source", "rawText", "line", "absorbedByChain", "indent", "block"].includes(key)) continue;
    if (key === "kind" && node.type === "condition") { out.kind = "if"; continue; }
    out[key] = normalize(node[key]);
  }
  return out;
}

function walk(a, b, path) {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return { path, esperado: a, obtido: b };
  }
  if (Array.isArray(a) !== Array.isArray(b)) return { path, esperado: "[array]", obtido: typeof b };
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    const r = walk(a[k], b[k], `${path}.${k}`);
    if (r) return r;
  }
  return { path, esperado: a, obtido: b };
}

export function firstDifference(codeA, codeB) {
  const a = normalize(parseProgram(codeA).ir);
  const b = normalize(parseProgram(codeB).ir);
  return walk(a, b, "$");
}

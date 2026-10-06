/**
 * CODE GENERATOR — BLOCOS -> PYTHON
 * ---------------------------------
 * Parte 14.7 (geração) + Parte 13.4 (patch por SPAN, sem replace cego).
 *
 * Princípios inegociáveis:
 *   N04 — nunca apagar/substituir Python válido do usuário.
 *   B08 — imports são conteúdo do arquivo: só ACRESCENTA o que falta e avisa.
 *         Nunca restaura um import que o usuário apagou de propósito.
 *   14.4 — linhas sem representação visual permanecem intactas.
 */

import { BLOCK_BY_ID } from "../blocks/blockCatalog.js";
import { resolveParams, resolveValue } from "../blocks/socket.js";
import { CLASS_MODULE, IMPORTABLE } from "../pybricks/apiRegistry.js";

const INDENT = "    ";

/* ------------------------------------------------------------------ */
/* Bloco -> Python                                                     */
/* ------------------------------------------------------------------ */

/**
 * Gera o Python de um bloco (e dos seus filhos, no caso de blocos em C).
 * @param {object} block
 * @param {number} depth nível de indentação
 * @returns {string[]} linhas
 */
export function blockToLines(block, depth = 0) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  if (!spec) return [];

  const pad = INDENT.repeat(depth);

  /*
    SOCKETS (src/blocks/socket.js)

    Antes: `spec.py(block.params)` recebia os params crus. Um param que
    guardava um bloco aninhado virava "[object Object]" no Python.

    Agora os blocos aninhados são resolvidos para o SEU Python antes de a
    função `py` do bloco pai ser chamada. O pai continua unaware: ele só
    interpola strings, como sempre fez. É por isso que os 134 blocos do
    catálogo ganham suporte a expressões encaixadas sem nenhuma reescrita.
  */
  const raw = String(spec.py(resolveParams(block, (child) => blockToPython(child))) ?? "");
  const head = raw.split("\n").map((line) => (line.trim() ? pad + line : "")).join("\n").split("\n");

  const out = [...head];

  /*
    CADEIA `if` / `elif` / `else`.

    O bloco guarda `branches` com a condição e o corpo de CADA ramo. Sem
    isto, um `if/elif/else` do Python voltava como vários `if` separados —
    que não é o mesmo programa: o `else` compartilhado mudaria de ramo e o
    `elif` perderia a guarda.

    O `if ...:` já foi emitido por `spec.py()` acima. Aqui entram os corpos
    na ordem certa: corpo do `if`, depois cada `elif` com seu corpo, e só
    então o `else`. Emitir os `elif` ANTES do corpo do `if` — o que acontecia
    na primeira versão deste código — embaralhava a saída.
  */
  if (Array.isArray(block.branches) && block.branches.length > 1) {
    for (const [index, branch] of block.branches.entries()) {
      if (index > 0) out.push(`${pad}elif ${branchText(branch.condition)}:`);
      const body = branch.children || [];
      if (body.length === 0) out.push(`${pad}${INDENT}pass`);
      for (const child of body) out.push(...blockToLines(child, depth + 1));
    }
    if (Array.isArray(block.elseChildren) && block.elseChildren.length > 0) {
      out.push(`${pad}else:`);
      for (const child of block.elseChildren) out.push(...blockToLines(child, depth + 1));
    }
    return out;
  }

  const hasBody = Boolean(spec.block);
  if (hasBody) {
    const children = block.children || [];
    if (children.length === 0) out.push(`${pad}${INDENT}pass`);
    for (const child of children) out.push(...blockToLines(child, depth + 1));

    if (spec.elseBranch && Array.isArray(block.elseChildren) && block.elseChildren.length > 0) {
      out.push(`${pad}else:`);
      for (const child of block.elseChildren) out.push(...blockToLines(child, depth + 1));
    }
  }

  return out;
}

/**
 * Texto de uma condição já resolvida: um socket pode conter um bloco
 * aninhado, um valor cru ou uma string vinda do Python.
 */
function branchText(condition) {
  const value = resolveValue(condition, (block) => blockToPython(block));
  const text = String(value ?? "").trim();
  return text || "True";
}

export function blockToPython(block, depth = 0) {
  return blockToLines(block, depth).join("\n");
}

/**
 * O bloco "quando o programa iniciar" é a função `main()` do Pybricks.
 * A checagem vem da ESPECIFICAÇÃO do bloco (`isMain`), e não do id solto,
 * para que o nome do bloco possa mudar sem quebrar a geração.
 */
export function isMainBlock(block) {
  return BLOCK_BY_ID.get(block?.blockId)?.isMain === true;
}

/* ------------------------------------------------------------------ */
/* Imports necessários                                                 */
/* ------------------------------------------------------------------ */

/**
 * Coleta os símbolos que os blocos exigem e agrupa por módulo.
 * @returns {Map<string, Set<string>>} módulo -> símbolos
 */
export function requiredImports(blocks) {
  const needed = new Map();

  const add = (symbol, moduleName) => {
    if (!symbol || !moduleName) return;
    if (!needed.has(moduleName)) needed.set(moduleName, new Set());
    needed.get(moduleName).add(symbol);
  };

  const visit = (list) => {
    for (const block of list || []) {
      const spec = BLOCK_BY_ID.get(block.blockId);
      if (!spec) continue;
      // Cada símbolo é resolvido pelo SEU módulo (CLASS_MODULE). Antes, um
      // símbolo sem entrada caía no primeiro módulo da lista e gerava
      // "from pybricks.robotics import Port" — que nem existe.
      for (const symbol of spec.imports || []) {
        const moduleName = CLASS_MODULE[symbol];
        if (moduleName) add(symbol, moduleName);
        else for (const candidate of spec.modules || []) add(symbol, candidate);
      }
      // Função de um módulo do projeto: import real, escrito pelo usuário.
      if (spec.dynamicModule && block.params?.module) {
        const functionName = block.params.function ?? block.params.name;
        if (functionName) add(functionName, block.params.module);
      }
      if (block.children?.length) visit(block.children);
      if (block.elseChildren?.length) visit(block.elseChildren);
    }
  };

  visit(blocks);

  // `randint` vem de `random` (builtin do MicroPython) e `remove_once` já
  // está no módulo certo: nunca realoca símbolos entre módulos canônicos.
  for (const [moduleName, symbols] of needed.entries()) {
    if (symbols.has("randint") && moduleName !== "random") symbols.delete("randint");
  }

  return needed;
}

/** Formata as linhas de import, na ordem canônica. */
export function formatImports(needed, { includeRandom = false } = {}) {
  const order = [
    "pybricks.hubs", "pybricks.pupdevices", "pybricks.iodevices",
    "pybricks.parameters", "pybricks.robotics", "pybricks.tools",
    "pybricks.messaging",
  ];
  const lines = [];
  for (const moduleName of order) {
    const symbols = needed.get(moduleName);
    if (!symbols || symbols.size === 0) continue;
    const sorted = [...symbols].sort(compareImportOrder(moduleName));
    lines.push(`from ${moduleName} import ${sorted.join(", ")}`);
  }
  // módulos não-Pybricks (bibliotecas da equipe, random, etc.)
  for (const [moduleName, symbols] of needed.entries()) {
    if (order.includes(moduleName) || !symbols || symbols.size === 0) continue;
    lines.push(`from ${moduleName} import ${[...symbols].sort().join(", ")}`);
  }
  if (includeRandom) lines.push("from random import randint");
  return lines;
}

function compareImportOrder(moduleName) {
  const canonical = IMPORTABLE[moduleName] || [];
  return (a, b) => {
    const ia = canonical.indexOf(a); const ib = canonical.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  };
}

/** Detecta os imports que já existem no texto (para não duplicar — B08). */
export function existingImports(code) {
  const found = new Map();
  const lines = String(code ?? "").split("\n");
  lines.forEach((line, index) => {
    const from = /^\s*from\s+([\w.]+)\s+import\s+(.+?)\s*$/.exec(line);
    if (from) {
      const symbols = from[2].replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      found.set(from[1], { symbols, line: index + 1 });
      return;
    }
    const plain = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)\s*$/.exec(line);
    if (plain) {
      for (const moduleName of plain[1].split(",").map((s) => s.trim())) {
        found.set(moduleName, { symbols: [], line: index + 1, plain: true });
      }
    }
  });
  return found;
}

/* ------------------------------------------------------------------ */
/* Programa completo                                                   */
/* ------------------------------------------------------------------ */

/**
 * Gera o programa Python inteiro a partir dos blocos.
 *
 * @param {Array} blocks
 * @param {object} options
 *   preserveHeader  mantém imports/inicializações que o usuário já escreveu (B08)
 *   comments        inclui comentários didáticos em pt-BR (Parte 14.7)
 *   preserved       trechos somente-Python a reinserir na posição original
 */
export function generateProgram(blocks, options = {}) {
  const {
    preserveHeader = true,
    comments = true,
    preserved = [],
    existingCode = "",
  } = options;

  const body = [];
  let hasMain = false;
  for (const block of blocks || []) {
    if (comments && shouldComment(block, body)) {
      body.push(describeBlock(block));
    }
    body.push(...blockToLines(block, 0));
    body.push("");
    if (isMainBlock(block)) hasMain = true;
  }

  /*
   * O HUB só executa o programa quando `main()` é chamada. O bloco
   * "quando o programa iniciar" vira a função `main()`; a chamada no fim do
   * arquivo é o que realmente faz o robô andar. Sem esta linha o código era
   * sintaticamente válido e não fazia NADA.
   */
  if (hasMain) {
    while (body.length && !body[body.length - 1].trim()) body.pop();
    body.push("", "main()");
  }

  const needed = requiredImports(blocks || []);
  const usesRandom = JSON.stringify(blocks || []).includes("op_random");
  const importLines = formatImports(needed, { includeRandom: usesRandom });

  let header = [];
  if (preserveHeader && existingCode) {
    // B08: NÃO regenera o cabeçalho. Só acrescenta o que falta.
    const existing = existingImports(existingCode);
    const added = [];
    for (const line of importLines) {
      const match = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(line);
      if (!match) { if (!existingCode.includes(line)) added.push(line); continue; }
      const [, moduleName, symbols] = match;
      const already = existing.get(moduleName);
      if (!already) { added.push(line); continue; }
      const missing = symbols.split(", ").filter((symbol) => !already.symbols.includes(symbol));
      if (missing.length) added.push(`from ${moduleName} import ${missing.join(", ")}`);
    }
    header = added;
  } else {
    header = importLines;
  }

  const parts = [];
  if (header.length) parts.push(...header, "");
  parts.push(...trimBlankEdges(body));

  // 14.4 — trechos somente-Python voltam para o fim, intactos
  const preservedText = preserved
    .map((entry) => (typeof entry === "string" ? entry : entry.text))
    .filter((text) => text && text.trim());
  if (preservedText.length) {
    parts.push("", "# Trechos mantidos somente em Python", ...preservedText);
  }

  return normalize(parts.join("\n"));
}

function trimBlankEdges(lines) {
  const copy = [...lines];
  while (copy.length && !copy[0].trim()) copy.shift();
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
  return copy;
}

function normalize(code) {
  return String(code)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n*$/, "\n");
}

function shouldComment(block, body) {
  if (body.length === 0) return false;
  const last = body[body.length - 1];
  return Boolean(last) && last.trim() !== "" && !last.trim().startsWith("#");
}

const DESCRIBERS = {
  hub_setup: () => "# 1. Inicializa o HUB",
  motor_setup: (p) => `# Motor conectado à porta ${p.port}`,
  movement_setup: () => "# Base de movimento (DriveBase)",
  sensor_setup_color: (p) => `# Sensor de cor na porta ${p.port}`,
  sensor_setup_distance: (p) => `# Sensor de distância na porta ${p.port}`,
  sensor_setup_force: (p) => `# Sensor de força na porta ${p.port}`,
  hub_timer_setup: () => "# Cronômetro",
};

function describeBlock(block) {
  const describe = DESCRIBERS[block.blockId];
  return describe ? describe(block.params) : "";
}

/* ------------------------------------------------------------------ */
/* Patch cirúrgico por SPAN (Parte 13.4 / B06)                         */
/* ------------------------------------------------------------------ */

/** Converte {linha, coluna} 1-based em índice absoluto no texto. */
export function offsetOf(code, line, column) {
  const lines = String(code).split("\n");
  let offset = 0;
  for (let index = 0; index < Math.min(line - 1, lines.length); index += 1) {
    offset += lines[index].length + 1;
  }
  return offset + Math.max(0, (column ?? 1) - 1);
}

/** Converte índice absoluto em {line, column} 1-based. */
export function positionOf(code, offset) {
  const before = String(code).slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Substitui exatamente o intervalo [start, end) do texto.
 * Nunca usa find/replace cego (N07).
 */
export function replaceSpan(code, span, replacement) {
  const start = offsetOf(code, span.startLine, span.startColumn);
  const end = offsetOf(code, span.endLine, span.endColumn);
  const text = String(code);
  return text.slice(0, start) + replacement + text.slice(Math.max(start, end));
}

/**
 * Editou um bloco -> regenera só as linhas dele e aplica no Python.
 * Preserva indentação original e todo o resto do arquivo.
 */
export function patchBlock(code, block) {
  if (!block?.source) return { code, changed: false };
  const lines = String(code).split("\n");
  const startLine = block.source.startLine;
  const endLine = block.source.endLine ?? startLine;
  if (startLine < 1 || endLine > lines.length) return { code, changed: false };

  const original = lines[startLine - 1];
  const indent = /^\s*/.exec(original)?.[0] ?? "";
  const depth = Math.round(indent.replace(/\t/g, "    ").length / 4);

  const generated = blockToLines(block, depth);
  const next = [...lines.slice(0, startLine - 1), ...generated, ...lines.slice(endLine)];
  const result = normalize(next.join("\n"));
  return { code: result, changed: result !== normalize(String(code).replace(/\n*$/, "\n")) };
}

/** Remove as linhas de um bloco (Backspace/Delete — B07). */
export function removeBlock(code, block) {
  if (!block?.source) return { code, changed: false };
  const lines = String(code).split("\n");
  const startLine = block.source.startLine;
  const endLine = block.source.endLine ?? startLine;
  if (startLine < 1 || endLine > lines.length) return { code, changed: false };
  const next = [...lines.slice(0, startLine - 1), ...lines.slice(endLine)];
  return { code: normalize(next.join("\n")), changed: true };
}

/**
 * Insere um bloco novo no arquivo.
 *
 * @param {string} code
 * @param {object} block
 * @param {number|string|null} after  'top' (logo abaixo dos imports, para blocos
 *        de evento), 'bottom' (fim do arquivo) ou um número de linha.
 *        Blocos de evento têm SEMPRE que ficar no topo do programa: um
 *        "quando o programa iniciar" embaixo de outros comandos nunca dispara.
 */
/**
 * Descobre o intervalo de linhas que COMPARTILHA um nível de indentação.
 * É o que permite inserir "dentro" de um `def`, `if`, `for`… sem reescrever
 * o arquivo inteiro.
 *
 * @returns {{start:number,end:number}|null} [start, end) em índices de `lines`
 */
function indentedRange(lines, from) {
  const baseIndent = (/^(\s*)/.exec(lines[from])?.[1] ?? "").length;
  let end = from;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") { end += 1; continue; }
    const indent = (/^(\s*)/.exec(line)?.[1] ?? "").length;
    if (indent <= baseIndent && end > from) break;
    end += 1;
  }
  // linhas em branco no fim não contam como parte do corpo
  while (end > from + 1 && lines[end - 1].trim() === "") end -= 1;
  return { start: from, end };
}

/**
 * Encontra a linha do `def main():` e devolve o ponto de inserção DENTRO
 * dele, já com a indentação certa. `null` quando o programa não tem main.
 */
/** Índice da última linha com conteúdo (-1 quando o arquivo está vazio). */
function lastNonEmptyLine(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) return index;
  }
  return -1;
}

function insertPointInsideMain(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^def\s+main\s*\([^)]*\)\s*:\s*$/.test(lines[index])) continue;
    const range = indentedRange(lines, index + 1);
    // o corpo termina na última linha não-vazia antes de sair do bloco
    let bodyEnd = range.end;
    while (bodyEnd > index + 1 && lines[bodyEnd - 1].trim() === "") bodyEnd -= 1;
    const onlyPass = bodyEnd === index + 1 && /^(\s*)pass\s*$/.test(lines[index + 1] ?? "");
    if (onlyPass) return { line: index + 1, replace: [index + 1, index + 2] };
    return { line: bodyEnd, replace: null };
  }
  return null;
}

/** Garante que exista um `main()` chamável no fim do arquivo. */
function ensureMainCall(lines) {
  for (const line of lines) {
    if (/^main\s*\(\s*\)\s*$/.test(line.trim()) && !/^\s/.test(line)) return lines;
  }
  return [...trimBlankEdges(lines), "", "main()"];
}

/**
 * Insere um bloco DENTRO de outro, no fim do corpo dele.
 *
 * O corpo do pai é delimitado pela indentação, não por uma contagem de linhas
 * guardada em lugar nenhum — o Python é a fonte da verdade, e isso continua
 * valendo depois de o usuário editar o texto à mão.
 *
 * @param {string} code
 * @param {object} block bloco a inserir
 * @param {string} parentBlockId id do bloco pai (tem `source.startLine`)
 */
export function insertIntoBlock(code, block, parentBlockId) {
  const source = String(code ?? "");
  const lines = source.replace(/\n+$/, "").split("\n");
  const parentLine = parentSourceLine(code, parentBlockId);
  if (parentLine === null) return { code: source, changed: false };

  const header = lines[parentLine - 1];
  if (header === undefined) return { code: source, changed: false };

  const indentUnit = detectIndentUnit(lines);
  const bodyIndent = (/^(\s*)/.exec(header)?.[1] ?? "") + indentUnit;
  const range = indentedRange(lines, parentLine);

  let bodyEnd = range.end;
  while (bodyEnd > parentLine && lines[bodyEnd - 1].trim() === "") bodyEnd -= 1;

  // corpo vazio (só `pass`): substitui o `pass` pelo bloco real
  if (bodyEnd === parentLine + 1 && /^(\s*)pass\s*$/.test(lines[parentLine] ?? "")) {
    const generated = blockToLines(block, 0).map((line) => (line ? bodyIndent + line : line));
    lines.splice(parentLine, 1, ...generated);
    return { code: normalize(lines.join("\n")), changed: true };
  }

  const generated = blockToLines(block, 0).map((line) => (line ? bodyIndent + line : line));
  if (bodyEnd < lines.length && lines[bodyEnd]?.trim() !== "") generated.unshift("");
  lines.splice(bodyEnd, 0, ...generated);
  return { code: normalize(lines.join("\n")), changed: true };
}

/** Descobre a indentação usada no arquivo (4 espaços, tab, etc.). */
function detectIndentUnit(lines) {
  for (const line of lines) {
    const match = /^(\t+| +)\S/.exec(line);
    if (match) return match[1];
  }
  return INDENT;
}

/**
 * Acha a linha 1-based de um bloco pelo seu span, andando pelo texto.
 * `parentBlockId` já vem com a linha pronta nos casos normais; o fallback por
 * nome de função cobre o chapéu do programa recem-inserido.
 */
function parentSourceLine(code, parentBlockId) {
  if (typeof parentBlockId === "number") return parentBlockId;
  const direct = /^(\d+)$/.exec(String(parentBlockId ?? ""));
  if (direct) return Number(direct[1]);
  const lines = String(code ?? "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (/^def\s+main\s*\(\s*\)\s*:\s*$/.test(lines[index])) return index + 1;
  }
  return null;
}

export function insertBlock(code, block, after = "bottom") {
  let lines = String(code ?? "").replace(/\n+$/, "").split("\n");
  const generated = blockToLines(block, 0);
  if (!generated.length) return { code: String(code ?? ""), changed: false };

  if (isMainBlock(block)) {
    // O chapéu entra logo abaixo dos imports, com corpo próprio.
    const position = lastImportLine(lines);
    if (lines[position]?.trim() !== "") lines.splice(position, 0, "");
    lines.splice(position + (lines[position]?.trim() === "" ? 1 : 0), 0, ...generated);
    lines = ensureMainCall(lines);
    return { code: normalize(lines.join("\n")), changed: true };
  }

  if (after === "top") {
    const position = lastImportLine(lines);
    if (lines[position]?.trim() !== "") lines.splice(position, 0, "");
  } else if (after === "bottom" || after === null || after === undefined) {
    /*
     * "Fim do programa" = dentro do main(), quando ele existe. Sem isso o
     * bloco caía depois do `main()` e nunca era executado.
     *
     * A indentação do corpo vem do próprio arquivo: o bloco é escrito com a
     * mesma unit de indentação que o `def main():` já usa.
     */
    const inside = insertPointInsideMain(lines);
    if (inside) {
      const mainIndex = lines.findIndex((l) => /^def\s+main\s*\(\s*\)\s*:\s*$/.test(l));
      const indent = (/^(\s*)/.exec(lines[mainIndex] ?? "")?.[1] ?? "") + detectIndentUnit(lines);
      const indented = generated.map((line) => (line ? indent + line : line));
      const at = inside.replace ? inside.replace[0] : inside.line;
      const end = inside.replace ? inside.replace[1] : at;
      lines.splice(at, end - at, ...indented);
      lines = ensureMainCall(lines);
      return { code: normalize(lines.join("\n")), changed: true };
    }
    /*
     * NÃO EXISTE `def main()` NO ARQUIVO.
     *
     * O caminho antigo devolvia `changed: false` aqui — ou seja, o bloco que
     * a criança acabou de clicar na paleta era DESCARTADO, e o único efeito
     * visível era um `main()` órfão aparecendo no fim do arquivo. Na tela
     * parecia que "inserir bloco não funciona", e era exatamente isso.
     *
     * Agora o bloco é escrito no fim do código de verdade, e o `main()` é
     * adicionado só SE o arquivo realmente precisar dele. Um programa com
     * código solto (sem `def main()`) continua solto, que é como a criança
     * escreveu.
     */
    const at = lastNonEmptyLine(lines);
    lines = [...lines.slice(0, at + 1), ...generated, ...lines.slice(at + 1)];
    return { code: normalize(lines.join("\n")), changed: true };
  } else {
    const position = Math.max(0, Math.min(Number(after) || 0, lines.length));
    lines = [...lines.slice(0, position), ...generated, ...lines.slice(position)];
  }

  return { code: normalize(lines.join("\n")), changed: true };
}

/**
 * Garante que os imports exigidos pelos blocos existem no arquivo.
 * Retorna também a lista do que foi acrescentado (aviso no terminal — B08).
 */
export function ensureImports(code, blocks) {
  const needed = requiredImports(blocks || []);
  const usesRandom = (blocks || []).some((block) => block.blockId === "op_random");
  const required = formatImports(needed, { includeRandom: usesRandom });
  const existing = existingImports(code);
  const added = [];
  const lines = String(code).split("\n");

  for (const line of required) {
    const match = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(line);
    if (!match) continue;
    const [, moduleName, symbols] = match;
    const already = existing.get(moduleName);

    if (!already) {
      added.push(...symbols.split(", "));
      const insertAt = lastImportLine(lines);
      lines.splice(insertAt, 0, line);
      existing.set(moduleName, { symbols: symbols.split(", "), line: insertAt + 1 });
      continue;
    }
    if (already.plain) continue;
    const missing = symbols.split(", ").filter((symbol) => !already.symbols.includes(symbol));
    if (!missing.length) continue;
    added.push(...missing);
    lines[already.line - 1] = `from ${moduleName} import ${[...already.symbols, ...missing].join(", ")}`;
    already.symbols.push(...missing);
  }

  return { code: lines.join("\n"), added };
}

function lastImportLine(lines) {
  let last = 0;
  lines.forEach((line, index) => {
    if (/^\s*(from\s+[\w.]+\s+import|import\s+[\w.]+)/.test(line)) last = index + 1;
  });
  return last;
}

export default generateProgram;

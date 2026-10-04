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
  const raw = String(spec.py(block.params) ?? "");
  const head = raw.split("\n").map((line) => (line.trim() ? pad + line : "")).join("\n").split("\n");

  const out = [...head];

  const hasBody = Boolean(spec.block);
  if (hasBody) {
    const children = block.children || [];
    if (children.length === 0) out.push(`${pad}${INDENT}pass`);
    for (const child of children) out.push(...blockToLines(child, depth + 1));

    if (spec.elseBranch && Array.isArray(block.elseChildren)) {
      out.push(`${pad}else:`);
      if (block.elseChildren.length === 0) out.push(`${pad}${INDENT}pass`);
      for (const child of block.elseChildren) out.push(...blockToLines(child, depth + 1));
    }
  }

  return out;
}

export function blockToPython(block, depth = 0) {
  return blockToLines(block, depth).join("\n");
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
      for (const symbol of spec.imports || []) {
        const moduleName = spec.modules?.[0];
        add(symbol, CLASS_MODULE[symbol] ?? moduleName);
      }
      // 11.16: bloco de biblioteca importa a função do módulo do VFS
      if (spec.dynamicModule && block.params?.module && block.params?.name) {
        add(block.params.name, block.params.module);
      }
      // símbolos extras declarados módulo a módulo
      for (const moduleName of spec.modules || []) {
        for (const symbol of spec.imports || []) {
          if ((IMPORTABLE[moduleName] || []).includes(symbol)) add(symbol, moduleName);
        }
      }
      if (block.children?.length) visit(block.children);
      if (block.elseChildren?.length) visit(block.elseChildren);
    }
  };

  visit(blocks);

  // randint vem de random (builtin MicroPython) — tratado à parte
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
  for (const block of blocks || []) {
    if (comments && shouldComment(block, body)) {
      body.push(describeBlock(block));
    }
    body.push(...blockToLines(block, 0));
    body.push("");
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
 * Insere um bloco novo logo após a linha `afterLine` (ou no fim do arquivo).
 * Usado ao arrastar um bloco da biblioteca para o canvas.
 */
export function insertBlock(code, block, afterLine = null) {
  const lines = String(code ?? "").replace(/\n+$/, "").split("\n");
  const generated = blockToLines(block, 0);
  const position = afterLine === null || afterLine > lines.length ? lines.length : afterLine;
  const next = [...lines.slice(0, position), ...generated, ...lines.slice(position)];
  return { code: normalize(next.join("\n")), changed: true };
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

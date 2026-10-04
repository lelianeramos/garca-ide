/**
 * EDITOR PYTHON — GARÇA DE BOTAS CODE STUDIO
 * ------------------------------------------
 * Parte 15: recursos PASSIVOS obrigatórios. Nenhum deles vira botão (N09).
 *
 *   realce de sintaxe · autocomplete · indentação automática ·
 *   fechamento automático de parênteses/aspas · sublinhado de erro ·
 *   documentação ao passar o mouse · numeração de linhas ·
 *   destaque da linha atual · régua de diagnósticos
 *
 * CORREÇÃO DO BUG DOS NÚMEROS DE LINHA CONCATENADOS:
 *   cada número é gerado como um elemento de bloco próprio (.ln), com altura
 *   fixa idêntica à linha do editor (20px), e o régua é deslocada por
 *   transform:translateY(-scrollTop) para acompanhar a rolagem do textarea.
 *   Antes o conteúdo era montado como texto corrido dentro de um contêiner
 *   com white-space:pre — sem quebras reais, os números se emendavam
 *   ("123456..."). Agora há um nó por linha, então é impossível concatenar.
 */

import {
  PYBRICKS_API, MODULES, IMPORTABLE, PYTHON_KEYWORDS, BUILTINS,
  membersOf, membersOfChain, resolve as resolveApi, tail,
} from "../pybricks/apiRegistry.js";
import { tokenizeLine } from "../parser/pythonParser.js";

export const LINE_HEIGHT = 20;
const TAB = "    ";

/* ------------------------------------------------------------------ */
/* Numeração de linhas (bug corrigido)                                 */
/* ------------------------------------------------------------------ */

/**
 * Gera a régua de números. Um <div class="ln"> por linha — nunca texto corrido.
 * @param {number} count
 * @param {number} activeLine linha do cursor (1-based) — recebe destaque
 * @param {Array<number>} errorLines linhas com diagnóstico
 */
export function renderLineNumbers(count, activeLine = 0, errorLines = []) {
  const errors = new Set(errorLines);
  const fragment = document.createDocumentFragment();
  const total = Math.max(1, count);

  for (let line = 1; line <= total; line += 1) {
    const element = document.createElement("div");
    element.className = "ln";
    if (line === activeLine) element.classList.add("ln-active");
    if (errors.has(line)) element.classList.add("ln-error");
    element.textContent = String(line);
    element.dataset.line = String(line);
    fragment.appendChild(element);
  }
  return fragment;
}

/** Alinha a régua e o realce com a rolagem do textarea. */
export function syncScroll(textarea, gutter, highlight) {
  const top = textarea.scrollTop;
  const left = textarea.scrollLeft;
  if (gutter) gutter.style.transform = `translateY(${-top}px)`;
  if (highlight) {
    highlight.scrollTop = top;
    highlight.scrollLeft = left;
  }
}

/* ------------------------------------------------------------------ */
/* Realce de sintaxe (Parte 15.5)                                      */
/* ------------------------------------------------------------------ */

const KEYWORD_TOKENS = new Set(PYTHON_KEYWORDS);

const KNOWN_CLASSES = new Set(
  Object.values(IMPORTABLE).flat().filter((name) => /^[A-Z]/.test(name)),
);

const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>]/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
);

/**
 * Realça UMA linha. Devolve HTML seguro.
 * Paleta da Parte 15.5 via classes .tok-* já definidas no CSS.
 */
export function highlightLine(text) {
  if (!text.trim()) return "";
  const { tokens } = tokenizeLine(text);
  let html = "";
  let cursor = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.start > cursor) html += escapeHtml(text.slice(cursor, token.start));

    let className = "";
    if (token.type === "comment") className = "tok-comment";
    else if (token.type === "string") className = "tok-string";
    else if (token.type === "number") className = "tok-number";
    else if (token.type === "keyword") className = "tok-key";
    else if (token.type === "name") {
      const next = tokens[index + 1];
      const previous = tokens[index - 1];
      if (KEYWORD_TOKENS.has(token.value)) className = "tok-key";
      else if (KNOWN_CLASSES.has(token.value)) className = "tok-class";
      else if (next?.value === "(") className = "tok-fn";
      else if (previous?.value === "def" || previous?.value === "class") className = "tok-fn";
      else if (token.value === token.value.toUpperCase() && /^[A-Z_][A-Z0-9_]*$/.test(token.value)) className = "tok-class";
    }

    const value = escapeHtml(text.slice(token.start, token.end));
    html += className ? `<span class="${className}">${value}</span>` : value;
    cursor = token.end;
  }

  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
}

/**
 * Realça o programa inteiro.
 * @param {string} code
 * @param {Array} diagnostics  [{line, severity}]
 * @param {number} activeLine
 */
export function highlightCode(code, diagnostics = [], activeLine = 0) {
  const lines = String(code ?? "").split("\n");
  const errorLines = new Set(diagnostics.filter((d) => d.severity === "error").map((d) => d.line));
  const warnLines = new Set(diagnostics.filter((d) => d.severity === "warning").map((d) => d.line));

  return lines
    .map((line, index) => {
      const lineNumber = index + 1;
      const classes = ["code-line"];
      if (errorLines.has(lineNumber)) classes.push("error-line");
      else if (warnLines.has(lineNumber)) classes.push("warn-line");
      if (lineNumber === activeLine) classes.push("active-line");

      // Linha vazia precisa de um caractere invisível para manter os 20px
      const content = line.length ? highlightLine(line) : "";
      return `<span class="${classes.join(" ")}" data-line="${lineNumber}">${content}</span>`;
    })
    // Quebra REAL entre as linhas: sem isto os números/linhas se emendam
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Indentação automática                                               */
/* ------------------------------------------------------------------ */

const INDENT_HEADS = /^(if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b/;

/**
 * Calcula a indentação da próxima linha ao pressionar Enter.
 * Regras:
 *   - linha atual termina com ":"        -> +4
 *   - linha atual é else/elif/except/finally -> mantém
 *   - linha atual começa com return/break/pass/raise/continue -> -4
 *   - caso contrário                     -> mantém
 */
export function nextIndent(currentLine) {
  const text = String(currentLine ?? "");
  const indent = (/^[ \t]*/.exec(text)?.[0] ?? "").replace(/\t/g, TAB);
  const body = text.trim();
  const base = indent.length;

  if (!body) return indent;

  // fecha parêntese pendente -> não muda nada
  if (/[:([{]$/.test(body) && !body.endsWith(":")) return indent;

  let next = base;
  if (body.endsWith(":")) next += 4;
  if (/^(return|break|pass|continue|raise)\b/.test(body)) next = Math.max(0, base - 4);
  if (INDENT_HEADS.test(body) && !body.endsWith(":")) next = base;

  return " ".repeat(Math.max(0, next));
}

/** Indenta/desindenta as linhas selecionadas (Tab / Shift+Tab). */
export function reindent(textarea, direction) {
  const { value, selectionStart, selectionEnd } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  let lineEnd = value.indexOf("\n", selectionEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");

  const transformed = lines.map((line) => {
    if (direction > 0) return TAB + line;
    if (line.startsWith(TAB)) return line.slice(TAB.length);
    return line.replace(/^ {1,4}/, "");
  });

  const nextBlock = transformed.join("\n");
  textarea.value = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);

  const deltaFirst = transformed[0].length - lines[0].length;
  const deltaAll = nextBlock.length - block.length;
  textarea.selectionStart = Math.max(lineStart, selectionStart + deltaFirst);
  textarea.selectionEnd = Math.max(textarea.selectionStart, selectionEnd + deltaAll);
}

/* ------------------------------------------------------------------ */
/* Fechamento automático de pares                                      */
/* ------------------------------------------------------------------ */

const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
const CLOSERS = new Set([")", "]", "}", '"', "'"]);

/**
 * @returns {boolean} true se o editor tratou a tecla (o caller não insere nada)
 */
export function handlePairKey(textarea, key) {
  const { value, selectionStart, selectionEnd } = textarea;

  // Fecha um par existente em vez de duplicar
  if (CLOSERS.has(key) && value[selectionStart] === key && selectionStart === selectionEnd) {
    textarea.selectionStart = selectionStart + 1;
    textarea.selectionEnd = selectionEnd + 1;
    return true;
  }

  if (PAIRS[key] && selectionStart !== selectionEnd) {
    const selected = value.slice(selectionStart, selectionEnd);
    textarea.value = value.slice(0, selectionStart) + key + selected + PAIRS[key] + value.slice(selectionEnd);
    textarea.selectionStart = selectionStart + 1;
    textarea.selectionEnd = selectionEnd + 1;
    return true;
  }

  // Só fecha sozinho se o que vem depois não for palavra
  if (PAIRS[key] && (key === "(" || key === "[" || key === "{")) {
    const after = value[selectionStart] ?? "";
    if (after === "" || /[\s)\]}:,]/.test(after)) {
      textarea.value = value.slice(0, selectionStart) + key + PAIRS[key] + value.slice(selectionEnd);
      textarea.selectionStart = selectionStart + 1;
      textarea.selectionEnd = selectionEnd + 1;
      return true;
    }
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Autocomplete (Parte 15.3)                                           */
/* ------------------------------------------------------------------ */

const ICONS = {
  module: "▣", class: "◈", method: "ƒ", function: "ƒ",
  property: "◧", constant: "≡", keyword: "⌘", variable: "𝑥",
  snippet: "⌗",
};

/**
 * Descobre o contexto do cursor: prefixo digitado, cadeia antes do ponto,
 * se está num "from X import", etc.
 */
export function completionContext(code, cursor) {
  const before = String(code).slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);

  // from pybricks.|   /   from movements import |
  const fromImport = /^\s*from\s+([\w.]*)\s*(\.\s*[\w]*|import\s+[\w]*)?$/.exec(line);
  if (fromImport) {
    const typed = /import\s+([\w]*)$/.exec(line)?.[1] ?? "";
    const dotted = /^\s*from\s+([\w.]*)\.?[\w]*$/.exec(line)?.[1] ?? "";
    const isImportClause = /\bimport\s+[\w]*$/.test(line);
    return { kind: "from", module: dotted, prefix: typed, isImportClause, line };
  }

  if (/^\s*import\s+[\w.]*$/.test(line)) {
    return { kind: "import", prefix: /^\s*import\s+([\w.]*)$/.exec(line)?.[1] ?? "", line };
  }

  // cadeia antes do ponto: hub.imu.|   motor.|   Port.|
  const dotted = /([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\.([\w]*)$/.exec(line);
  if (dotted) return { kind: "member", chain: dotted[1], prefix: dotted[2], line };

  const word = /([A-Za-z_][\w]*)$/.exec(line);
  return { kind: "word", prefix: word?.[1] ?? "", line };
}

/**
 * Lista de sugestões para o contexto atual.
 * @param {object} context resultado de completionContext()
 * @param {object} scope { variables, functions, classes, modules, types }
 */
export function getCompletions(context, scope = {}) {
  const out = [];
  const prefix = (context.prefix ?? "").toLowerCase();
  const push = (label, detail, kind, insert, doc) => {
    out.push({ label, detail, kind, insert: insert ?? label, doc: doc ?? "" });
  };

  const matches = (name) => !prefix || name.toLowerCase().startsWith(prefix) ||
    fuzzyScore(name.toLowerCase(), prefix) > 0.55;

  if (context.kind === "from") {
    if (!context.isImportClause) {
      // completar nome do módulo
      for (const moduleName of MODULES) if (matches(moduleName)) push(moduleName, "módulo Pybricks", "module");
      for (const moduleName of scope.modules ?? []) if (matches(moduleName)) push(moduleName, "módulo do projeto", "module");
      return dedupe(out).slice(0, 40);
    }
    // completar símbolos do módulo
    const moduleName = context.module;
    if (moduleName === "pybricks" || !moduleName.includes(".")) {
      const short = MODULES.filter((m) => m.startsWith(moduleName === "pybricks" ? "pybricks." : moduleName));
      for (const candidate of short) {
        const part = candidate.split(".").pop();
        if (matches(part)) push(part, candidate, "module");
      }
    }
    for (const symbol of IMPORTABLE[moduleName] ?? []) {
      if (matches(symbol)) push(symbol, moduleName, /^[A-Z]/.test(symbol) ? "class" : "function");
    }
    const internal = scope.moduleSymbols?.[moduleName] ?? [];
    for (const symbol of internal) {
      if (matches(symbol.name)) push(symbol.name, `${symbol.kind} em ${moduleName}`, symbol.kind === "class" ? "class" : "function", symbol.name, symbol.doc);
    }
    return dedupe(out).slice(0, 40);
  }

  if (context.kind === "import") {
    for (const moduleName of MODULES) if (matches(moduleName)) push(moduleName, "módulo Pybricks", "module");
    for (const moduleName of scope.modules ?? []) if (matches(moduleName)) push(moduleName, "módulo do projeto", "module");
    return dedupe(out).slice(0, 40);
  }

  if (context.kind === "member") {
    const chain = context.chain;

    // Port. Color. Stop. Direction. Button. Side. Icon. Axis.
    const enumKind = chain.split(".").pop();
    const enumEntry = PYBRICKS_API.find((entry) => entry.name.startsWith(`${enumKind}.`));
    if (enumEntry) {
      for (const entry of PYBRICKS_API) {
        if (!entry.name.startsWith(`${enumKind}.`)) continue;
        const short = tail(entry.name);
        if (matches(short)) push(short, enumKind, "constant", short, entry.doc);
      }
      if (out.length) return dedupe(out).slice(0, 40);
    }

    // Tipo inferido da variável: motor : Motor -> membros de Motor
    const type = scope.types?.[chain] ?? scope.types?.[chain.split(".").pop()];
    if (type) {
      for (const entry of membersOf(type)) {
        const short = tail(entry.name);
        if (matches(short)) push(short, entry.signature ?? `${type}.${short}`, entry.kind === "property" ? "property" : entry.kind === "method" ? "method" : "function", short, entry.doc);
      }
      if (out.length) return dedupe(out).slice(0, 40);
    }

    // Cadeia literal: hub.imu. / hub.display. / hub.speaker. / hub.light. / robot. / timer.
    for (const entry of membersOfChain(chain)) {
      const remainder = entry.name.slice(chain.length + 1);
      const short = remainder.split(".")[0];
      if (matches(short)) {
        push(short, entry.signature ?? entry.name, entry.kind === "property" ? "property" : entry.kind === "method" ? "method" : entry.kind, short, entry.doc);
      }
    }

    // Módulo interno do VFS: movements. -> gyro_move, gyro_turn...
    const internal = scope.moduleSymbols?.[chain] ?? [];
    for (const symbol of internal) {
      if (matches(symbol.name)) push(symbol.name, `${symbol.kind} em ${chain}`, symbol.kind === "class" ? "class" : "function", symbol.name, symbol.doc);
    }

    return dedupe(out).slice(0, 40);
  }

  // contexto "word": tudo que fizer sentido
  for (const name of scope.variables ?? []) if (matches(name)) push(name, "variável", "variable");
  for (const fn of scope.functions ?? []) if (matches(fn.name ?? fn)) push(fn.name ?? fn, `def ${fn.name ?? fn}(${(fn.args ?? []).join(", ")})`, "function", fn.name ?? fn, fn.doc);
  for (const cls of scope.classes ?? []) if (matches(cls.name ?? cls)) push(cls.name ?? cls, "classe", "class");
  for (const keyword of PYTHON_KEYWORDS) if (matches(keyword)) push(keyword, "palavra-chave", "keyword");
  for (const builtin of BUILTINS) if (matches(builtin)) push(builtin, "built-in", "function");

  for (const entry of PYBRICKS_API) {
    if (entry.kind === "constant") continue;
    const short = tail(entry.name);
    if (!matches(short) && !matches(entry.name)) continue;
    const detail = entry.signature ?? entry.name;
    if (entry.kind === "constructor") push(short, detail, "class", short, entry.doc);
    else if (entry.kind === "function") push(short, detail, "function", short, entry.doc);
  }

  for (const moduleName of scope.modules ?? []) {
    if (matches(moduleName.split(".").pop())) push(moduleName.split(".").pop(), moduleName, "module");
  }

  return dedupe(out).slice(0, 60);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.label}|${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pontuação de similaridade simples para completar com erro de digitação. */
export function fuzzyScore(candidate, query) {
  if (!query) return 1;
  if (candidate.startsWith(query)) return 1;
  let index = 0;
  for (const char of candidate) {
    if (char === query[index]) index += 1;
    if (index === query.length) return 0.6 + 0.4 * (query.length / candidate.length);
  }
  return 0;
}

/**
 * Aplica uma sugestão no textarea, substituindo apenas o prefixo digitado.
 */
export function applyCompletion(textarea, completion) {
  const { value, selectionStart } = textarea;
  const before = value.slice(0, selectionStart);
  const prefixMatch = /([A-Za-z_][\w]*)$/.exec(before);
  const prefix = prefixMatch?.[1] ?? "";
  const start = selectionStart - prefix.length;
  const insert = completion.insert ?? completion.label;
  textarea.value = value.slice(0, start) + insert + value.slice(selectionStart);
  const caret = start + insert.length;
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
}

/* ------------------------------------------------------------------ */
/* Posição do popup de autocomplete                                    */
/* ------------------------------------------------------------------ */

/**
 * Calcula onde abrir a lista, a partir da linha/coluna do cursor.
 * Usa a métrica real do editor (12px/20px, padding 12px 53px).
 */
export function completionPosition(textarea, code, cursor) {
  const before = String(code).slice(0, cursor);
  const line = before.split("\n").length - 1;
  const column = before.length - (before.lastIndexOf("\n") + 1);
  const charWidth = 7.2; // JetBrains Mono / Consolas 12px ≈ 7.2px

  const paddingLeft = 53;
  const paddingTop = 12;

  return {
    left: paddingLeft + column * charWidth - textarea.scrollLeft,
    top: paddingTop + (line + 1) * LINE_HEIGHT - textarea.scrollTop,
  };
}

/** Linha e coluna (1-based) do cursor. */
export function cursorPosition(code, cursor) {
  const before = String(code).slice(0, cursor);
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/* ------------------------------------------------------------------ */
/* Documentação ao passar o mouse / ajuda de assinatura                */
/* ------------------------------------------------------------------ */

/**
 * Resolve o que está sob o cursor para tooltip de documentação.
 * @returns {{title:string, doc:string, signature:string}|null}
 */
export function documentationAt(code, cursor) {
  const before = String(code).slice(0, cursor);
  const after = String(code).slice(cursor);
  const wordMatch = /([A-Za-z_][\w.]*)$/.exec(before);
  if (!wordMatch) return null;
  const word = wordMatch[1];
  const suffix = /^[\w.]*/.exec(after)?.[0] ?? "";
  const full = word + suffix;

  const entry = resolveApi(full) ?? resolveApi(tail(full));
  if (entry) return { title: entry.name, doc: entry.doc, signature: entry.signature ?? "" };

  // método de objeto: motor.run -> procura "Motor.run" via tipo (sem escopo aqui)
  const parts = full.split(".");
  if (parts.length >= 2) {
    const candidate = PYBRICKS_API.find((item) => item.name.endsWith(`.${parts.slice(-1).join(".")}`));
    if (candidate) return { title: candidate.name, doc: candidate.doc, signature: candidate.signature ?? "" };
  }
  return null;
}

/** Assinatura ativa quando o cursor está dentro de parênteses. */
export function signatureHelp(code, cursor) {
  const before = String(code).slice(0, cursor);
  let depth = 0;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const char = before[index];
    if (char === ")") depth += 1;
    else if (char === "(") {
      if (depth === 0) {
        const head = /([A-Za-z_][\w.]*)\s*$/.exec(before.slice(0, index));
        if (!head) return null;
        const entry = resolveApi(head[1]) ?? resolveApi(tail(head[1]));
        if (!entry) return null;
        const argsBefore = before.slice(index + 1);
        const activeParameter = argsBefore.split(",").length - 1;
        return { name: entry.name, signature: entry.signature ?? "", doc: entry.doc, activeParameter, params: Object.keys(entry.params ?? {}) };
      }
      depth -= 1;
    }
  }
  return null;
}

export { ICONS, TAB };
export default {
  renderLineNumbers, syncScroll, highlightCode, highlightLine, nextIndent,
  reindent, handlePairKey, completionContext, getCompletions, applyCompletion,
  completionPosition, cursorPosition, documentationAt, signatureHelp, LINE_HEIGHT,
};

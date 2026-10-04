/**
 * ANALISADOR SEMÂNTICO — GARÇA DE BOTAS CODE STUDIO
 * -------------------------------------------------
 * Parte 9.5 (tabela de símbolos + inferência de tipo)
 * Parte 8.4 (Module Resolver sobre o VFS)
 * Parte 8.5 (estados de import)
 * Parte 8.7 (grafo de dependências)
 *
 * Roda no navegador. Não executa o código do usuário (S08): apenas percorre a IR.
 */

import { CONSTRUCTORS, CLASS_MODULE, IMPORTABLE, MODULES, resolve as resolveApi } from "../pybricks/apiRegistry.js";

export const IMPORT_STATE = {
  RESOLVED: "RESOLVED",
  MODULE_NOT_FOUND: "MODULE_NOT_FOUND",
  SYMBOL_NOT_FOUND: "SYMBOL_NOT_FOUND",
  SYNTAX_ERROR: "SYNTAX_ERROR",
  EXTERNAL_MODULE: "EXTERNAL_MODULE",
  PYBRICKS_MODULE: "PYBRICKS_MODULE",
  AMBIGUOUS: "AMBIGUOUS",
};

const EXTERNAL_MODULES = new Set([
  "math", "sys", "time", "random", "urandom", "micropython", "ujson",
  "ustruct", "struct", "collections", "itertools", "functools", "json",
  "re", "typing", "utime", "usys", "gc", "machine", "network", "socket",
]);

/* ------------------------------------------------------------------ */
/* Nomes de módulo a partir do caminho do VFS                          */
/* ------------------------------------------------------------------ */

/** "/libraries/movements.py" -> "libraries.movements" */
export function moduleNameFromPath(path) {
  return String(path || "")
    .replace(/^\/+/, "")
    .replace(/\.py$/, "")
    .replace(/\/__init__$/, "")
    .replace(/\//g, ".");
}

/** "libraries.movements" -> candidatos de caminho no VFS */
export function candidatePaths(moduleName) {
  const dotted = String(moduleName || "").split(".");
  const base = dotted.join("/");
  return [`/${base}.py`, `/${base}/__init__.py`];
}

/* ------------------------------------------------------------------ */
/* Símbolos de um único arquivo                                        */
/* ------------------------------------------------------------------ */

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "source" || key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === "object" && value.type) walk(value, visit);
  }
}

/**
 * Extrai símbolos do arquivo: funções, classes, variáveis, imports.
 * @param {{type:string, body:Array}} ir raiz do programa
 */
export function extractSymbols(ir) {
  const symbols = { functions: [], classes: [], variables: [], imports: [], aliases: {} };
  if (!ir) return symbols;

  const seenVar = new Set();

  walk(ir, (node) => {
    switch (node.type) {
      case "function":
        symbols.functions.push({
          name: node.name, args: (node.params || []).map((p) => p.name),
          defaults: (node.params || []).map((p) => p.default), line: node.source?.startLine ?? 1,
        });
        break;
      case "classDefinition":
        symbols.classes.push({ name: node.name, line: node.source?.startLine ?? 1 });
        break;
      case "assignment":
        for (const target of node.targets || []) {
          if (target?.type === "variableReference" && !seenVar.has(target.name)) {
            seenVar.add(target.name);
            symbols.variables.push({
              name: target.name,
              line: node.source?.startLine ?? 1,
              type: inferType(node.value),
            });
          }
        }
        break;
      case "augmentedAssignment":
        if (node.target?.type === "variableReference" && !seenVar.has(node.target.name)) {
          seenVar.add(node.target.name);
          symbols.variables.push({ name: node.target.name, line: node.source?.startLine ?? 1, type: "number" });
        }
        break;
      case "loop":
        for (const target of node.targets || []) {
          if (!seenVar.has(target)) {
            seenVar.add(target);
            symbols.variables.push({ name: target, line: node.source?.startLine ?? 1, type: "number" });
          }
        }
        break;
      case "import":
        for (const entry of node.names || []) {
          symbols.imports.push({ kind: "import", module: entry.name, alias: entry.alias, line: node.source?.startLine });
          symbols.aliases[entry.alias || entry.name.split(".")[0]] = entry.name;
        }
        break;
      case "importFrom":
        for (const entry of node.names || []) {
          symbols.imports.push({
            kind: "from", module: node.module, name: entry.name,
            alias: entry.alias, line: node.source?.startLine,
          });
          symbols.aliases[entry.alias || entry.name] = `${node.module}.${entry.name}`;
        }
        break;
      default:
        break;
    }
  });

  return symbols;
}

/* ------------------------------------------------------------------ */
/* Inferência de tipo (Parte 9.5)                                      */
/* ------------------------------------------------------------------ */

export function inferType(valueNode) {
  if (!valueNode) return null;
  if (valueNode.type === "callExpression") {
    const callee = valueNode.calleeText || "";
    const name = callee.split(".").pop();
    if (CONSTRUCTORS.has(name)) return name;
    if (callee === "StopWatch") return "StopWatch";
    const api = resolveApi(name);
    return api?.returns ?? null;
  }
  if (valueNode.type === "attribute") {
    const api = resolveApi(`${inferType(valueNode.object) ?? ""}.${valueNode.attribute}`);
    return api?.returns ?? null;
  }
  if (valueNode.type === "literal") {
    if (valueNode.literalKind === "number") return "number";
    if (valueNode.literalKind === "string") return "string";
    if (valueNode.literalKind === "boolean") return "boolean";
    return null;
  }
  if (valueNode.type === "list") return "list";
  if (valueNode.type === "dict") return "dict";
  if (valueNode.type === "tuple") return "tuple";
  return null;
}

/* ------------------------------------------------------------------ */
/* Module Resolver (Parte 8.4 / 8.5)                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve um import contra o VFS + runtime Pybricks + bibliotecas externas.
 * @param {object} importEntry { kind, module, name }
 * @param {Map<string, object>} moduleIndex moduleName -> file
 */
export function resolveImport(importEntry, moduleIndex) {
  const moduleName = importEntry.module || "";

  // Runtime Pybricks — nunca é arquivo do projeto
  if (moduleName === "pybricks" || moduleName.startsWith("pybricks.")) {
    const knownModule = MODULES.includes(moduleName);
    if (importEntry.kind === "from" && importEntry.name) {
      const importable = IMPORTABLE[moduleName] || [];
      if (importable.includes(importEntry.name)) {
        return { state: IMPORT_STATE.PYBRICKS_MODULE, module: moduleName, symbol: importEntry.name };
      }
      return {
        state: IMPORT_STATE.SYMBOL_NOT_FOUND, module: moduleName, symbol: importEntry.name,
        available: importable,
      };
    }
    return knownModule
      ? { state: IMPORT_STATE.PYBRICKS_MODULE, module: moduleName }
      : { state: IMPORT_STATE.SYMBOL_NOT_FOUND, module: moduleName, available: MODULES };
  }

  if (EXTERNAL_MODULES.has(moduleName)) {
    return { state: IMPORT_STATE.EXTERNAL_MODULE, module: moduleName };
  }

  // Módulos internos do VFS
  const matches = candidatePaths(moduleName)
    .map((path) => moduleIndex.get(path))
    .filter(Boolean);

  if (matches.length > 1) {
    return { state: IMPORT_STATE.AMBIGUOUS, module: moduleName, candidates: matches.map((f) => f.path) };
  }
  if (matches.length === 0) {
    return {
      state: IMPORT_STATE.MODULE_NOT_FOUND, module: moduleName,
      hint: `Não existe o arquivo ${moduleName.split(".").pop()}.py neste projeto.`,
    };
  }

  const file = matches[0];
  if (file.syntaxError) {
    return { state: IMPORT_STATE.SYNTAX_ERROR, module: moduleName, file };
  }

  // "import movements" — só precisa do módulo existir
  if (importEntry.kind === "import") {
    return { state: IMPORT_STATE.RESOLVED, module: moduleName, file };
  }

  // "from movements import gyro_turn" — precisa do símbolo
  if (importEntry.name === "*") {
    return { state: IMPORT_STATE.RESOLVED, module: moduleName, file };
  }

  const symbols = file.symbols || { functions: [], classes: [], variables: [] };
  const found =
    symbols.functions.find((f) => f.name === importEntry.name) ||
    symbols.classes.find((c) => c.name === importEntry.name) ||
    symbols.variables.find((v) => v.name === importEntry.name);

  if (found) {
    return { state: IMPORT_STATE.RESOLVED, module: moduleName, file, symbol: found };
  }

  // Mensagem correta (Parte 8.5): o módulo EXISTE, o símbolo não
  return {
    state: IMPORT_STATE.SYMBOL_NOT_FOUND,
    module: moduleName,
    symbol: importEntry.name,
    file,
    available: symbols.functions.map((f) => f.name),
  };
}

/** Mensagem em pt-BR para cada estado de import (Anexo B). */
export function importMessage(resolution) {
  switch (resolution.state) {
    case IMPORT_STATE.RESOLVED:
      return `✓ ${resolution.module}.py encontrado`;
    case IMPORT_STATE.PYBRICKS_MODULE:
      return `✓ ${resolution.module} — biblioteca do Pybricks`;
    case IMPORT_STATE.EXTERNAL_MODULE:
      return `✓ ${resolution.module} — biblioteca externa`;
    case IMPORT_STATE.MODULE_NOT_FOUND:
      return `✗ Não existe o arquivo ${resolution.module.split(".").pop()}.py neste projeto.`;
    case IMPORT_STATE.SYMBOL_NOT_FOUND: {
      const available = (resolution.available || []).join(", ");
      const head = resolution.module.startsWith("pybricks")
        ? `⚠ "${resolution.symbol}" não existe em ${resolution.module}.`
        : `⚠ ${resolution.symbol} não está definido em ${resolution.module.split(".").pop()}`;
      return available ? `${head}\n   Disponíveis: ${available}` : head;
    }
    case IMPORT_STATE.SYNTAX_ERROR:
      return `✗ ${resolution.module}.py tem erro de sintaxe e não pôde ser analisado.`;
    case IMPORT_STATE.AMBIGUOUS:
      return `⚠ Mais de um arquivo corresponde a "${resolution.module}": ${(resolution.candidates || []).join(", ")}`;
    default:
      return `? Estado de import desconhecido para ${resolution.module}`;
  }
}

/* ------------------------------------------------------------------ */
/* Grafo de dependências (Parte 8.7)                                   */
/* ------------------------------------------------------------------ */

export function buildDependencyGraph(files, moduleIndex) {
  const graph = {};      // path -> [paths]
  const reverse = {};    // path -> [paths que dependem dele]

  for (const file of files) {
    graph[file.path] = [];
    reverse[file.path] = [];
  }

  for (const file of files) {
    for (const importEntry of file.symbols?.imports || []) {
      const resolution = resolveImport(importEntry, moduleIndex);
      if (resolution.state !== IMPORT_STATE.RESOLVED || !resolution.file) continue;
      const target = resolution.file.path;
      if (target === file.path) continue;
      if (!graph[file.path].includes(target)) graph[file.path].push(target);
      if (!reverse[target]) reverse[target] = [];
      if (!reverse[target].includes(file.path)) reverse[target].push(file.path);
    }
  }

  return { graph, reverse, cycles: detectCycles(graph) };
}

export function detectCycles(graph) {
  const cycles = [];
  const state = new Map(); // 0 = visitando, 1 = pronto

  const visit = (node, trail) => {
    if (state.get(node) === 1) return;
    if (state.get(node) === 0) {
      const start = trail.indexOf(node);
      cycles.push(trail.slice(start >= 0 ? start : 0).concat(node));
      return;
    }
    state.set(node, 0);
    for (const next of graph[node] || []) visit(next, trail.concat(node));
    state.set(node, 1);
  };

  Object.keys(graph).forEach((node) => visit(node, []));
  return cycles;
}

/** Ordenação topológica para o bundler (Parte 18.5). */
export function topoSort(graph, entry) {
  const order = [];
  const seen = new Set();
  const visiting = new Set();

  const visit = (node) => {
    if (seen.has(node) || visiting.has(node)) return;
    visiting.add(node);
    for (const dep of graph[node] || []) visit(dep);
    visiting.delete(node);
    seen.add(node);
    order.push(node);
  };

  visit(entry);
  return order;
}

/* ------------------------------------------------------------------ */
/* Análise completa de um projeto                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {Array} files [{ file_id, path, name, content, ir, symbols, syntaxError }]
 */
export function analyzeProject(files) {
  const moduleIndex = new Map();
  for (const file of files) {
    if (!file.path?.endsWith(".py")) continue;
    moduleIndex.set(file.path, file);
    const moduleName = moduleNameFromPath(file.path);
    if (moduleName && !moduleIndex.has(moduleName)) moduleIndex.set(moduleName, file);
  }

  const imports = [];
  for (const file of files) {
    for (const importEntry of file.symbols?.imports || []) {
      const resolution = resolveImport(importEntry, moduleIndex);
      imports.push({
        file: file.path, line: importEntry.line, ...importEntry,
        state: resolution.state, message: importMessage(resolution),
        available: resolution.available,
      });
    }
  }

  const { graph, reverse, cycles } = buildDependencyGraph(files, moduleIndex);

  return { moduleIndex, imports, graph, reverse, cycles };
}

/**
 * Símbolos exportados por todos os módulos internos — alimentam o
 * autocomplete (Parte 15.3) e a categoria dinâmica "Bibliotecas" (11.16).
 */
export function librarySymbols(files) {
  const out = [];
  for (const file of files) {
    if (!file.path?.endsWith(".py")) continue;
    const moduleName = moduleNameFromPath(file.path);
    for (const fn of file.symbols?.functions || []) {
      out.push({
        name: fn.name, module: moduleName, path: file.path,
        args: fn.args || [], defaults: fn.defaults || [],
        kind: "function", line: fn.line,
      });
    }
    for (const cls of file.symbols?.classes || []) {
      out.push({ name: cls.name, module: moduleName, path: file.path, args: [], kind: "class", line: cls.line });
    }
  }
  return out;
}

export default analyzeProject;

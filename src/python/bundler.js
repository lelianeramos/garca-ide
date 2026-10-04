/**
 * BUNDLER DE MÓDULOS INTERNOS (lado cliente) — Parte 18.5
 * -------------------------------------------------------
 * O HUB recebe UM único programa. Antes de compilar é preciso:
 *   1. localizar o entrypoint
 *   2. resolver imports internos pelo VFS
 *   3. ordenar módulos por dependência
 *   4. detectar ciclos e conflitos de símbolos
 *   5. remover apenas imports INTERNOS (manter os da Pybricks)
 *   6. reescrever chamadas qualificadas internas (movements.gyro_move -> gyro_move)
 *   7. produzir o Python final
 *
 * A versão autoritativa roda no servidor (api/project/bundle.py, com ast real).
 * Esta é a versão local, usada para pré-visualizar e para funcionar offline.
 */

import { parseProgram } from "../parser/pythonParser.js";
import { moduleNameFromPath, resolveImport, IMPORT_STATE, topoSort } from "../semantic/analyzer.js";

const RUNTIME_PREFIXES = ["pybricks"];
const EXTERNAL = new Set([
  "math", "sys", "time", "random", "urandom", "micropython", "ujson",
  "ustruct", "struct", "collections", "itertools", "functools", "json", "re",
]);

/**
 * @param {object} vfs instância de VirtualFileSystem
 * @param {string} entryFileId
 * @returns {{ ok:boolean, code:string, modules:string[], error?:string, warnings:string[] }}
 */
export function bundleProject(vfs, entryFileId) {
  const warnings = [];
  const entry = vfs.byId(entryFileId) ?? vfs.entrypoint;
  if (!entry) return { ok: false, code: "", modules: [], error: "Nenhum arquivo de entrada definido.", warnings };

  const analysis = vfs.analysis;
  const graph = analysis.graph ?? {};
  const cycles = analysis.cycles ?? [];
  if (cycles.length) {
    return {
      ok: false, code: "", modules: [],
      error: `Ciclo de import detectado: ${cycles[0].join(" → ")}`,
      warnings,
    };
  }

  const order = topoSort(graph, entry.path);
  const internalPaths = order.filter((path) => path !== entry.path);
  const internalModules = internalPaths
    .map((path) => vfs.findByPath(path))
    .filter(Boolean);

  // 4. conflitos de símbolo
  const owner = new Map();
  for (const file of [...internalModules, entry]) {
    for (const fn of file.symbols?.functions ?? []) {
      if (owner.has(fn.name) && owner.get(fn.name) !== file.path) {
        warnings.push(`Conflito de símbolo: "${fn.name}" existe em ${owner.get(fn.name)} e em ${file.path}.`);
      }
      owner.set(fn.name, file.path);
    }
  }

  const sections = [];
  const seenDefinitions = new Set();

  for (const file of internalModules) {
    const body = stripInternalImports(file.content, internalModules.map((f) => f.module_name));
    if (!body.trim()) continue;
    if (seenDefinitions.has(file.file_id)) continue;
    seenDefinitions.add(file.file_id);
    sections.push(`# --- ${file.path} ---\n${body.trim()}`);
  }

  const entryBody = stripInternalImports(entry.content, internalModules.map((f) => f.module_name));
  sections.push(entryBody.trim());

  let code = sections.filter(Boolean).join("\n\n") + "\n";
  code = rewriteQualifiedCalls(code, internalModules);
  code = code.replace(/\n{3,}/g, "\n\n");

  return {
    ok: true,
    code,
    modules: [entry.path, ...internalPaths],
    warnings,
  };
}

/** Remove apenas os imports de módulos internos; mantém Pybricks e externos. */
function stripInternalImports(content, internalModuleNames) {
  const internals = new Set(internalModuleNames);
  const lines = String(content).split("\n");

  return lines
    .map((line) => {
      const from = /^(\s*)from\s+([\w.]+)\s+import\s+(.*)$/.exec(line);
      if (from && internals.has(from[2])) return null;

      const plain = /^(\s*)import\s+([\w.]+)(\s+as\s+\w+)?\s*$/.exec(line);
      if (plain && internals.has(plain[2])) return null;

      return line;
    })
    .filter((line) => line !== null)
    .join("\n");
}

/** movements.gyro_move(...) -> gyro_move(...) */
function rewriteQualifiedCalls(code, internalModules) {
  let result = code;
  for (const file of internalModules) {
    const moduleName = file.module_name;
    const shortName = moduleName.split(".").pop();
    for (const fn of file.symbols?.functions ?? []) {
      const qualified = new RegExp(`\\b(?:${escapeRegExp(moduleName)}|${escapeRegExp(shortName)})\\.${escapeRegExp(fn.name)}\\s*\\(`, "g");
      result = result.replace(qualified, `${fn.name}(`);
    }
  }
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** É módulo de runtime (Pybricks) ou biblioteca externa? */
export function isRuntimeModule(moduleName) {
  const name = String(moduleName ?? "");
  return RUNTIME_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}.`)) || EXTERNAL.has(name);
}

/** Validação pré-execução (Parte 18.6). */
export function preflight(vfs, entryFileId) {
  const checks = [];
  const entry = vfs.byId(entryFileId) ?? vfs.entrypoint;

  checks.push({ id: 1, name: "sintaxe", ok: Boolean(entry && !entry.syntaxError), detail: entry?.syntaxError?.message ?? "" });

  const brokenImports = (vfs.analysis.imports ?? []).filter(
    (item) => item.state === IMPORT_STATE.MODULE_NOT_FOUND || item.state === IMPORT_STATE.SYMBOL_NOT_FOUND,
  );
  checks.push({
    id: 2, name: "imports resolvidos", ok: brokenImports.length === 0,
    detail: brokenImports.map((item) => item.message).join("; "),
  });

  checks.push({ id: 3, name: "módulos locais", ok: (vfs.analysis.cycles ?? []).length === 0, detail: (vfs.analysis.cycles ?? []).map((c) => c.join(" → ")).join("; ") });
  checks.push({ id: 9, name: "entrypoint definido", ok: Boolean(entry), detail: entry?.path ?? "" });

  // portas sem conflito
  const usedPorts = new Map();
  const portConflicts = [];
  const parsed = entry ? parseProgram(entry.content) : null;
  for (const node of parsed?.flat ?? []) {
    if (node.type !== "assignment") continue;
    const call = node.value;
    if (call?.type !== "callExpression") continue;
    const arg = call.arguments?.[0];
    if (arg?.type === "attribute" && arg.object?.name === "Port") {
      const device = node.targets?.[0]?.name ?? "?";
      if (usedPorts.has(arg.attribute)) {
        portConflicts.push(`A porta ${arg.attribute} já está sendo usada por ${usedPorts.get(arg.attribute)}.`);
      } else {
        usedPorts.set(arg.attribute, device);
      }
    }
  }
  checks.push({ id: 7, name: "portas sem conflito", ok: portConflicts.length === 0, detail: portConflicts.join("; ") });

  return { checks, ok: checks.every((check) => check.ok) };
}

export default bundleProject;

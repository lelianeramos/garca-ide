/**
 * VFS — SISTEMA DE ARQUIVOS VIRTUAL
 * ---------------------------------
 * Parte 8: "Arquivo não é um texto anexado ao editor. Arquivo é um módulo real
 * pertencente a um projeto, com identidade, caminho, símbolos e dependências."
 *
 * Regra central: `file_id` é ESTÁVEL — não muda ao renomear nem ao mover (8.2).
 * É isso que permite renomeação semântica (8.6) sem perder abas, blocos ou histórico.
 */

import { parseProgram } from "../parser/pythonParser.js";
import { extractSymbols, moduleNameFromPath, analyzeProject } from "../semantic/analyzer.js";
import { irToBlocks } from "../blocks/blockFactory.js";

const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

/** Template da biblioteca de movimentos (Parte 8.8) — sem inventar implementação. */
export const LIBRARY_TEMPLATE = `# Biblioteca de movimentos da equipe

def gyro_move(robot, hub, distance, speed=300):
    pass

def gyro_turn(robot, hub, angle, speed=300):
    pass

def gyro_curve(robot, hub, radius, angle, speed=300):
    pass
`;

export class VirtualFileSystem {
  constructor(project = {}) {
    this.project = {
      id: project.id ?? uid("proj"),
      name: project.name ?? "garca_programacao",
      version: 3,
      files: [],
      entrypoint: null,
      settings: project.settings ?? {},
      git: project.git ?? { branch: "main", lastCommit: null },
    };
    this.analysis = { moduleIndex: new Map(), imports: [], graph: {}, reverse: {}, cycles: [] };
  }

  /* ----------------------------- criação ----------------------------- */

  /**
   * Projeto NOVO começa VAZIO (B16/N15): main.py vazio + missions/saida_1.py
   * vazio + canvas vazio. Nada de exemplo pré-carregado.
   */
  static emptyProject(name = "garca_programacao") {
    const vfs = new VirtualFileSystem({ name });
    vfs.createFolder("/missions");
    vfs.createFolder("/libraries");
    const main = vfs.createFile("/main.py", "");
    const saida = vfs.createFile("/missions/saida_1.py", "");
    vfs.setEntrypoint(saida.file_id);
    vfs.openFile = saida.file_id;
    return vfs;
  }

  createFile(path, content = "", extra = {}) {
    const normalized = normalizePath(path);
    if (this.findByPath(normalized)) throw new Error(`Já existe um arquivo em ${normalized}`);
    ensureFolders(this, normalized);

    const file = {
      file_id: uid("file"),          // estável
      name: baseName(normalized),
      extension: extensionOf(normalized),
      path: normalized,
      module_name: moduleNameFromPath(normalized),
      content: String(content ?? ""),
      blocks: extra.blocks ?? [],
      symbols: { functions: [], classes: [], variables: [], imports: [], aliases: {} },
      imports: [],
      exports: [],
      dependencies: [],
      checksum: checksum(content),
      modified: false,
      gitStatus: "novo",
      syntaxError: null,
      view: extra.view ?? { panX: 0, panY: 0, zoom: 1 },
      ...extra,
    };

    this.project.files.push(file);
    this.reindexFile(file);
    this.reanalyze();
    return file;
  }

  createFolder(path) {
    const normalized = normalizePath(path);
    const existing = this.project.folders ??= [];
    if (existing.some((folder) => folder.path === normalized)) return existing.find((f) => f.path === normalized);
    const parts = normalized.split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      const folderPath = `/${parts.slice(0, index).join("/")}`;
      if (!existing.some((folder) => folder.path === folderPath)) {
        existing.push({
          folder_id: uid("folder"), path: folderPath,
          name: parts[index - 1],
          // A pasta que o usuário acabou de criar nasce ABERTA: é onde ele
          // vai colocar o arquivo. As intermediárias também, para não
          // obrigar três cliques para chegar ao que se acabou de criar.
          expanded: true,
        });
      }
    }
    return existing.find((folder) => folder.path === normalized);
  }

  /* ----------------------------- consultas ----------------------------- */

  get files() { return this.project.files; }
  get folders() { return this.project.folders ?? []; }

  byId(fileId) { return this.project.files.find((file) => file.file_id === fileId) ?? null; }
  findByPath(path) { return this.project.files.find((file) => file.path === normalizePath(path)) ?? null; }
  byModule(moduleName) { return this.project.files.find((file) => file.module_name === moduleName) ?? null; }

  get entrypoint() { return this.byId(this.project.entrypoint); }
  setEntrypoint(fileId) { this.project.entrypoint = fileId; }

  /** Todos os nomes de módulo do projeto (autocomplete de `from ...`). */
  get moduleNames() { return this.project.files.map((file) => file.module_name).filter(Boolean); }

  /* ----------------------------- índice ----------------------------- */

  /** Reparseia o arquivo e atualiza símbolos + IR. Nunca lança (parser tolerante). */
  reindexFile(file) {
    if (!file) return file;
    const parsed = parseProgram(file.content);
    file.symbols = extractSymbols(parsed.ir);
    file.ir = parsed.ir;
    file.syntaxError = parsed.diagnostics[0] ?? null;
    file.diagnostics = parsed.diagnostics;
    file.checksum = checksum(file.content);

    const converted = irToBlocks(parsed.ir, {
      userFunctions: file.symbols.functions,
      libraryFunctions: this.libraryFunctions(file),
    });
    // Só substitui os blocos se o arquivo não tiver estado visual próprio
    if (!file.blocks?.length || file.blocksFromCode !== false) file.blocks = converted.blocks;
    file.pythonOnly = converted.pythonOnly;
    return file;
  }

  reindexAll() {
    for (const file of this.project.files) this.reindexFile(file);
    this.reanalyze();
  }

  reanalyze() {
    this.analysis = analyzeProject(this.project.files);
    for (const file of this.project.files) {
      file.dependencies = this.analysis.graph[file.path] ?? [];
      file.usedBy = this.analysis.reverse[file.path] ?? [];
      file.imports = (this.analysis.imports ?? []).filter((entry) => entry.file === file.path);
    }
    return this.analysis;
  }

  /** Funções vindas de outros módulos do projeto (categoria Bibliotecas — 11.16). */
  libraryFunctions(currentFile) {
    const out = [];
    for (const file of this.project.files) {
      if (file.file_id === currentFile?.file_id) continue;
      for (const fn of file.symbols?.functions ?? []) {
        out.push({ ...fn, module: file.module_name, path: file.path });
      }
    }
    return out;
  }

  /* ----------------------------- operações (8.3) ----------------------------- */

  setContent(fileId, content) {
    const file = this.byId(fileId);
    if (!file) return null;
    if (file.content === content) return file;
    file.content = String(content ?? "");
    file.modified = true;
    if (file.gitStatus === "sincronizado") file.gitStatus = "modificado";
    this.reindexFile(file);
    this.reanalyze();
    return file;
  }

  /**
   * Renomeia/move mantendo o `file_id` (8.6).
   * @returns {{file, references}} referências de import que serão atualizadas
   */
  rename(fileId, newPath, { updateReferences = true } = {}) {
    const file = this.byId(fileId);
    if (!file) return null;
    const target = normalizePath(newPath);

    if (this.findByPath(target)) {
      throw new Error(`Já existe ${baseName(target)} neste diretório.`);
    }

    const oldModule = file.module_name;
    const newModule = moduleNameFromPath(target);
    ensureFolders(this, target);

    // Lista de referências ANTES de mudar (diálogo de confirmação — 8.6)
    const references = this.findReferences(oldModule, file.file_id);

    file.path = target;
    file.name = baseName(target);
    file.extension = extensionOf(target);
    file.module_name = newModule;
    this.reindexFile(file);

    if (updateReferences && oldModule !== newModule) {
      this.updateReferences(oldModule, newModule, file.file_id);
    }

    this.reanalyze();
    return { file, references };
  }

  duplicate(fileId) {
    const file = this.byId(fileId);
    if (!file) return null;
    const copyPath = uniquePath(this, file.path.replace(/\.py$/, "_copia.py"));
    return this.createFile(copyPath, file.content);
  }

  /** Avisa quantos e quais arquivos dependem dele antes de confirmar (8.3). */
  dependentsOf(fileId) {
    const file = this.byId(fileId);
    if (!file) return [];
    return (this.analysis.reverse[file.path] ?? []).map((path) => this.findByPath(path)).filter(Boolean);
  }

  remove(fileId) {
    const file = this.byId(fileId);
    if (!file) return null;
    this.project.files = this.project.files.filter((item) => item.file_id !== fileId);
    if (this.project.entrypoint === fileId) {
      this.project.entrypoint = this.project.files[0]?.file_id ?? null;
    }
    this.reanalyze();
    return file;
  }

  /* --------------------- referências de import (8.6) --------------------- */

  findReferences(moduleName, excludeFileId = null) {
    const out = [];
    for (const file of this.project.files) {
      if (file.file_id === excludeFileId) continue;
      const count = (file.symbols?.imports ?? []).filter(
        (entry) => entry.module === moduleName || (entry.module ?? "").startsWith(`${moduleName}.`),
      ).length;
      if (count > 0) out.push({ file, count });
    }
    return out;
  }

  /**
   * Atualiza `from movements import ...` -> `from drivetrain import ...`
   * usando POSIÇÕES da IR, nunca find/replace cego (N07).
   */
  updateReferences(oldModule, newModule, excludeFileId = null) {
    let changed = 0;
    for (const file of this.project.files) {
      if (file.file_id === excludeFileId) continue;
      const lines = file.content.split("\n");
      let touched = false;

      for (const entry of file.symbols?.imports ?? []) {
        if (entry.module !== oldModule && !(entry.module ?? "").startsWith(`${oldModule}.`)) continue;
        const index = (entry.line ?? 1) - 1;
        if (index < 0 || index >= lines.length) continue;
        const replacement = entry.module === oldModule
          ? newModule
          : entry.module.replace(oldModule, newModule);
        // Substitui apenas a ocorrência do nome do módulo naquela linha
        lines[index] = replaceModuleInLine(lines[index], entry.module, replacement);
        touched = true;
      }

      if (touched) {
        file.content = lines.join("\n");
        file.modified = true;
        this.reindexFile(file);
        changed += 1;
      }
    }
    return changed;
  }

  /* ----------------------------- serialização ----------------------------- */

  toJSON() {
    return {
      ...this.project,
      files: this.project.files.map((file) => ({
        file_id: file.file_id, name: file.name, extension: file.extension,
        path: file.path, module_name: file.module_name, content: file.content,
        blocks: file.blocks ?? [], view: file.view ?? {}, gitStatus: file.gitStatus ?? "novo",
      })),
    };
  }

  static fromJSON(data) {
    const vfs = new VirtualFileSystem(data ?? {});
    vfs.project.files = [];
    vfs.project.folders = [];
    for (const raw of data?.files ?? []) {
      try {
        vfs.createFile(raw.path, raw.content, {
          blocks: raw.blocks ?? [], view: raw.view ?? {}, gitStatus: raw.gitStatus ?? "novo",
        });
      } catch {
        // caminho duplicado no cache antigo — ignora em vez de quebrar
      }
    }
    // recria a árvore de pastas a partir dos caminhos
    for (const file of vfs.project.files) ensureFolders(vfs, file.path);
    vfs.project.entrypoint = data?.entrypoint && vfs.byId(data.entrypoint)
      ? data.entrypoint
      : vfs.project.files[0]?.file_id ?? null;
    vfs.reindexAll();
    return vfs;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function replaceModuleInLine(line, oldModule, newModule) {
  const escaped = oldModule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // casa "from movements import" / "import movements" / "import movements as mv"
  const patterns = [
    new RegExp(`(from\\s+)${escaped}(\\s+import\\b)`),
    new RegExp(`(import\\s+)${escaped}(\\s+as\\b)`),
    new RegExp(`(import\\s+)${escaped}(\\s*$)`),
    new RegExp(`(import\\s+)${escaped}(\\s*,)`, "g"),
  ];
  let result = line;
  for (const pattern of patterns) {
    if (pattern.test(result)) {
      result = result.replace(pattern, `$1${newModule}$2`);
      break;
    }
  }
  return result;
}

export function normalizePath(path) {
  const cleaned = String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .split("/")
    .filter((part) => part && part !== ".")
    .reduce((parts, part) => {
      if (part === "..") parts.pop();
      else parts.push(part);
      return parts;
    }, []);
  return `/${cleaned.join("/")}`;
}

export const baseName = (path) => String(path).split("/").pop() || "";
export const dirName = (path) => normalizePath(String(path).split("/").slice(0, -1).join("/")) || "/";
export const extensionOf = (path) => /\.[^.]+$/.exec(baseName(path))?.[0] ?? "";

export function uniquePath(vfs, path) {
  let candidate = normalizePath(path);
  let counter = 2;
  while (vfs.findByPath(candidate)) {
    candidate = normalizePath(path.replace(/(\.py)?$/, `_${counter}.py`));
    counter += 1;
  }
  return candidate;
}

export function sanitizeFileName(name) {
  const cleaned = String(name ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "");
  return cleaned || "arquivo";
}

function ensureFolders(vfs, filePath) {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) {
    vfs.createFolder(`/${parts.slice(0, index).join("/")}`);
  }
}

function checksum(text) {
  const value = String(text ?? "");
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return hash.toString(36);
}

/**
 * Árvore pronta para renderizar: pastas e arquivos ordenados.
 *
 * Item #15/#16 do pedido: o estado de expansão é POR PASTA e sobrevive ao
 * re-render. Antes, cada nó nascia com `expanded: true` e o `buildTree` era
 * chamado a cada `renderExplorer()` — fechar uma pasta e qualquer redesenhe
 * (abrir arquivo, salvar) abria tudo de novo. Agora o estado vem do VFS, que
 * guarda `expanded` por pasta e persiste com o projeto.
 */
export function buildTree(vfs) {
  const root = { path: "/", name: vfs.project.name, folders: [], files: [], expanded: true, id: "/" };
  const nodes = new Map([["/", root]]);

  /*
   * Pastas intermediárias: `nodeFor` cria o ancestral que ainda não existe
   * (ex.: criar "/a/b/c.py" precisa de "/a" e "/a/b"). O estado dessas
   * pastas intermediárias vem do VFS quando existe; senão, nasce fechada —
   * abrir tudo por padrão transformava a árvore num tapete de arquivos.
   */
  const nodeFor = (path) => {
    if (nodes.has(path)) return nodes.get(path);
    const parent = nodeFor(dirName(path));
    const stored = vfs.folders?.find((folder) => folder.path === path);
    const node = {
      path,
      name: baseName(path),
      folders: [],
      files: [],
      id: path,
      expanded: stored ? stored.expanded !== false : false,
    };
    parent.folders.push(node);
    nodes.set(path, node);
    return node;
  };

  for (const folder of vfs.folders) nodeFor(folder.path);
  for (const file of vfs.files) nodeFor(dirName(file.path)).files.push(file);

  const sort = (node) => {
    node.folders.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.name.localeCompare(b.name));
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}

export default VirtualFileSystem;

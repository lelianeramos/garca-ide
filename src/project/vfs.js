import { createFile } from "../core/store.js";

export class VirtualFileSystem {
  constructor(store) { this.store = store; }
  create(name, folder = "/") {
    const safe = name.trim().replace(/[^\w.-]/g, "_");
    if (!safe.endsWith(".py")) throw new Error("Use um arquivo .py");
    const path = `${folder.replace(/\/$/, "")}/${safe}`;
    if (this.store.state.project.files.some(file => file.path === path)) throw new Error("Já existe um arquivo com esse nome");
    const file = createFile(crypto.randomUUID(), safe, path, "");
    this.store.update(state => { state.project.files.push(file); state.activeFileId = file.file_id; }, "criar arquivo");
    return file;
  }
  duplicate(file) {
    const copy = this.create(file.name.replace(/\.py$/, "_copia.py"), file.path.slice(0, file.path.lastIndexOf("/")));
    copy.content = file.content; copy.modified = true;
    return copy;
  }
  rename(file, nextName) {
    const safe = nextName.endsWith(".py") ? nextName : `${nextName}.py`;
    const oldModule = file.module_name;
    const folder = file.path.slice(0, file.path.lastIndexOf("/"));
    const newPath = `${folder}/${safe}`;
    if (this.store.state.project.files.some(item => item !== file && item.path === newPath)) throw new Error("Esse nome já está em uso");
    const newModule = newPath.replace(/^\//, "").replace(/\.py$/, "").replaceAll("/", ".");
    this.store.update(state => {
      const target = state.project.files.find(item => item.file_id === file.file_id);
      target.name = safe; target.path = newPath; target.module_name = newModule; target.modified = true;
      const importPattern = new RegExp(`(?<=\\b(?:from|import)\\s)${escapeRegExp(oldModule)}\\b`, "g");
      for (const item of state.project.files) item.content = item.content.replace(importPattern, newModule);
    }, "renomear arquivo");
  }
  remove(file) {
    const dependents = this.store.state.project.files.filter(item => item.content.includes(file.module_name) && item !== file);
    if (dependents.length && !confirm(`Este arquivo é usado por ${dependents.map(item => item.name).join(", ")}. Excluir mesmo assim?`)) return;
    this.store.update(state => {
      state.project.files = state.project.files.filter(item => item.file_id !== file.file_id);
      if (!state.project.files.length) state.project.files.push(createFile("file-output-1", "saida_1.py", "/programacao/saidas/saida_1.py", ""));
      state.activeFileId = state.project.files[0].file_id;
    }, "excluir arquivo");
  }
  importLegacy(text, name = "projeto.lls") {
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error("O projeto .lls não é um JSON válido"); }
    const entries = parsed.files || parsed.project?.files || [];
    if (!Array.isArray(entries) || !entries.length) throw new Error("Nenhum arquivo Python foi encontrado no projeto");
    this.store.update(state => {
      for (const entry of entries) {
        const path = entry.path?.startsWith("/") ? entry.path : `/${entry.path || entry.name}`;
        state.project.files.push(createFile(entry.file_id || crypto.randomUUID(), entry.name || path.split("/").at(-1), path, entry.content || entry.code || ""));
      }
    }, `importar ${name}`);
  }
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

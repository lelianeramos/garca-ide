/**
 * BOOTSTRAP — fachada usada pela UI (Parte 4.1)
 * ---------------------------------------------
 * Ponto único de partida do frontend. Tudo que toca o DOM está DENTRO de
 * funções chamadas após o documento existir: este módulo nunca executa
 * `document` no topo do arquivo. É isso que impede a repetição do erro
 * "ReferenceError: document is not defined" (B20) se o arquivo for carregado
 * fora do navegador.
 *
 * Regra R01: frontend vive em studio-*.js / src/**. Nada em api/**.
 */

import { CATEGORIES, CATEGORY_COLOR, PYBRICKS_API, IMPORTABLE, MODULES } from "./pybricks/apiRegistry.js";
import { BLOCK_CATALOG, BLOCK_BY_ID, blocksByCategory, blockDefaults } from "./blocks/blockCatalog.js";
import { renderPaletteBlock, renderBlock, renderStack, ptNumber, staticLabel } from "./blocks/blockRenderer.js";
import { SyncManager, SYNC_STATE } from "./editor/syncManager.js";
import { EditorView } from "./ui/editorView.js";
import { Workspace } from "./ui/workspace.js";
import { Terminal, LEVEL } from "./ui/terminal.js";
import { GitHubPanel, repositoryPath } from "./ui/githubPanel.js";
import { VirtualFileSystem, LIBRARY_TEMPLATE, buildTree, normalizePath, baseName, dirName, sanitizeFileName, uniquePath } from "./ui/vfs.js";
import { History } from "./ui/history.js";
import { sound } from "./ui/sound.js";
import { icon, categoryIcon, CATEGORY_ICONS } from "./ui/icons.js";
import { bundleProject, preflight } from "./python/bundler.js";
import { generateProgram, ensureImports } from "./python/codeGenerator.js";
import { librarySymbols, IMPORT_STATE } from "./semantic/analyzer.js";

const STORAGE_KEY = "garca-studio:project:v2";
const PREFS_KEY = "garca-studio:prefs:v1";
const LEGACY_KEYS = ["garca-studio:project", "garca-ide:project", "garca:draft"];

/**
 * Guarda contra execução fora do navegador (B20).
 * Se um dia este módulo for carregado por engano no Node, ele apenas exporta
 * `start()` e não toca em `document`.
 */
const hasDom = typeof window !== "undefined" && typeof document !== "undefined";

export function start() {
  if (!hasDom) return null;
  const studio = new Studio();
  window.GarcaStudio = studio;
  studio.boot();
  return studio;
}

/* ------------------------------------------------------------------ */
/* Aplicação                                                           */
/* ------------------------------------------------------------------ */

class Studio {
  constructor() {
    this.dom = {};
    this.vfs = null;
    this.history = new History();
    this.sync = new SyncManager({ onChange: (payload) => this.onSync(payload) });
    this.activeFileId = null;
    this.activeCategory = "motors";
    this.applyingFromBlocks = false;
    this.outputs = [];
    this.prefs = { sound: true, volume: 24, githubOpen: false, explorerOpen: true, libraryOpen: true };
    this.hub = { state: "DISCONNECTED", device: null, server: null, battery: null, firmware: null, model: null };
    this.dragSchema = null;
  }

  /* ============================== BOOT ============================== */

  boot() {
    this.collectDom();
    this.migrateLegacyStorage();   // B16: não ressuscitar o programa de exemplo
    this.loadPrefs();
    this.loadProject();            // B16: projeto novo começa VAZIO
    this.buildEditor();
    this.buildWorkspace();
    this.buildTerminal();
    this.buildGithubPanel();
    this.renderCategories();
    this.renderExplorer();
    this.renderOutputTabs();
    this.bindToolbar();
    this.bindExplorer();
    this.bindShortcuts();
    this.bindContextMenus();
    this.bindPreferences();
    this.bindPaletteScroll();      // pedido do usuário: rolar a paleta com a roda do mouse
    this.bindDesktopOnlyNotice();
    this.openFile(this.vfs.project.entrypoint ?? this.vfs.files[0]?.file_id, { initial: true });

    this.terminal.info("Garça de Botas Code Studio pronto.");
    this.terminal.info("Escreva Python ou arraste blocos — as duas vistas se atualizam sozinhas.");
    this.refreshLibrarySymbols();
    this.github?.loadUsers();
    this.updateHubCard();

    // Rascunho salvo automaticamente (Parte 25)
    this.autosaveTimer = setInterval(() => this.autosave(), 4000);
    window.addEventListener("beforeunload", () => this.saveProject());
  }

  collectDom() {
    const id = (name) => document.getElementById(name);
    const all = (selector) => [...document.querySelectorAll(selector)];
    this.dom = {
      app: id("app"),
      mainGrid: id("mainGrid"),
      // toolbar
      filesToggle: id("filesToggle"), newBtn: id("newBtn"), settingsBtn: id("settingsBtn"),
      connectBtn: id("connectBtn"), runBtn: id("runBtn"), stopBtn: id("stopBtn"), downloadBtn: id("downloadBtn"),
      hubCard: id("hubCard"), hubState: id("hubState"), hubModel: id("hubModel"), hubBattery: id("hubBattery"),
      githubToggle: id("githubToggle"), profileStack: id("profileStack"),
      // saídas
      outputTabs: id("outputTabs"), addOutput: id("addOutput"),
      // explorador
      fileExplorer: id("fileExplorer"), fileTree: id("fileTree"), projectName: document.querySelector(".project-name"),
      newFileBtn: id("newFileBtn"), newFolderBtn: id("newFolderBtn"), importFileBtn: id("importFileBtn"),
      fileImportInput: id("fileImportInput"), libraryTemplateBtn: id("libraryTemplateBtn"),
      dependencyBtn: id("dependencyBtn"),
      // blocos
      categories: id("categories"), library: id("library"), categoryTitle: id("categoryTitle"),
      collapseLibrary: id("collapseLibrary"), libraryList: id("libraryList"),
      workspace: id("workspace"), workspaceWorld: id("workspaceWorld"), blockStack: id("blockStack"),
      // editor
      codeEditor: id("codeEditor"), lineNumbers: id("lineNumbers"), highlight: id("highlight"),
      autocomplete: id("autocomplete"), activeFileTab: id("activeFileTab"), fileDirty: id("fileDirty"),
      syncState: id("syncState"), diagnosticRuler: id("diagnosticRuler"), editorStatus: id("editorStatus"),
      // terminal
      terminalLines: id("terminalLines"), clearTerminal: id("clearTerminal"), problemCount: id("problemCount"),
      terminalTabs: all(".terminal-head button[data-tab]"),
      // github
      githubPanel: id("githubPanel"), closeGithub: id("closeGithub"), contributor: id("contributor"),
      repoPath: id("repoPath"), commitMessage: id("commitMessage"), commitBtn: id("commitBtn"),
      // perfil
      profilePanel: id("profilePanel"), closeProfile: id("closeProfile"), profileName: id("profileName"),
      profileSummary: id("profileSummary"), versionRanking: id("versionRanking"),
      // preferências
      preferencesPopover: id("preferencesPopover"), closePreferences: id("closePreferences"),
      soundEnabled: id("soundEnabled"), soundVolume: id("soundVolume"),
      // diversos
      fileContextMenu: id("fileContextMenu"), blockContextMenu: id("blockContextMenu"),
      projectDialog: id("projectDialog"), dialogTitle: id("dialogTitle"), dialogText: id("dialogText"),
      dialogFieldLabel: id("dialogFieldLabel"), dialogInput: id("dialogInput"),
      dialogSelectLabel: id("dialogSelectLabel"), dialogSelect: id("dialogSelect"),
      toast: id("toast"), statusFile: id("statusFile"), footerHub: id("footerHub"),
    };
  }

  /**
   * B16: migra/limpa rascunhos antigos do localStorage para o exemplo
   * pré-carregado não ressuscitar.
   */
  migrateLegacyStorage() {
    try {
      for (const key of LEGACY_KEYS) localStorage.removeItem(key);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 2) localStorage.removeItem(STORAGE_KEY);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /* ============================ PROJETO ============================ */

  loadProject() {
    let restored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.version === 2 && parsed.files?.length) restored = VirtualFileSystem.fromJSON(parsed);
      }
    } catch { restored = null; }

    this.vfs = restored ?? VirtualFileSystem.emptyProject();
    this.sync.setLibraryFiles(this.vfs.files);
    this.outputs = this.vfs.files
      .filter((file) => /^\/missions\/saida_\d+\.py$/.test(file.path))
      .sort((a, b) => outputNumber(a.path) - outputNumber(b.path))
      .map((file) => file.file_id);
    if (!this.outputs.length && this.vfs.files.length) this.outputs = [this.vfs.files[0].file_id];
  }

  saveProject() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.vfs.toJSON()));
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch { /* quota cheia: mantém a sessão funcionando */ }
  }

  autosave() {
    const dirty = this.vfs.files.some((file) => file.modified);
    if (!dirty) return;
    this.saveProject();
    this.flashSaved();
  }

  flashSaved() {
    const node = this.dom.fileDirty;
    if (!node) return;
    node.textContent = "Rascunho salvo";
    node.classList.add("saved");
    clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => { node.classList.remove("saved"); node.textContent = ""; }, 1600);
  }

  loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) this.prefs = { ...this.prefs, ...JSON.parse(raw) };
    } catch { /* ignora */ }
    sound.setEnabled(this.prefs.sound);
    sound.setVolume(this.prefs.volume);
    if (this.dom.soundEnabled) this.dom.soundEnabled.checked = Boolean(this.prefs.sound);
    if (this.dom.soundVolume) this.dom.soundVolume.value = String(this.prefs.volume);
  }

  /* ============================ ARQUIVOS ============================ */

  get activeFile() { return this.vfs.byId(this.activeFileId); }

  openFile(fileId, { initial = false } = {}) {
    const file = this.vfs.byId(fileId);
    if (!file) return;

    if (this.activeFileId && this.activeFileId !== fileId) {
      const current = this.activeFile;
      if (current) {
        current.blocks = this.sync.blocks;
        current.view = this.workspace?.view ?? current.view;
      }
      this.history.touch(this.activeFileId, this.editor?.value ?? "", this.editor?.caret ?? 0);
    }

    this.activeFileId = fileId;
    file.blocksFromCode = false;
    this.editor?.setValue(file.content, { caret: 0, silent: true });
    this.history.touch(fileId, file.content, 0);

    if (this.dom.activeFileTab) this.dom.activeFileTab.textContent = file.path.replace(/^\//, "");
    if (this.dom.statusFile) this.dom.statusFile.textContent = `Arquivo: ${file.name}`;
    if (this.dom.repoPath) this.dom.repoPath.value = repositoryPath(file, this.activeOutputNumber);

    this.workspace?.setView(file.view ?? { panX: 24, panY: 18, zoom: 1 });
    this.sync.libraryFunctions = this.vfs.libraryFunctions(file);
    this.sync.projectAnalysis = this.vfs.analysis;
    this.refreshEditorScope();

    if (!initial) {
      this.terminal.info(`Aberto ${file.path.replace(/^\//, "")}`);
      sound.play("click");
    }

    // pipeline imediato — nunca espera blur (B02)
    this.sync.runPipeline(file.content);
    this.renderExplorer();
    this.renderOutputTabs();
  }

  get activeOutputNumber() {
    const path = this.activeFile?.path ?? "";
    const match = /saida_(\d+)\.py$/.exec(path);
    return match ? Number(match[1]) : null;
  }

  refreshLibrarySymbols() {
    this.sync.setLibraryFiles(this.vfs.files);
    this.refreshEditorScope();
    this.renderLibrary();
    const broken = this.sync.brokenImports;
    for (const entry of broken) {
      if (entry.file !== this.activeFile?.path) continue;
      this.terminal.write(entry.message, entry.state === IMPORT_STATE.SYMBOL_NOT_FOUND ? LEVEL.WARNING : LEVEL.ERROR, { tab: "problems" });
    }
  }

  refreshEditorScope() {
    if (!this.editor) return;
    const file = this.activeFile;
    const symbols = file?.symbols ?? this.sync.symbols ?? {};
    const moduleSymbols = {};
    for (const other of this.vfs.files) {
      if (!other.module_name) continue;
      moduleSymbols[other.module_name] = [
        ...(other.symbols?.functions ?? []).map((fn) => ({ name: fn.name, kind: "function", doc: `def ${fn.name}(${(fn.args ?? []).join(", ")})` })),
        ...(other.symbols?.classes ?? []).map((cls) => ({ name: cls.name, kind: "class" })),
        ...(other.symbols?.variables ?? []).map((v) => ({ name: v.name, kind: "variable" })),
      ];
      // também resolve pelo nome curto: from movements import ...
      const short = other.module_name.split(".").pop();
      if (short && !moduleSymbols[short]) moduleSymbols[short] = moduleSymbols[other.module_name];
    }

    this.editor.setScope({
      variables: (symbols.variables ?? []).map((v) => v.name),
      functions: symbols.functions ?? [],
      classes: symbols.classes ?? [],
      modules: this.vfs.moduleNames,
      moduleSymbols,
      types: symbols.types ?? {},
    });
  }

  /* =========================== EXPLORADOR =========================== */

  renderExplorer() {
    const tree = this.dom.fileTree;
    if (!tree || !this.vfs) return;
    const root = buildTree(this.vfs);
    const fragment = document.createDocumentFragment();
    this.renderTreeNode(root, fragment, 0);
    tree.replaceChildren(fragment);
    if (this.dom.projectName) this.dom.projectName.textContent = this.vfs.project.name.toUpperCase();
  }

  renderTreeNode(node, container, depth) {
    const isRoot = depth === 0;

    if (!isRoot) {
      const row = document.createElement("div");
      row.className = `tree-row folder-row ${node.expanded === false ? "collapsed" : "expanded"}`;
      row.dataset.path = node.path;
      row.dataset.kind = "folder";
      row.style.paddingLeft = `${6 + depth * 11}px`;
      row.innerHTML = `${icon("chevron", { size: 14, className: "twisty" })}${icon("folder", { size: 15, className: "folder-icon" })}<span class="tree-label">${escapeHtml(node.name)}</span>`;
      row.addEventListener("click", () => {
        node.expanded = node.expanded === false;
        const folder = this.vfs.folders.find((item) => item.path === node.path);
        if (folder) folder.expanded = node.expanded;
        this.renderExplorer();
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.openContextMenu(this.dom.fileContextMenu, event, folderMenuItems(this, node));
      });
      container.appendChild(row);
      if (node.expanded === false) return;
    }

    // B22: fade + slide escalonado em 18 ms
    const children = [...node.folders, ...node.files];
    children.forEach((child, index) => {
      if (child.files) {
        this.renderTreeNode(child, container, depth + 1);
        return;
      }
      const row = document.createElement("div");
      row.className = `tree-row tree-enter${child.file_id === this.activeFileId ? " active" : ""}${child.syntaxError ? " broken" : ""}`;
      row.dataset.fileId = child.file_id;
      row.dataset.kind = "file";
      row.style.paddingLeft = `${6 + (depth + 1) * 11}px`;
      row.style.animationDelay = `${Math.min(index, 8) * 18}ms`;
      row.draggable = true;

      const isLibrary = child.path.startsWith("/libraries/") || child.name === "movements.py";
      const isEntry = this.vfs.project.entrypoint === child.file_id;
      row.innerHTML =
        `${icon(isLibrary ? "module" : "fileCode", { size: 15, className: isLibrary ? "lib-icon" : "file-icon" })}` +
        `<span class="tree-label">${escapeHtml(child.name)}</span>` +
        (isEntry ? `<span class="badge-entry" title="Arquivo de entrada">${icon("entry", { size: 12 })}</span>` : "") +
        (child.modified ? `<span class="dirty" title="Alterações não enviadas">${icon("minus", { size: 10 })}</span>` : "") +
        (child.gitStatus === "novo" ? `<span class="badge" title="Arquivo novo">novo</span>` : "");

      row.title = `${child.path.replace(/^\//, "")}\nMódulo: ${child.module_name}\nFunções: ${child.symbols?.functions?.length ?? 0}\nUsado por: ${(child.usedBy ?? []).length} arquivo(s)`;
      row.addEventListener("click", () => this.openFile(child.file_id));
      row.addEventListener("dblclick", () => this.renameFile(child.file_id));
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.openContextMenu(this.dom.fileContextMenu, event, fileMenuItems(this, child));
      });
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/garca-file", child.file_id);
        event.dataTransfer.effectAllowed = "move";
      });
      container.appendChild(row);
    });
  }

  bindExplorer() {
    const { newFileBtn, newFolderBtn, importFileBtn, fileImportInput, libraryTemplateBtn, dependencyBtn, fileTree, filesToggle } = this.dom;

    newFileBtn?.addEventListener("click", () => this.promptNewFile());
    newFolderBtn?.addEventListener("click", () => this.promptNewFolder());
    importFileBtn?.addEventListener("click", () => fileImportInput?.click());
    libraryTemplateBtn?.addEventListener("click", () => this.createLibraryTemplate());
    dependencyBtn?.addEventListener("click", () => this.showDependencies());
    filesToggle?.addEventListener("click", () => {
      this.prefs.explorerOpen = !this.prefs.explorerOpen;
      this.dom.mainGrid?.classList.toggle("explorer-open", this.prefs.explorerOpen);
      this.saveProject();
    });

    fileImportInput?.addEventListener("change", (event) => {
      const [file] = event.target.files ?? [];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.importPythonFile(file.name, String(reader.result ?? ""));
      reader.readAsText(file);
      event.target.value = "";
    });

    // Drop de arquivo .py do sistema operacional direto na árvore
    fileTree?.addEventListener("dragover", (event) => { event.preventDefault(); fileTree.classList.add("drop-hint"); });
    fileTree?.addEventListener("dragleave", () => fileTree.classList.remove("drop-hint"));
    fileTree?.addEventListener("drop", (event) => {
      event.preventDefault();
      fileTree.classList.remove("drop-hint");
      const movedId = event.dataTransfer?.getData("text/garca-file");
      const targetRow = event.target.closest(".tree-row");
      if (movedId && targetRow) { this.moveFileTo(movedId, targetRow); return; }
      const [file] = event.dataTransfer?.files ?? [];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => this.importPythonFile(file.name, String(reader.result ?? ""));
        reader.readAsText(file);
      }
    });
  }

  async importPythonFile(name, content) {
    const clean = sanitizeFileName(name).replace(/\.py$/, "") + ".py";
    const target = await this.promptDestination(clean);
    if (!target) return;
    const path = uniquePath(this.vfs, normalizePath(`${target}/${clean}`));
    const file = this.vfs.createFile(path, content);
    this.refreshLibrarySymbols();
    this.renderExplorer();
    this.openFile(file.file_id);
    this.terminal.success(`Importado ${path.replace(/^\//, "")} — ${file.symbols.functions.length} função(ões) indexada(s) para o autocomplete.`);
    sound.play("snap");
  }

  createLibraryTemplate() {
    const path = uniquePath(this.vfs, "/libraries/movements.py");
    const file = this.vfs.createFile(path, LIBRARY_TEMPLATE);
    this.refreshLibrarySymbols();
    this.renderExplorer();
    this.openFile(file.file_id);
    this.terminal.info("Biblioteca de movimentos criada em libraries/movements.py.");
    this.terminal.info("Escreva a implementação de gyro_move, gyro_turn e gyro_curve. Assim que existirem, elas viram blocos na categoria Bibliotecas.");
    sound.play("snap");
  }

  promptNewFile() {
    this.openDialog({
      title: "Novo arquivo",
      text: "Escolha o nome do arquivo Python. Ele vira um módulo importável.",
      fieldLabel: "Nome",
      value: "novo_modulo.py",
      selectLabel: "Destino",
      options: this.folderOptions(),
      onConfirm: ({ value, select }) => {
        const name = sanitizeFileName(value).replace(/\.py$/, "") + ".py";
        const path = uniquePath(this.vfs, normalizePath(`${select}/${name}`));
        const file = this.vfs.createFile(path, "");
        this.refreshLibrarySymbols();
        this.renderExplorer();
        this.openFile(file.file_id);
        this.terminal.success(`Arquivo criado: ${path.replace(/^\//, "")}`);
      },
    });
  }

  promptNewFolder() {
    this.openDialog({
      title: "Nova pasta",
      text: "Pastas organizam os módulos do projeto.",
      fieldLabel: "Nome",
      value: "nova_pasta",
      selectLabel: "Dentro de",
      options: this.folderOptions(),
      onConfirm: ({ value, select }) => {
        const name = sanitizeFileName(value);
        this.vfs.createFolder(normalizePath(`${select}/${name}`));
        this.renderExplorer();
        this.terminal.success(`Pasta criada: ${normalizePath(`${select}/${name}`).replace(/^\//, "")}`);
      },
    });
  }

  folderOptions() {
    return this.vfs.folders.map((folder) => ({ value: folder.path, label: folder.path.replace(/^\//, "") || "/" }));
  }

  promptDestination(fileName) {
    return new Promise((resolve) => {
      this.openDialog({
        title: "Importar arquivo",
        text: `Onde ${fileName} deve ficar?`,
        fieldLabel: "Nome",
        value: fileName,
        selectLabel: "Destino",
        options: this.folderOptions(),
        onConfirm: ({ value, select }) => resolve({ value, select }),
        onCancel: () => resolve(null),
      });
    }).then((result) => (result ? normalizePath(`${result.select}/${sanitizeFileName(result.value)}`) : null));
  }

  renameFile(fileId) {
    const file = this.vfs.byId(fileId);
    if (!file) return;
    const references = this.vfs.findReferences(file.module_name, fileId);
    const referenceText = references.length
      ? `\n\nEste arquivo possui ${references.reduce((sum, item) => sum + item.count, 0)} referência(s) de import que serão atualizadas:\n${references.map((item) => `  ${item.file.path.replace(/^\//, "")}  (${item.count})`).join("\n")}`
      : "";

    this.openDialog({
      title: "Renomear arquivo",
      text: `Caminho atual: ${file.path}${referenceText}`,
      fieldLabel: "Novo nome",
      value: file.name,
      selectLabel: references.length ? "" : null,
      options: [],
      confirmLabel: references.length ? "Atualizar referências" : "Renomear",
      onConfirm: ({ value }) => {
        const name = sanitizeFileName(value).replace(/\.py$/, "") + ".py";
        try {
          this.vfs.rename(fileId, normalizePath(`${dirName(file.path)}/${name}`), { updateReferences: true });
        } catch (error) {
          this.toast(error.message, "error");
          this.terminal.error(error.message);
          return;
        }
        this.refreshLibrarySymbols();
        this.renderExplorer();
        if (this.activeFileId === fileId) {
          this.dom.activeFileTab.textContent = this.vfs.byId(fileId).path.replace(/^\//, "");
          this.dom.repoPath.value = repositoryPath(this.vfs.byId(fileId));
        }
        this.terminal.success(`Renomeado para ${name}${references.length ? ` — ${references.length} arquivo(s) com imports atualizados.` : "."}`);
      },
    });
  }

  moveFileTo(fileId, targetRow) {
    const file = this.vfs.byId(fileId);
    if (!file) return;
    const kind = targetRow.dataset.kind;
    const destination = kind === "folder"
      ? targetRow.dataset.path
      : dirName(targetRow.dataset.fileId ? this.vfs.byId(targetRow.dataset.fileId)?.path ?? "/" : "/");
    if (normalizePath(destination) === dirName(file.path)) return;

    try {
      this.vfs.rename(fileId, normalizePath(`${destination}/${file.name}`), { updateReferences: true });
    } catch (error) {
      this.toast(error.message, "error");
      return;
    }
    this.refreshLibrarySymbols();
    this.renderExplorer();
    this.terminal.success(`${file.name} movido para ${destination.replace(/^\//, "") || "/"}. Imports atualizados.`);
  }

  removeFile(fileId) {
    const file = this.vfs.byId(fileId);
    if (!file) return;
    const dependents = this.vfs.dependentsOf(fileId);
    const warning = dependents.length
      ? `${dependents.length} arquivo(s) dependem dele:\n${dependents.map((item) => `  ${item.path.replace(/^\//, "")}`).join("\n")}`
      : "Nenhum outro arquivo depende dele.";

    this.openDialog({
      title: "Excluir arquivo",
      text: `Excluir ${file.name}?\n\n${warning}`,
      fieldLabel: null,
      confirmLabel: "Excluir",
      danger: true,
      onConfirm: () => {
        this.vfs.remove(fileId);
        if (this.activeFileId === fileId) {
          this.activeFileId = null;
          this.openFile(this.vfs.files[0]?.file_id);
        }
        this.refreshLibrarySymbols();
        this.renderExplorer();
        this.renderOutputTabs();
        this.terminal.warning(`${file.name} excluído.`);
        sound.play("remove");
      },
    });
  }

  showDependencies() {
    const file = this.activeFile;
    if (!file) return;
    const direct = (this.vfs.analysis.graph[file.path] ?? []).map((path) => path.replace(/^\//, ""));
    const reverse = (this.vfs.analysis.reverse[file.path] ?? []).map((path) => path.replace(/^\//, ""));
    const cycles = this.vfs.analysis.cycles ?? [];

    this.terminal.info(`Dependências de ${file.path.replace(/^\//, "")}`);
    this.terminal.write(`  usa:        ${direct.length ? direct.join(", ") : "—"}`, LEVEL.INFO);
    this.terminal.write(`  usado por:  ${reverse.length ? reverse.join(", ") : "—"}`, LEVEL.INFO);
    if (cycles.length) {
      this.terminal.error(`Ciclo de import detectado: ${cycles[0].join(" → ")}`);
    } else {
      this.terminal.success("  sem ciclos de import");
    }
  }

  /* =========================== CATEGORIAS =========================== */

  /**
   * Parte 11/20.3: divisão IDÊNTICA ao LEGO Education SPIKE.
   * Parte 9.6: o código decide a ordem — as categorias presentes no programa
   * aparecem primeiro; as demais continuam acessíveis logo abaixo.
   */
  renderCategories() {
    const nav = this.dom.categories;
    if (!nav) return;
    const priority = this.prioritizedCategories();

    const ordered = [
      ...CATEGORIES.filter((category) => priority.includes(category.id)),
      ...CATEGORIES.filter((category) => !priority.includes(category.id)),
    ];

    nav.replaceChildren(...ordered.map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.category = category.id;
      button.className = category.id === this.activeCategory ? "active" : "";
      button.style.setProperty("--color", category.color);
      const count = blocksByCategory(category.id).length + this.dynamicCount(category.id);
      button.innerHTML = `${categoryIcon(category.id, 15)}<span>${category.name}</span><i aria-hidden="true"></i><em class="cat-count">${count}</em>`;
      button.title = `${category.name} — ${count} blocos`;
      button.setAttribute("aria-pressed", String(category.id === this.activeCategory));
      button.addEventListener("click", () => {
        this.activeCategory = category.id;
        nav.querySelectorAll("button").forEach((item) => {
          const active = item.dataset.category === category.id;
          item.classList.toggle("active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        this.renderLibrary();
        sound.play("click");
      });
      return button;
    }));
  }

  /** Quantos blocos dinâmicos uma categoria tem (Bibliotecas / Meus blocos). */
  dynamicCount(categoryId) {
    if (categoryId === "libraries") return librarySymbols(this.vfs?.files ?? []).length;
    if (categoryId === "myblocks") return (this.activeFile?.symbols?.functions ?? []).length;
    return 0;
  }

  /** 9.6: descobre pelo código o que o usuário está usando agora. */
  prioritizedCategories() {
    const code = this.activeFile?.content ?? "";
    const hits = new Map();
    const bump = (id, weight = 1) => hits.set(id, (hits.get(id) ?? 0) + weight);

    const scan = (pattern, id, weight = 1) => { if (pattern.test(code)) bump(id, weight); };

    scan(/\bMotor\s*\(|\.run_angle\(|\.run_target\(|\.run\(|\.brake\(|\.hold\(/, "motors", 3);
    scan(/\bDriveBase\s*\(|\.straight\(|\.turn\(|\.curve\(|\.drive\(/, "movement", 3);
    scan(/ColorSensor|UltrasonicSensor|ForceSensor|\.color\(|\.distance\(|\.pressed\(|\.imu\./, "sensors", 2);
    scan(/speaker\.|\.beep\(|play_notes/, "sound", 2);
    scan(/display\.|light\.|\bIcon\./, "light", 2);
    scan(/\bwait\s*\(|\bwhile\b|\bfor\b|\bif\b|StopWatch/, "control", 2);
    scan(/PrimeHub|InventorHub|TechnicHub|\bhub\./, "hub", 2);
    scan(/^\s*def\s+\w+/m, "myblocks", 2);
    scan(/^\s*\w+\s*=|\bprint\(/m, "variables", 1);
    scan(/buttons\.pressed|mailbox|quando/i, "events", 2);
    scan(/[+\-*/%]|randint|\babs\(|\bround\(|\blen\(/, "operators", 1);

    if (librarySymbols(this.vfs?.files ?? []).length) bump("libraries", 3);

    return [...hits.entries()]
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }

  /* =========================== BIBLIOTECA =========================== */

  renderLibrary() {
    const list = this.dom.libraryList;
    if (!list) return;
    const category = CATEGORIES.find((item) => item.id === this.activeCategory) ?? CATEGORIES[0];
    if (this.dom.categoryTitle) this.dom.categoryTitle.textContent = category.name;

    const blocks = this.blocksForCategory(category.id);
    if (!blocks.length) {
      list.innerHTML = `<div class="library-empty">
        ${icon(category.icon ?? "blocks", { size: 26 })}
        <p>${emptyCategoryText(category.id)}</p>
      </div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const block of blocks) {
      const node = this.buildPaletteNode(block);
      if (node) fragment.appendChild(node);
    }
    list.replaceChildren(fragment);
    list.scrollTop = 0;
  }

  /** Blocos estáticos + dinâmicos (Bibliotecas / Meus blocos). */
  blocksForCategory(categoryId) {
    const staticBlocks = blocksByCategory(categoryId);
    if (categoryId === "libraries") {
      const dynamic = librarySymbols(this.vfs?.files ?? []).map((symbol) => ({
        blockId: "library_call",
        dynamic: true,
        symbol,
      }));
      return [...staticBlocks, ...dynamic];
    }
    if (categoryId === "myblocks") {
      const dynamic = (this.activeFile?.symbols?.functions ?? [])
        .filter((fn) => fn.name !== "main")
        .map((fn) => ({ blockId: "myblock_call", dynamic: true, symbol: fn }));
      return [...staticBlocks, ...dynamic];
    }
    return staticBlocks;
  }

  /**
   * Bloco da paleta.
   *
   * PEDIDO DO USUÁRIO: os blocos da biblioteca têm os mesmos nomes do LEGO
   * Education, mas ali eles NÃO são editáveis — são modelos. A edição acontece
   * depois de inserir no programa (Parte 13).
   */
  buildPaletteNode(entry) {
    if (entry.dynamic) return this.buildDynamicPaletteNode(entry);
    const spec = BLOCK_BY_ID.get(entry.blockId ?? entry.id);
    if (!spec) return null;

    const defaults = blockDefaults(spec);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `library-block shape-${spec.shape}`;
    button.dataset.schema = spec.id;
    button.dataset.category = spec.category;
    button.style.setProperty("--color", CATEGORY_COLOR[spec.category] ?? "#42546a");
    button.draggable = true;
    button.title = `${spec.doc}\n\nArraste para a área de blocos, ou dê dois cliques para inserir no fim do programa.`;
    button.setAttribute("aria-label", `${staticLabel(spec, defaults)}. ${spec.doc}`);
    // Nenhum cadeado, nenhum aviso de "sem equivalente" (B03/B04/N03)
    button.innerHTML = `<span class="lib-label">${escapeHtml(staticLabel(spec, defaults))}</span>`;

    button.addEventListener("dragstart", (event) => {
      this.dragSchema = spec.id;
      event.dataTransfer?.setData("text/garca-block", spec.id);
      event.dataTransfer?.setData("text/plain", spec.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => { this.dragSchema = null; button.classList.remove("dragging"); });
    button.addEventListener("dblclick", () => this.insertFromPalette(spec.id));
    button.addEventListener("click", () => sound.play("click"));
    return button;
  }

  /** 11.16: categoria dinâmica gerada a partir dos símbolos do VFS. */
  buildDynamicPaletteNode(entry) {
    const symbol = entry.symbol;
    const isLibrary = entry.blockId === "library_call";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `library-block shape-stack ${isLibrary ? "from-library" : "from-myblocks"}`;
    button.dataset.schema = entry.blockId;
    button.dataset.function = symbol.name;
    button.dataset.module = symbol.module ?? "";
    button.style.setProperty("--color", CATEGORY_COLOR[isLibrary ? "libraries" : "myblocks"]);
    button.draggable = true;
    const args = (symbol.args ?? []).join(", ");
    button.title = isLibrary
      ? `Função de ${symbol.module ?? "biblioteca"}\n\ndef ${symbol.name}(${args})\n\nArraste para usar. O import é adicionado automaticamente.`
      : `Sua função\n\ndef ${symbol.name}(${args})`;
    button.innerHTML = `<span class="lib-label">${escapeHtml(symbol.name)}${args ? ` <em class="lib-args">(${escapeHtml(args)})</em>` : ""}</span>`;

    button.addEventListener("dragstart", (event) => {
      this.dragSchema = entry.blockId;
      this.dragSymbol = symbol;
      event.dataTransfer?.setData("text/garca-block", entry.blockId);
      event.dataTransfer?.setData("text/garca-function", symbol.name);
      event.dataTransfer?.setData("text/garca-module", symbol.module ?? "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    button.addEventListener("dragend", () => { this.dragSchema = null; this.dragSymbol = null; });
    button.addEventListener("dblclick", () => this.insertDynamic(entry.blockId, symbol));
    return button;
  }

  insertFromPalette(schema) {
    const spec = BLOCK_BY_ID.get(schema);
    if (!spec) return;
    const block = makeBlockInstance(spec, blockDefaults(spec));
    this.sync.insertBlockIntoCode(block);
    this.editor?.setValue(this.sync.code, { silent: true });
    this.persistActiveFile();
    sound.play("snap");
    this.terminal.info(`Bloco inserido: ${staticLabel(spec, block.params)}`);
  }

  insertDynamic(blockId, symbol) {
    const spec = BLOCK_BY_ID.get(blockId);
    if (!spec) return;
    const params = { name: symbol.name, args: (symbol.args ?? []).join(", "), module: symbol.module ?? "" };
    const block = makeBlockInstance(spec, { ...blockDefaults(spec), ...params });
    this.sync.insertBlockIntoCode(block);
    this.editor?.setValue(this.sync.code, { silent: true });
    this.persistActiveFile();
    sound.play("snap");
    if (symbol.module) {
      this.terminal.success(`${symbol.module}.py encontrado`);
      this.terminal.info(`import adicionado automaticamente: from ${symbol.module} import ${symbol.name}`);
    }
  }

  /**
   * PEDIDO DO USUÁRIO — "não quero scroll de scroll, quero ver as opções com a
   * roda do mouse sem aquele negócio feio e engessado".
   *
   * A paleta (e as categorias, e a árvore de arquivos) rolam com a roda do
   * mouse e a barra de rolagem fica INVISÍVEL. A rolagem é encadeada de forma
   * natural: só passa para o pai quando o filho chegou ao fim.
   */
  bindPaletteScroll() {
    const targets = [this.dom.libraryList, this.dom.categories, this.dom.fileTree];
    for (const element of targets) {
      if (!element) continue;
      element.classList.add("smooth-scroll");
      element.addEventListener("wheel", (event) => {
        const atTop = element.scrollTop <= 0 && event.deltaY < 0;
        const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1 && event.deltaY > 0;
        // Deixa o evento subir naturalmente quando não há mais o que rolar,
        // em vez de travar a roda (nada de "engessado").
        if (atTop || atBottom) return;
        event.preventDefault();
        event.stopPropagation();
        element.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      }, { passive: false });

      // Indicador suave de que existe mais conteúdo abaixo/above
      const updateFade = () => {
        element.classList.toggle("fade-top", element.scrollTop > 4);
        element.classList.toggle("fade-bottom", element.scrollTop + element.clientHeight < element.scrollHeight - 4);
      };
      element.addEventListener("scroll", updateFade, { passive: true });
      requestAnimationFrame(updateFade);
    }

    this.dom.collapseLibrary?.addEventListener("click", () => {
      this.prefs.libraryOpen = !this.prefs.libraryOpen;
      document.querySelector(".blocks-pane")?.classList.toggle("library-closed", !this.prefs.libraryOpen);
      this.saveProject();
    });
  }

  /* ============================ WORKSPACE ============================ */

  buildWorkspace() {
    this.workspace = new Workspace({
      element: this.dom.workspace,
      world: this.dom.workspaceWorld,
      stack: this.dom.blockStack,
      onBlockChange: (block, meta) => this.onBlockEdited(block, meta),
      onSelect: (block) => this.onBlockSelected(block),
      onDropBlock: (schema, event, options) => this.onCanvasDrop(schema, event, options),
      onContextMenu: (event, info) => this.onCanvasContextMenu(event, info),
      onRemove: (blockId) => this.removeBlockById(blockId),
    });

    document.querySelectorAll(".workspace-controls button").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.act;
        if (action === "zoomIn") this.workspace.zoomBy(0.15);
        if (action === "zoomOut") this.workspace.zoomBy(-0.15);
        if (action === "fit") this.workspace.fitToContent();
        if (action === "undo") this.undo();
        if (action === "redo") this.redo();
        if (action === "delete") this.removeBlockById(this.workspace.selectedId);
        sound.play("click");
      });
    });
  }

  renderBlocks() {
    this.workspace?.render(this.sync.blocks, { preserveSelection: true });
  }

  /** Editou um parâmetro do bloco -> patch cirúrgico no Python (Parte 13.4). */
  onBlockEdited(block, meta) {
    if (!block || this.applyingFromBlocks) return;
    this.applyingFromBlocks = true;
    try {
      const result = this.sync.applyBlockEdit(block);
      if (result.changed) {
        this.editor?.setValue(this.sync.code, { silent: true });
        this.history.push({ fileId: this.activeFileId, code: this.sync.code, caret: this.editor?.caret ?? 0, label: "parâmetro do bloco" });
        this.persistActiveFile();
        if (meta?.commit) this.terminal.info(`Python atualizado a partir do bloco (linha ${block.source?.startLine ?? "?"}).`);
      }
    } finally {
      this.applyingFromBlocks = false;
    }
  }

  /** Parte 14.6: clicar no bloco seleciona o trecho no editor. */
  onBlockSelected(block) {
    if (!block || this.applyingFromBlocks) return;
    const selection = this.sync.selectionForBlock(block, this.sync.code);
    if (!selection) return;
    this.applyingFromBlocks = true;
    try { this.editor?.selectRange(selection.start, selection.end); } finally { this.applyingFromBlocks = false; }
  }

  onCanvasDrop(schema, event, options = {}) {
    if (options.fromPalette && BLOCK_BY_ID.has(schema)) {
      const symbolName = event?.dataTransfer?.getData("text/garca-function");
      const moduleName = event?.dataTransfer?.getData("text/garca-module");
      if ((schema === "library_call" || schema === "myblock_call") && symbolName) {
        this.insertDynamic(schema, { name: symbolName, module: moduleName, args: this.lookupArgs(symbolName, moduleName) });
        return;
      }
      this.insertFromPalette(schema);
      return;
    }
    if (!options.fromPalette) {
      // reordenação dentro do canvas
      this.persistView();
    }
  }

  lookupArgs(functionName, moduleName) {
    const library = librarySymbols(this.vfs?.files ?? []).find((item) => item.name === functionName && (!moduleName || item.module === moduleName));
    if (library) return library.args ?? [];
    const local = (this.activeFile?.symbols?.functions ?? []).find((fn) => fn.name === functionName);
    return local?.args ?? [];
  }

  removeBlockById(blockId) {
    if (!blockId) return;
    const block = this.workspace.find(blockId);
    if (!block) return;
    const line = block.source?.startLine;
    this.applyingFromBlocks = true;
    try {
      this.sync.removeBlockFromCode(block);
      this.editor?.setValue(this.sync.code, { silent: true });
      this.history.push({ fileId: this.activeFileId, code: this.sync.code, caret: 0, label: "bloco excluído" });
      this.persistActiveFile();
    } finally {
      this.applyingFromBlocks = false;
    }
    this.workspace.select(null);
    sound.play("remove");
    this.terminal.warning(`Bloco removido${line ? ` (linha ${line})` : ""}. Ctrl+Z desfaz.`);
  }

  persistView() {
    const file = this.activeFile;
    if (file && this.workspace) file.view = { ...this.workspace.view };
  }

  persistActiveFile() {
    const file = this.activeFile;
    if (!file) return;
    file.blocks = this.sync.blocks;
    file.blocksFromCode = false;
    this.vfs.setContent(file.file_id, this.sync.code);
    file.blocks = this.sync.blocks;
    this.saveProject();
    this.renderExplorer();
  }

  /* ============================= EDITOR ============================= */

  buildEditor() {
    this.editor = new EditorView({
      textarea: this.dom.codeEditor,
      gutter: this.dom.lineNumbers,
      highlight: this.dom.highlight,
      popup: this.dom.autocomplete,
      ruler: this.dom.diagnosticRuler,
      statusBar: this.dom.editorStatus,
      onInput: (code, meta) => this.onEditorInput(code, meta),
      onCursorMove: (position) => this.onCursorMove(position),
      onPasteNormalized: (text) => this.normalizePasted(text),
    });
    this.editor.refresh();
  }

  /** B02/B13: dispara o pipeline em input/paste/cut/drop — nunca só no blur. */
  onEditorInput(code, meta = {}) {
    const file = this.activeFile;
    if (!file) return;
    if (this.applyingFromBlocks) return;

    this.vfs.setContent(file.file_id, code);
    this.history.push({ fileId: file.file_id, code, caret: this.editor.caret, label: "digitação" }, { coalesceKey: "typing" });
    this.sync.schedule(code, { immediate: Boolean(meta.immediate) });

    if (meta.reindent) this.terminal.info("Indentação ajustada.");
  }

  /**
   * Parte 16: correção automática ao colar.
   * Usa o endpoint do servidor (ast.parse real + catálogo Pybricks) e cai num
   * normalizador local se a função não estiver disponível.
   */
  async normalizePasted(text) {
    const local = normalizeLocal(text);
    try {
      const response = await fetch("/api/project/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: local.code.slice(0, 500_000) }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data?.ok && typeof data.code === "string") {
        this.reportCorrections(data.changes ?? [], data.valid, data.error);
        return data.code;
      }
      throw new Error(data?.error ?? "resposta inválida");
    } catch {
      this.reportCorrections(local.changes, true, null);
      return local.code;
    }
  }

  reportCorrections(changes, valid, error) {
    if (!changes?.length && valid) {
      this.terminal.info("Texto colado já estava válido — nada foi alterado.");
      return;
    }
    for (const change of changes ?? []) this.terminal.write(`• ${change}`, LEVEL.INFO);
    if (valid) {
      this.terminal.success("Código colado corrigido e válido. Ctrl+Z desfaz tudo de uma vez.");
    } else if (error) {
      this.terminal.write(`Ainda há um problema: linha ${error.line ?? "?"}, coluna ${error.offset ?? "?"} — ${error.message ?? ""}`, LEVEL.ERROR, { tab: "problems" });
      this.terminal.info("As linhas válidas já viraram blocos. Corrija a linha marcada para completar a conversão.");
    }
    sound.play(valid ? "snap" : "warning");
  }

  /** Parte 14.6: cursor no editor destaca o bloco correspondente. */
  onCursorMove(position) {
    if (!position) return;
    const block = this.sync.blockAtLine(position.line);
    this.workspace?.highlightLine(position.line);
    if (block && block.id !== this.workspace?.selectedId) {
      this.workspace?.select(block.id);
    }
    this.dom.editorStatus && (this.dom.editorStatus.textContent = `Ln ${position.line}, Col ${position.column}`);
  }

  /* ============================== SYNC ============================== */

  onSync(payload) {
    this.renderBlocks();
    this.editor?.setDiagnostics(payload.diagnostics ?? [], payload.pythonOnly ?? []);
    this.updateSyncIndicator(payload);
    this.renderTerminalProblems(payload.diagnostics ?? []);
    this.persistActiveFile();
    this.renderCategories();
  }

  updateSyncIndicator(payload) {
    const node = this.dom.syncState;
    if (!node) return;
    node.className = `sync ${payload.state}`;
    node.innerHTML = `<i>${icon(payload.state === SYNC_STATE.ERROR ? "alert" : payload.state === SYNC_STATE.PARTIAL ? "info" : "check", { size: 13 })}</i> ${escapeHtml(payload.label)}`;
    node.setAttribute("aria-live", "polite");
    node.title = payload.state === SYNC_STATE.PARTIAL
      ? "Parte do Python não tem representação visual. Esse código permanece intacto no editor e não é apagado."
      : payload.state === SYNC_STATE.ERROR
        ? "Há um erro de sintaxe. As linhas válidas continuam virando blocos; nada foi apagado."
        : "Blocos e Python representam o mesmo programa.";
  }

  renderTerminalProblems(diagnostics) {
    const file = this.activeFile;
    // Limpa os problemas anteriores deste arquivo e reescreve os atuais
    if (this.terminal) {
      this.terminal.lines = this.terminal.lines.filter((line) => !(line.tab === "problems" && line.auto));
      for (const diagnostic of diagnostics) {
        this.terminal.write(diagnostic.text || diagnostic.short, LEVEL.ERROR, {
          tab: "problems", file: file?.path?.replace(/^\//, ""), line: diagnostic.line, column: diagnostic.column,
        });
        const last = this.terminal.lines[this.terminal.lines.length - 1];
        if (last) last.auto = true;
      }
      this.terminal.updateCounter();
      this.terminal.render();
    }
  }

  /* ============================ TERMINAL ============================ */

  buildTerminal() {
    this.terminal = new Terminal({
      container: this.dom.terminalLines,
      tabs: this.dom.terminalTabs,
      counter: this.dom.problemCount,
      onJumpToLine: (line, column) => this.editor?.setCursor(line, column ?? 1),
    });
    this.dom.clearTerminal?.addEventListener("click", () => { this.terminal.clear(); sound.play("click"); });
  }

  /* ============================= GITHUB ============================= */

  buildGithubPanel() {
    this.github = new GitHubPanel({
      panel: this.dom.githubPanel,
      toggle: this.dom.githubToggle,
      close: this.dom.closeGithub,
      contributor: this.dom.contributor,
      repoPath: this.dom.repoPath,
      message: this.dom.commitMessage,
      commitButton: this.dom.commitBtn,
      profileStack: this.dom.profileStack,
      profilePanel: this.dom.profilePanel,
      profileName: this.dom.profileName,
      profileSummary: this.dom.profileSummary,
      ranking: this.dom.versionRanking,
      closeProfile: this.dom.closeProfile,
      getFiles: () => this.vfs.files,
      getActiveOutput: () => this.activeOutputNumber,
      onToast: (text, level) => this.toast(text, level),
      onLog: (text, level) => this.terminal?.[level]?.(text) ?? this.terminal?.info(text),
    });
    this.github.setOpen(Boolean(this.prefs.githubOpen));
  }

  /* =============================== HUB =============================== */

  /**
   * Parte 18.1: máquina de estados. Nunca simula conexão bem-sucedida (N21).
   * Executar só habilita em PRONTO.
   */
  updateHubCard() {
    const labels = {
      DISCONNECTED: "HUB desconectado",
      SEARCHING: "Procurando HUB…",
      FOUND: "HUB encontrado",
      CONNECTING: "Conectando…",
      CONNECTED: "HUB conectado",
      READY: "HUB pronto",
      RUNNING: "Programa em execução",
      UPLOADING: "Enviando programa…",
      FAILED: "Falha na conexão",
    };
    const state = this.dom.hubState;
    if (state) state.textContent = labels[this.hub.state] ?? this.hub.state;
    const model = this.dom.hubModel;
    if (model) {
      model.textContent = this.hub.state === "DISCONNECTED" || this.hub.state === "FAILED"
        ? "SPIKE Prime · Pybricks"
        : [this.hub.model, this.hub.firmware].filter(Boolean).join(" · ") || "SPIKE Prime · Pybricks";
    }
    // N13: a bateria aparece SOMENTE no cartão do HUB
    const battery = this.dom.hubBattery;
    if (battery) {
      battery.hidden = this.hub.battery === null || this.hub.battery === undefined;
      battery.style.setProperty("--level", `${Math.max(0, Math.min(100, Number(this.hub.battery ?? 0)))}%`);
      battery.title = this.hub.battery === null ? "" : `Bateria: ${Math.round(this.hub.battery)}%`;
    }
    this.dom.hubCard?.classList.toggle("connected", ["CONNECTED", "READY", "RUNNING", "UPLOADING"].includes(this.hub.state));
    this.dom.connectBtn?.classList.toggle("connected", this.hub.state !== "DISCONNECTED");
    if (this.dom.footerHub) this.dom.footerHub.textContent = labels[this.hub.state] ?? this.hub.state;

    const ready = this.hub.state === "READY";
    if (this.dom.runBtn) {
      this.dom.runBtn.disabled = !ready;
      this.dom.runBtn.title = ready ? "Executar no HUB (F5)" : "Conecte o HUB antes de executar";
    }
    if (this.dom.stopBtn) this.dom.stopBtn.disabled = !["RUNNING", "UPLOADING"].includes(this.hub.state);
  }

  bindToolbar() {
    this.dom.connectBtn?.addEventListener("click", () => this.connectHub());
    this.dom.runBtn?.addEventListener("click", () => this.runOnHub());
    this.dom.stopBtn?.addEventListener("click", () => this.stopOnHub());
    this.dom.downloadBtn?.addEventListener("click", () => this.downloadToHub());
    this.dom.newBtn?.addEventListener("click", () => this.addOutput());
    this.dom.settingsBtn?.addEventListener("click", () => this.togglePreferences(true));
    this.dom.githubToggle?.addEventListener("click", () => { this.prefs.githubOpen = this.github.isOpen; this.saveProject(); });
  }

  async connectHub() {
    if (!navigator.bluetooth) {
      this.terminal.error("Este navegador não tem Web Bluetooth. Use Chrome ou Edge em HTTPS ou localhost.");
      this.toast("Web Bluetooth indisponível neste navegador.", "error");
      return;
    }
    this.setHubState("SEARCHING");
    this.terminal.info("Procurando HUB SPIKE Prime…");
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [PYBRICKS_SERVICE] }],
        optionalServices: [PYBRICKS_SERVICE],
      });
      this.hub.device = device;
      this.hub.model = device.name || "SPIKE Prime";
      this.setHubState("FOUND");
      this.terminal.success(`Encontrado: ${this.hub.model}`);

      this.setHubState("CONNECTING");
      device.addEventListener("gattserverdisconnected", () => {
        this.setHubState("DISCONNECTED");
        this.terminal.warning("HUB desconectado.");
        sound.play("hubDisconnected");
      });

      const server = await device.gatt.connect();
      this.hub.server = server;
      const service = await server.getPrimaryService(PYBRICKS_SERVICE);
      this.hub.characteristic = await service.getCharacteristic(PYBRICKS_COMMAND);
      await this.hub.characteristic.startNotifications();
      this.hub.characteristic.addEventListener("characteristicvaluechanged", (event) => this.onHubEvent(event));

      this.setHubState("READY");
      this.terminal.success(`Conectado ao ${this.hub.model}${this.hub.firmware ? ` (firmware ${this.hub.firmware})` : ""}`);
      sound.play("hubConnected");
    } catch (error) {
      // N21: NUNCA simular conexão bem-sucedida
      this.setHubState(error?.message?.includes("User cancelled") ? "DISCONNECTED" : "FAILED");
      this.terminal.error(`Falha na conexão: ${error?.message ?? error}`);
      sound.play("error");
    }
  }

  setHubState(state) {
    this.hub.state = state;
    this.updateHubCard();
  }

  onHubEvent(event) {
    const value = event.target.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer);
    const type = bytes[0];
    if (type === HUB_EVENT_OUTPUT) {
      const text = new TextDecoder().decode(bytes.slice(1)).replace(/\0+$/, "");
      if (text.trim()) this.terminal.write(text.trimEnd(), LEVEL.INFO, { tab: "output" });
      return;
    }
    if (type === HUB_EVENT_INFO) {
      const payload = new TextDecoder().decode(bytes.slice(1)).replace(/\0+$/, "");
      try {
        const info = JSON.parse(payload);
        if (info.firmware_version) this.hub.firmware = `V${info.firmware_version}`;
        this.updateHubCard();
      } catch { /* ignora */ }
    }
  }

  /** 18.6: validação ANTES de enviar. Se faltar módulo, aborta (T57). */
  async runOnHub() {
    if (this.hub.state !== "READY") {
      this.terminal.error("Conecte o HUB antes de executar o programa.");
      this.toast("Conecte o HUB antes de executar.", "warning");
      return;
    }
    const checks = preflight(this.vfs, this.activeFileId);
    this.terminal.validationSummary(checks);
    if (!checks.ok) {
      this.terminal.error("Execução cancelada: corrija os itens acima antes de enviar para o HUB.");
      sound.play("error");
      return;
    }

    const bundled = bundleProject(this.vfs, this.activeFileId);
    if (!bundled.ok) {
      this.terminal.error(bundled.error);
      sound.play("error");
      return;
    }
    for (const warning of bundled.warnings) this.terminal.warning(warning);

    this.terminal.success("✓ Python válido\n✓ Imports resolvidos\n✓ API Pybricks compatível\n✓ Portas configuradas");
    this.terminal.info("Programa pronto para enviar para o HUB.");

    const compiled = await this.compile(bundled.code);
    if (!compiled) return;

    this.setHubState("UPLOADING");
    this.terminal.info(`Enviando programa… ${(compiled.byteLength / 1024).toFixed(1)} KB`);
    const ok = await this.upload(compiled);
    if (!ok) return;

    this.setHubState("RUNNING");
    this.terminal.info("Execução iniciada");
    sound.play("runStart");
  }

  /** 18.4: compilação local com mpy-cross ABI v6 (vendor/mpy-cross-v6.wasm). */
  async compile(source) {
    if (typeof window.pybricksCompile !== "function") {
      this.terminal.error("Compilador mpy-cross não carregou. Verifique vendor/compiler.js e vendor/mpy-cross-v6.wasm.");
      sound.play("error");
      return null;
    }
    try {
      const result = await window.pybricksCompile("main.py", source);
      if (result.status !== 0 || !result.mpy?.length) {
        const message = (result.err ?? []).join("\n") || "Falha na compilação";
        this.terminal.error(`mpy-cross: ${message}`);
        sound.play("error");
        return null;
      }
      this.terminal.success("Compilado para MicroPython ABI v6.");
      return result.mpy;
    } catch (error) {
      this.terminal.error(`Não foi possível compilar: ${error?.message ?? error}`);
      sound.play("error");
      return null;
    }
  }

  async upload(bytecode) {
    const characteristic = this.hub.characteristic;
    if (!characteristic) { this.terminal.error("Característica de comando indisponível."); return false; }
    const bytes = new Uint8Array(bytecode);
    const write = async (payload) => characteristic.writeValueWithoutResponse
      ? characteristic.writeValueWithoutResponse(payload)
      : characteristic.writeValue(payload);

    try {
      await write(new Uint8Array([HUB_CMD_STOP]));            // interrompe o anterior
      await new Promise((resolve) => setTimeout(resolve, 120));
      await write(new Uint8Array([HUB_CMD_INVALIDATE_SLOT])); // invalida o slot
      await new Promise((resolve) => setTimeout(resolve, 80));

      const header = new Uint8Array(8);
      header[0] = HUB_CMD_UPLOAD;
      new DataView(header.buffer).setUint32(1, bytes.length, true);
      await write(header);

      const CHUNK = 90;
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        const slice = bytes.slice(offset, offset + CHUNK);
        const packet = new Uint8Array(slice.length + 1);
        packet[0] = HUB_CMD_PACKET;
        packet.set(slice, 1);
        await write(packet);
      }
      await write(new Uint8Array([HUB_CMD_CONFIRM]));
      await new Promise((resolve) => setTimeout(resolve, 80));
      await write(new Uint8Array([HUB_CMD_START_SLOT0]));
      return true;
    } catch (error) {
      this.setHubState("FAILED");
      this.terminal.error(`Falha ao enviar o programa: ${error?.message ?? error}`);
      sound.play("error");
      return false;
    }
  }

  async stopOnHub() {
    if (!this.hub.characteristic) return;
    try {
      await this.hub.characteristic.writeValue(new Uint8Array([HUB_CMD_STOP]));
      this.setHubState("READY");
      this.terminal.warning("Execução interrompida.");
      sound.play("runStop");
    } catch (error) {
      this.terminal.error(`Não foi possível parar: ${error?.message ?? error}`);
    }
  }

  /** Baixar para o HUB: compila e grava sem iniciar (Parte 18.7). */
  async downloadToHub() {
    const bundled = bundleProject(this.vfs, this.activeFileId);
    if (!bundled.ok) { this.terminal.error(bundled.error); return; }
    const compiled = await this.compile(bundled.code);
    if (!compiled) return;
    if (this.hub.state !== "READY") {
      const blob = new Blob([compiled], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${this.activeFile?.name.replace(/\.py$/, "") ?? "programa"}.mpy`;
      link.click();
      URL.revokeObjectURL(url);
      this.terminal.info("HUB não conectado: o .mpy foi baixado para o seu computador.");
      return;
    }
    const ok = await this.upload(compiled);
    if (ok) { this.setHubState("READY"); this.terminal.success("Programa gravado no HUB (não iniciado)."); }
  }

  /* ============================== SAÍDAS ============================== */

  /**
   * Parte 19.1: cada saída é um arquivo real no VFS = missions/saida_N.py.
   * Projeto novo começa com apenas Saída 1 — nada de 7 abas de exemplo (B16).
   */
  renderOutputTabs() {
    const nav = this.dom.outputTabs;
    if (!nav) return;
    const addButton = this.dom.addOutput;
    const fragment = document.createDocumentFragment();

    this.outputs.forEach((fileId) => {
      const file = this.vfs.byId(fileId);
      if (!file) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `output${fileId === this.activeFileId ? " active" : ""}`;
      button.dataset.output = String(outputNumber(file.path));
      button.dataset.fileId = fileId;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(fileId === this.activeFileId));
      button.innerHTML = `<span>Saída ${outputNumber(file.path)}</span>${file.modified ? '<i class="tab-dirty" aria-hidden="true"></i>' : ""}`;
      button.title = `${file.path.replace(/^\//, "")}\nNo repositório: ${repositoryPath(file)}`;
      button.addEventListener("click", () => {
        this.openFile(fileId);
        // 19.1: o caminho no repositório muda automaticamente com a aba ativa
        if (this.dom.repoPath) this.dom.repoPath.value = repositoryPath(file, outputNumber(file.path));
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.openContextMenu(this.dom.blockContextMenu, event, outputMenuItems(this, file, button));
      });
      fragment.appendChild(button);
    });

    nav.replaceChildren(fragment);
    if (addButton) nav.appendChild(addButton);
  }

  addOutput() {
    const next = (this.outputs.length ? Math.max(...this.outputs.map((id) => outputNumber(this.vfs.byId(id)?.path ?? ""))) : 0) + 1;
    const path = uniquePath(this.vfs, `/missions/saida_${next}.py`);
    const file = this.vfs.createFile(path, "");
    this.outputs.push(file.file_id);
    this.renderOutputTabs();
    this.renderExplorer();
    this.openFile(file.file_id);
    this.terminal.success(`Saída ${next} criada em ${path.replace(/^\//, "")}.`);
    sound.play("snap");
  }

  closeOutput(fileId) {
    const index = this.outputs.indexOf(fileId);
    if (index === -1 || this.outputs.length <= 1) {
      this.toast("É preciso manter ao menos uma saída.", "warning");
      return;
    }
    this.outputs.splice(index, 1);
    this.vfs.remove(fileId);
    if (this.activeFileId === fileId) this.openFile(this.outputs[Math.max(0, index - 1)]);
    this.renderOutputTabs();
    this.renderExplorer();
    this.refreshLibrarySymbols();
  }

  /* ============================= ATALHOS ============================= */

  bindShortcuts() {
    document.addEventListener("keydown", (event) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const inEditor = document.activeElement === this.dom.codeEditor;

      if (mod && key === "z" && !event.shiftKey) { event.preventDefault(); this.undo(); return; }
      if (mod && (key === "y" || (key === "z" && event.shiftKey))) { event.preventDefault(); this.redo(); return; }
      if (mod && key === "s") { event.preventDefault(); this.saveProject(); this.flashSaved(); this.toast("Rascunho salvo.", "success"); return; }
      if (mod && key === "d") { event.preventDefault(); this.duplicateSelected(); return; }
      if (mod && key === "f") { /* busca nativa do navegador — não bloqueia */ return; }
      if (mod && (key === "=" || key === "+")) { event.preventDefault(); this.workspace?.zoomBy(0.15); return; }
      if (mod && key === "-") { event.preventDefault(); this.workspace?.zoomBy(-0.15); return; }
      if (mod && key === "0") { event.preventDefault(); this.workspace?.fitToContent(); return; }

      if (event.key === "F2") { event.preventDefault(); if (this.activeFileId) this.renameFile(this.activeFileId); return; }
      if (event.key === "F5" && !mod) { event.preventDefault(); this.runOnHub(); return; }
      if (event.key === "F5" && event.shiftKey) { event.preventDefault(); this.stopOnHub(); return; }
      if (event.key === "Escape") { this.closeAllMenus(); this.togglePreferences(false); return; }

      if (!inEditor && (event.key === "Backspace" || event.key === "Delete")) {
        if (this.workspace?.selectedId) { event.preventDefault(); this.removeBlockById(this.workspace.selectedId); }
      }
    });

    this.dom.addOutput?.addEventListener("click", () => this.addOutput());
  }

  /** Revela o arquivo na árvore do explorador (menu da aba de saída). */
  revealInExplorer(fileId) {
    const file = this.vfs.byId(fileId);
    if (!file) return;
    this.prefs.explorerOpen = true;
    this.dom.mainGrid?.classList.add("explorer-open");
    for (const folder of this.vfs.folders) folder.expanded = true;
    this.renderExplorer();
    requestAnimationFrame(() => {
      const row = this.dom.fileTree?.querySelector(`[data-file-id="${CSS.escape(fileId)}"]`);
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row?.classList.add("revealed");
      setTimeout(() => row?.classList.remove("revealed"), 1200);
    });
    this.terminal.info(`Revelado no explorador: ${file.path.replace(/^\//, "")}`);
  }

  undo() {
    const entry = this.history.undo();
    if (!entry) { this.toast("Nada para desfazer.", "info"); return; }
    if (entry.fileId !== this.activeFileId) this.openFile(entry.fileId);
    this.applyingFromBlocks = true;
    try {
      this.editor?.setValue(entry.code, { caret: entry.caret ?? null, silent: true });
      this.vfs.setContent(entry.fileId, entry.code);
      this.sync.runPipeline(entry.code);
    } finally { this.applyingFromBlocks = false; }
    this.persistActiveFile();
    this.terminal.info(`Desfeito: ${entry.label || "ação"}`);
  }

  redo() {
    const entry = this.history.redo();
    if (!entry) { this.toast("Nada para refazer.", "info"); return; }
    if (entry.fileId !== this.activeFileId) this.openFile(entry.fileId);
    this.applyingFromBlocks = true;
    try {
      this.editor?.setValue(entry.code, { caret: entry.caret ?? null, silent: true });
      this.vfs.setContent(entry.fileId, entry.code);
      this.sync.runPipeline(entry.code);
    } finally { this.applyingFromBlocks = false; }
    this.persistActiveFile();
    this.terminal.info(`Refeito: ${entry.label || "ação"}`);
  }

  duplicateSelected() {
    const block = this.workspace?.find(this.workspace.selectedId);
    if (!block) { this.toast("Selecione um bloco para duplicar.", "info"); return; }
    const clone = structuredClone(block);
    reassignIds(clone);
    this.sync.insertBlockIntoCode(clone, block.source?.endLine ?? null);
    this.editor?.setValue(this.sync.code, { silent: true });
    this.persistActiveFile();
    sound.play("snap");
    this.terminal.info("Bloco duplicado.");
  }

  /* ======================= MENUS DE CONTEXTO ======================= */

  onCanvasContextMenu(event, info) {
    if (info.kind === "block") {
      const block = this.workspace.find(info.blockId);
      this.openContextMenu(this.dom.blockContextMenu, event, blockMenuItems(this, block));
      return;
    }
    this.openContextMenu(this.dom.blockContextMenu, event, canvasMenuItems(this));
  }

  openContextMenu(menu, event, items) {
    if (!menu) return;
    this.closeAllMenus();
    menu.replaceChildren(...items.map((item) => {
      if (item.separator) {
        const hr = document.createElement("hr");
        return hr;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = item.danger ? "danger" : "";
      button.innerHTML = `${item.icon ? icon(item.icon, { size: 14 }) : '<span class="menu-gap"></span>'}<span>${escapeHtml(item.label)}</span>${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ""}`;
      if (item.disabled) button.setAttribute("disabled", "");
      button.addEventListener("click", () => { this.closeAllMenus(); item.action?.(); });
      return button;
    }));
    menu.hidden = false;
    menu.classList.add("show");
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
  }

  bindContextMenus() {
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".context-menu")) this.closeAllMenus();
    });
    document.addEventListener("scroll", () => this.closeAllMenus(), true);

    this.dom.fileTree?.addEventListener("dragover", (event) => event.preventDefault());
  }

  closeAllMenus() {
    for (const menu of [this.dom.fileContextMenu, this.dom.blockContextMenu]) {
      if (!menu) continue;
      menu.hidden = true;
      menu.classList.remove("show");
    }
  }

  /* ============================ DIÁLOGO ============================ */

  openDialog({ title, text, fieldLabel, value = "", selectLabel = null, options = [], confirmLabel = "Confirmar", danger = false, onConfirm, onCancel }) {
    const dialog = this.dom.projectDialog;
    if (!dialog) { onConfirm?.({ value, select: options[0]?.value ?? "" }); return; }

    this.dom.dialogTitle.textContent = title;
    this.dom.dialogText.textContent = text ?? "";
    this.dom.dialogText.style.whiteSpace = "pre-line";

    const fieldWrap = this.dom.dialogFieldLabel;
    if (fieldLabel) {
      fieldWrap.hidden = false;
      fieldWrap.firstChild.textContent = fieldLabel;
      this.dom.dialogInput.value = value;
    } else {
      fieldWrap.hidden = true;
    }

    const selectWrap = this.dom.dialogSelectLabel;
    if (selectLabel && options.length) {
      selectWrap.hidden = false;
      selectWrap.firstChild.textContent = selectLabel;
      this.dom.dialogSelect.replaceChildren(...options.map((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        return node;
      }));
    } else {
      selectWrap.hidden = true;
    }

    const confirm = this.dom.dialog.querySelector("#dialogConfirm");
    if (confirm) {
      confirm.textContent = confirmLabel;
      confirm.classList.toggle("danger", danger);
    }

    const handler = (event) => {
      dialog.removeEventListener("close", handler);
      if (dialog.returnValue === "confirm") {
        onConfirm?.({ value: this.dom.dialogInput.value, select: this.dom.dialogSelect.value });
      } else {
        onCancel?.();
      }
    };
    dialog.addEventListener("close", handler);
    if (!dialog.open) dialog.showModal();
    if (fieldLabel) requestAnimationFrame(() => { this.dom.dialogInput.focus(); this.dom.dialogInput.select(); });
  }

  /* ============================ PREFERÊNCIAS ============================ */

  bindPreferences() {
    this.dom.soundEnabled?.addEventListener("change", (event) => {
      this.prefs.sound = event.target.checked;
      sound.setEnabled(this.prefs.sound);
      this.saveProject();
      // T62: com o som desligado, nenhum som é emitido
      if (this.prefs.sound) sound.play("click");
    });
    this.dom.soundVolume?.addEventListener("input", (event) => {
      this.prefs.volume = Number(event.target.value);
      sound.setVolume(this.prefs.volume);
    });
    this.dom.soundVolume?.addEventListener("change", () => { this.saveProject(); sound.play("click"); });
    this.dom.closePreferences?.addEventListener("click", () => this.togglePreferences(false));
  }

  togglePreferences(open) {
    const popover = this.dom.preferencesPopover;
    if (!popover) return;
    popover.hidden = !open;
    popover.classList.toggle("show", open);
  }

  /* ======================= SOMENTE DESKTOP ======================= */

  /**
   * PEDIDO DO USUÁRIO: "esse aplicativo é feito somente para desktop… a opção
   * de versionamento para outros dispositivos está fora de cogitação".
   *
   * Não há layout de telefone. Em janela estreita demais aparece um aviso
   * explicando que a IDE é de desktop — sem esconder funcionalidade.
   */
  bindDesktopOnlyNotice() {
    let notice = document.getElementById("desktopNotice");
    const evaluate = () => {
      const narrow = window.innerWidth < 900;
      if (!narrow) { notice?.remove(); notice = null; return; }
      if (!notice) {
        notice = document.createElement("div");
        notice.id = "desktopNotice";
        notice.className = "desktop-notice";
        notice.setAttribute("role", "status");
        notice.innerHTML = `${icon("desktop", { size: 22 })}
          <div><strong>Aplicativo de desktop</strong>
          <p>O Garça de Botas Code Studio é usado no computador, no dia de treino, para conectar ao HUB. Redimensione a janela ou abra em um monitor maior.</p></div>`;
        document.body.appendChild(notice);
      }
    };
    window.addEventListener("resize", evaluate);
    evaluate();
  }

  /* ============================== TOAST ============================== */

  toast(text, level = "info") {
    const node = this.dom.toast;
    if (!node) return;
    node.textContent = text;
    node.className = `toast show ${level}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { node.classList.remove("show"); }, 2500);
  }
}

/* ------------------------------------------------------------------ */
/* Menus de contexto (Parte 22.2)                                      */
/* ------------------------------------------------------------------ */

function blockMenuItems(app, block) {
  if (!block) return [];
  return [
    { label: "Editar parâmetros", icon: "settings", action: () => app.workspace?.select(block.id) },
    { label: "Duplicar", icon: "copy", shortcut: "Ctrl+D", action: () => app.duplicateSelected() },
    { separator: true },
    { label: "Copiar", icon: "copy", action: () => copyText(blockToPythonText(block)) },
    { label: "Mostrar Python", icon: "code", action: () => app.terminal.info(blockToPythonText(block)) },
    {
      label: block.disabled ? "Ativar bloco" : "Desativar bloco",
      icon: block.disabled ? "eye" : "eyeOff",
      action: () => {
        block.disabled = !block.disabled;
        app.renderBlocks();
        app.terminal.info(block.disabled ? "Bloco desativado — não gera código." : "Bloco ativado.");
      },
    },
    { separator: true },
    { label: "Excluir", icon: "trash", shortcut: "Delete", danger: true, action: () => app.removeBlockById(block.id) },
  ];
}

function canvasMenuItems(app) {
  return [
    { label: "Colar", icon: "copy", action: async () => { const text = await readClipboard(); if (text) app.onEditorInput(text, { immediate: true }); } },
    { label: "Ajustar ao conteúdo", icon: "fit", shortcut: "Ctrl+0", action: () => app.workspace?.fitToContent() },
    { label: "Centralizar", icon: "target", action: () => app.workspace?.center() },
    { label: "Limpar seleção", icon: "close", shortcut: "Esc", action: () => app.workspace?.clearSelection() },
    { separator: true },
    { label: "Organizar imports", icon: "module", action: () => organizeImports(app) },
    { label: "Gerar Python dos blocos", icon: "code", action: () => regenerateFromBlocks(app) },
  ];
}

function fileMenuItems(app, file) {
  return [
    { label: "Abrir", icon: "fileCode", action: () => app.openFile(file.file_id) },
    { label: "Renomear", icon: "settings", shortcut: "F2", action: () => app.renameFile(file.file_id) },
    { label: "Duplicar", icon: "copy", action: () => { const copy = app.vfs.duplicate(file.file_id); app.refreshLibrarySymbols(); app.renderExplorer(); app.openFile(copy.file_id); } },
    { separator: true },
    { label: "Exportar .py", icon: "download", action: () => downloadText(file.name, file.content) },
    {
      label: "Definir como entrada", icon: "entry",
      action: () => { app.vfs.setEntrypoint(file.file_id); app.renderExplorer(); app.terminal.success(`${file.name} é o arquivo de entrada.`); },
    },
    { label: "Mostrar dependências", icon: "dependency", action: () => { app.openFile(file.file_id); app.showDependencies(); } },
    { separator: true },
    { label: "Excluir", icon: "trash", danger: true, action: () => app.removeFile(file.file_id) },
  ];
}

function folderMenuItems(app, node) {
  return [
    { label: "Novo arquivo", icon: "fileCode", action: () => app.promptNewFile() },
    { label: "Nova pasta", icon: "folder", action: () => app.promptNewFolder() },
    { separator: true },
    {
      label: "Exportar pasta", icon: "download",
      action: () => app.vfs.files.filter((file) => file.path.startsWith(`${node.path}/`)).forEach((file) => downloadText(file.name, file.content)),
    },
  ];
}

function outputMenuItems(app, file, button) {
  const index = app.outputs.indexOf(file.file_id);
  return [
    { label: "Fechar saída", icon: "close", action: () => app.closeOutput(file.file_id) },
    { label: "Fechar outras", icon: "close", action: () => app.outputs.filter((id) => id !== file.file_id).forEach((id) => app.closeOutput(id)) },
    { label: "Fechar à direita", icon: "close", action: () => app.outputs.slice(index + 1).forEach((id) => app.closeOutput(id)) },
    { separator: true },
    { label: "Salvar", icon: "save", shortcut: "Ctrl+S", action: () => { app.saveProject(); app.flashSaved(); } },
    { label: "Revelar no explorador", icon: "files", action: () => app.revealInExplorer(file.file_id) },
    { label: "Renomear", icon: "settings", action: () => app.renameFile(file.file_id) },
  ];
}

/* ------------------------------------------------------------------ */
/* Ações auxiliares                                                    */
/* ------------------------------------------------------------------ */

/** B08: remoção de imports não usados só por comando EXPLÍCITO. */
function organizeImports(app) {
  const file = app.activeFile;
  if (!file) return;
  const result = ensureImports(file.content, app.sync.blocks);
  if (!result.added.length) {
    app.terminal.info("Nenhum import faltando para os blocos atuais.");
    return;
  }
  app.editor?.setValue(result.code, { silent: true });
  app.vfs.setContent(file.file_id, result.code);
  app.sync.runPipeline(result.code);
  app.persistActiveFile();
  app.terminal.success(`Imports adicionados: ${result.added.join(", ")}`);
}

function regenerateFromBlocks(app) {
  const file = app.activeFile;
  if (!file) return;
  const code = generateProgram(app.sync.blocks, { existingCode: file.content, preserved: app.sync.pythonOnly });
  app.editor?.setValue(code, { silent: true });
  app.vfs.setContent(file.file_id, code);
  app.sync.runPipeline(code);
  app.persistActiveFile();
  app.terminal.info("Python regenerado a partir dos blocos. Trechos somente-Python foram preservados.");
}

function blockToPythonText(block) {
  const spec = BLOCK_BY_ID.get(block?.blockId);
  if (!spec) return "";
  return spec.py(block.params ?? {});
}

function reassignIds(block) {
  block.id = `block_${Math.random().toString(36).slice(2, 10)}`;
  block.selected = false;
  for (const child of block.children ?? []) reassignIds(child);
  for (const child of block.elseChildren ?? []) reassignIds(child);
}

function makeBlockInstance(spec, params) {
  return {
    id: `block_${Math.random().toString(36).slice(2, 10)}`,
    blockId: spec.id,
    schema: spec.id,
    category: spec.category,
    shape: spec.shape,
    params: { ...params },
    children: [],
    elseChildren: [],
    source: null,
    line: 0,
    disabled: false,
    expanded: false,
  };
}

const outputNumber = (path) => Number(/saida_(\d+)/.exec(path ?? "")?.[1] ?? 0);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch { /* sem permissão */ }
}

async function readClipboard() {
  try { return await navigator.clipboard.readText(); } catch { return ""; }
}

function downloadText(name, content) {
  const blob = new Blob([content], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Normalizador local (fallback do /api/project/format)                */
/* Parte 16.1, etapas 1 a 8. A etapa 10 (corrigir nomes da API por      */
/* similaridade) roda no servidor, com o catálogo completo.            */
/* ------------------------------------------------------------------ */

function normalizeLocal(raw) {
  const changes = [];
  let code = String(raw ?? "");

  const before = code;
  code = code.replace(/\r\n?/g, "\n");
  if (code !== before) changes.push("Quebras de linha normalizadas.");

  const quotes = code;
  code = code.replace(/[\u201C\u201D\u201E]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (code !== quotes) changes.push('Aspas tipográficas convertidas para " e \'.');

  const spaces = code;
  code = code.replace(/[\u00A0\u200B]/g, " ");
  if (code !== spaces) changes.push("Espaços rígidos e invisíveis removidos.");

  if (/\t/.test(code)) { code = code.replace(/\t/g, "    "); changes.push("Tabulações convertidas em 4 espaços."); }

  const trailing = code;
  code = code.replace(/[ \t]+$/gm, "");
  if (code !== trailing) changes.push("Espaços no fim das linhas removidos.");

  const literals = code;
  code = code.replace(/(?<![\w.])(true|false|null)(?![\w])/g, (match) => ({ true: "True", false: "False", null: "None" })[match]);
  if (code !== literals) changes.push("Literais true/false/null convertidos para Python.");

  // 7. adicionar ":" ausente em cabeças de bloco
  const lines = code.split("\n");
  let colons = 0;
  const heads = /^(if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const body = line.trim();
    if (!body || body.startsWith("#")) continue;
    if (!heads.test(body)) continue;
    if (body.endsWith(":") || body.endsWith("\\")) continue;
    if (/[([{]$/.test(body)) continue;
    lines[index] = `${line}:`;
    colons += 1;
  }
  if (colons) changes.push(`${colons} dois-pontos ausente${colons === 1 ? "" : "s"} adicionado${colons === 1 ? "" : "s"}.`);
  code = lines.join("\n");

  // 8. indentação inequívoca (múltiplos de 4)
  const reindented = repairIndentation(code);
  if (reindented !== code) { code = reindented; changes.push("Indentação corrigida."); }

  return { code, changes };
}

function repairIndentation(code) {
  const lines = String(code).split("\n");
  const out = [];
  const stack = [0];
  const branch = /^(elif|else|except|finally|case)\b/;
  const head = /^(if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b.*:\s*$/;

  for (const raw of lines) {
    if (!raw.trim()) { out.push(""); continue; }
    const body = raw.trim();
    let current = stack[stack.length - 1];

    if (branch.test(body)) current = Math.max(0, stack[stack.length - 2] ?? 0);

    out.push(`${" ".repeat(current)}${body}`);

    if (head.test(body)) {
      stack.push(current + 4);
    } else if (current > 0 && !branch.test(body)) {
      // mantém o nível; a próxima cabeça composta ajusta
    }
    if (/^(return|break|pass|continue|raise)\b/.test(body) && stack.length > 1) {
      // não desempilha: o bloco pode continuar
    }
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Protocolo Pybricks GATT (Parte 18.3)                                */
/* ------------------------------------------------------------------ */

const PYBRICKS_SERVICE = "c5f50001-8280-46da-89f4-6d8051e4aeef";
const PYBRICKS_COMMAND = "c5f50002-8280-46da-89f4-6d8051e4aeef";

const HUB_CMD_STOP = 0x00;
const HUB_CMD_START_SLOT0 = 0x01;
const HUB_CMD_INVALIDATE_SLOT = 0x02;
const HUB_CMD_UPLOAD = 0x03;
const HUB_CMD_PACKET = 0x05;
const HUB_CMD_CONFIRM = 0x06;
const HUB_EVENT_OUTPUT = 0x07;
const HUB_EVENT_INFO = 0x08;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function emptyCategoryText(categoryId) {
  if (categoryId === "libraries") {
    return "Nenhuma biblioteca no projeto ainda.<br>Use <b>Biblioteca de movimentos</b> no explorador para criar <code>libraries/movements.py</code>. As funções que você definir aparecem aqui como blocos.";
  }
  if (categoryId === "myblocks") {
    return "Nenhum bloco personalizado ainda.<br>Crie uma função com <code>def</code> no editor, ou use o bloco <b>defina (nome do seu bloco)</b>.";
  }
  return "Nenhum bloco nesta categoria.";
}

export { normalizeLocal, Studio };
export default start;

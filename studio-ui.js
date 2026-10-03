import { StudioStore } from "./src/core/store.js";
import { VirtualFileSystem } from "./src/project/vfs.js";
import { PybricksHub } from "./src/hub/pybricks-hub.js";

const $ = selector => document.querySelector(selector);
const store = new StudioStore();
const vfs = new VirtualFileSystem(store);
const hub = new PybricksHub();
const categoryMeta = {
  events: ["Eventos", "play", "#ffbe0b"], control: ["Controle", "route", "#ff9914"],
  motors: ["Motores", "motor", "#078bff"], movement: ["Movimento", "move", "#f72ea8"],
  light: ["Luz", "sun", "#984bf4"], sound: ["Som", "volume", "#b752f4"],
  sensors: ["Sensores", "radar", "#15c3df"], operators: ["Operadores", "braces", "#0acb72"],
  variables: ["Variáveis", "variable", "#f730ab"], libraries: ["Bibliotecas", "library", "#ff506b"],
  logic: ["Lógica", "braces", "#12b85a"], lists: ["Listas", "library", "#e24aa5"],
  functions: ["Funções", "braces", "#ff506b"], communication: ["Comunicação", "radar", "#00a89d"],
  text: ["Texto", "text", "#43c6ac"], hub: ["HUB", "cpu", "#55baff"],
};
const starterBlocks = {
  events: [{ schema: "event_start", category: "events", label: "quando o programa iniciar" }],
  control: [{ schema: "wait", category: "control", label: "espere 1 segundo" }, { schema: "repeat", category: "control", label: "repita 10 vezes" }, { schema: "forever", category: "control", label: "sempre" }, { schema: "if", category: "control", label: "se verdadeiro então" }],
  motors: [{ schema: "motor_run_angle", category: "motors", label: "A executar ↻ por 1 rotação a 500 graus/s" }, { schema: "motor_run", category: "motors", label: "A iniciar motor ↻" }, { schema: "motor_stop", category: "motors", label: "A parar motor" }],
  movement: [{ schema: "movement_straight", category: "movement", label: "mover ↑ por 10 rotações" }, { schema: "movement_drive", category: "movement", label: "iniciar movimento ↑" }, { schema: "movement_stop", category: "movement", label: "parar de mover" }],
  light: [{ schema: "display_char", category: "light", label: "escrever A" }, { schema: "display_off", category: "light", label: "desligar matriz" }],
  sound: [{ schema: "beep", category: "sound", label: "tocar bipe 0,5 segundo" }, { schema: "volume", category: "sound", label: "definir volume 75%" }],
  sensors: [{ schema: "sensor_distance", category: "sensors", label: "distância (D)" }, { schema: "sensor_force", category: "sensors", label: "força (E) > 5 N" }, { schema: "timer_reset", category: "sensors", label: "zere o cronômetro" }],
  operators: [{ schema: "math_expression", category: "operators", label: "10 + 5" }, { schema: "comparison", category: "operators", label: "10 > 5" }, { schema: "logic_operation", category: "operators", label: "verdadeiro e falso" }],
  variables: [{ schema: "variable_set", category: "variables", label: "mude velocidade para 300" }, { schema: "variable_change", category: "variables", label: "adicione 1 a velocidade" }],
  libraries: [], logic: [], lists: [], functions: [], communication: [], text: [], hub: [],
};

let analysis = { flat: [], categories: [], diagnostics: [], valid: true, partial: false };
let selectedBlock = null;
let analyzeToken = 0;
let inputSnapshot = "";
let panSession = null;
let registryApi = null;

function icon(name) {
  const paths = {
    play: '<path d="m8 5 11 7-11 7z"/>', route: '<path d="M5 6h7a4 4 0 0 1 4 4v8m-4-4 4 4 4-4"/>',
    motor: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v3m0 10v3M4 12h3m10 0h3M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1m0-11.4-2.1 2.1m-7.2 7.2-2.1 2.1"/>',
    move: '<path d="M5 12h14m-4-4 4 4-4 4M9 5 5 9 9 13"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
    volume: '<path d="M4 10v4h4l5 4V6L8 10zM17 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>', radar: '<circle cx="12" cy="12" r="2"/><path d="M5.6 18.4a9 9 0 1 1 12.8 0M8.4 15.6a5 5 0 1 1 7.2 0"/>',
    braces: '<path d="M8 3H6a2 2 0 0 0-2 2v4l-2 3 2 3v4a2 2 0 0 0 2 2h2m8-18h2a2 2 0 0 1 2 2v4l2 3-2 3v4a2 2 0 0 1-2 2h-2"/>',
    variable: '<path d="M4 7h5l6 10h5M15 7h5M4 17h5"/>', library: '<path d="M4 4h5v16H4zM10 4h5v16h-5zM16 6h4v14h-4z"/>', text: '<path d="M5 5h14M12 5v14m-4 0h8"/>', cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.braces}</svg>`;
}

async function init() {
  await loadRegistry();
  window.CODE_STUDIO_ROBOT_SETTINGS = store.state.project.settings;
  if (matchMedia("(max-width: 1279px)").matches && !sessionStorage.getItem("code-studio-explorer-choice")) store.state.view.explorer = false;
  if (matchMedia("(max-width: 767px)").matches) {
    $(".blocks-pane").classList.add("library-closed");
    Object.assign(store.state.view, { panX: 18, panY: 46, zoom: .86 });
  }
  renderAll();
  bindUI();
  updateEditorFromState();
  scheduleAnalysis(true);
  log("info", "Code Studio pronto. Crie blocos ou escreva Python.");
}

async function loadRegistry() {
  try {
    const response = await fetch("/pybricks-api.json");
    if (!response.ok) throw new Error("Catálogo Pybricks indisponível");
    const registry = await response.json();
    registryApi = registry;
    window.CodeBlocks.registerCatalog(registry.visualBlocks || []);
    for (const entry of registry.visualBlocks || []) {
      if (!starterBlocks[entry.category]) starterBlocks[entry.category] = [];
      starterBlocks[entry.category].push({
        schema: entry.id,
        category: entry.category,
        label: entry.label,
        params: Object.fromEntries((entry.fields || []).map(field => [field.name, field.default])),
        imports: entry.imports || [],
      });
    }
  } catch (error) {
    console.warn(error.message);
  }
}

function renderAll() {
  renderTabs(); renderFiles(); renderCategories(); renderLibrary(); renderBlocks(); updateChrome();
}

function renderTabs() {
  const tabs = store.state.project.files.filter(file => /\/programacao\/saidas\/saida_\d+\.py$/.test(file.path));
  $("#outputTabs").querySelectorAll(".output").forEach(node => node.remove());
  const plus = $("#addOutput");
  tabs.forEach(file => {
    const number = file.name.match(/\d+/)?.[0] || "1";
    const button = document.createElement("button");
    button.className = `output ${file.file_id === store.state.activeFileId ? "active" : ""}`;
    button.textContent = `Saída ${number}`; button.dataset.fileId = file.file_id;
    plus.before(button);
  });
}

function renderFiles() {
  const tree = $("#fileTree"); tree.replaceChildren();
  const grouped = new Map();
  for (const path of store.state.project.folders || []) grouped.set(path.replace(/^\//, "") || "raiz", []);
  for (const file of store.state.project.files) {
    const folder = file.path.split("/").filter(Boolean).slice(0, -1).join("/") || "raiz";
    if (!grouped.has(folder)) grouped.set(folder, []); grouped.get(folder).push(file);
  }
  for (const [folder, files] of grouped) {
    const section = document.createElement("section"); section.className = "tree-folder open";
    section.innerHTML = `<button class="tree-folder-button">${icon("library")}<span>${escapeHtml(folder)}</span><i>›</i></button><div class="tree-children"></div>`;
    section.querySelector(".tree-folder-button").onclick = () => section.classList.toggle("open");
    const children = section.querySelector(".tree-children");
    for (const file of files) {
      const button = document.createElement("button");
      button.className = `tree-file ${file.file_id === store.state.activeFileId ? "active" : ""}`;
      button.dataset.fileId = file.file_id;
      button.innerHTML = `${icon("braces")}<span>${escapeHtml(file.name)}</span>${file.modified ? "<i></i>" : ""}`;
      children.append(button);
    }
    tree.append(section);
  }
}

function renderCategories() {
  const nav = $("#categories"); nav.replaceChildren();
  const priorities = new Set(analysis.categories || []);
  const entries = Object.entries(categoryMeta).sort(([a], [b]) => Number(priorities.has(b)) - Number(priorities.has(a)));
  for (const [id, [label, glyph, color]] of entries) {
    const button = document.createElement("button");
    button.className = `${store.state.view.category === id ? "active" : ""} ${priorities.has(id) ? "detected" : ""}`;
    button.dataset.category = id; button.style.setProperty("--category", color);
    button.setAttribute("aria-label", label); button.title = label;
    button.innerHTML = `${icon(glyph)}<span>${label}</span>`;
    nav.append(button);
  }
}

function renderLibrary() {
  const id = store.state.view.category;
  $("#categoryTitle").textContent = categoryMeta[id]?.[0] || id;
  const list = $("#libraryList"); list.replaceChildren();
  const blocks = [...(starterBlocks[id] || [])];
  if (id === "libraries") {
    for (const [name, symbol] of Object.entries(analysis.symbols || {})) if (symbol.kind === "function") blocks.push({ schema: "library_call", category: "libraries", label: name, params: { module: store.activeFile.module_name, function: name, arguments: Object.fromEntries((symbol.parameters || []).map(parameter => [parameter, 0])) } });
  }
  if (!blocks.length) list.innerHTML = '<p class="library-empty">Os blocos deste grupo aparecem conforme o projeto ganha recursos.</p>';
  for (const block of blocks) {
    const item = document.createElement("button"); item.className = `library-block cat-${block.category}`;
    item.style.setProperty("--color", categoryMeta[block.category]?.[2] || "#60788d");
    const candidate = structuredClone(block); const view = window.CodeBlocks.render(candidate) || window.CodeBlocks.genericRender(candidate);
    item.innerHTML = view.html; item.dataset.block = JSON.stringify(candidate);
    item.draggable = true; list.append(item);
  }
}

function renderBlocks() {
  window.CODE_STUDIO_ROBOT_SETTINGS = store.state.project.settings;
  const stack = $("#blockStack"); stack.replaceChildren();
  const blocks = analysis.flat || [];
  if (!blocks.length) {
    stack.innerHTML = `<div class="empty-workspace"><div class="empty-circuit" aria-hidden="true">${icon("cpu")}</div><strong>Pronto para montar</strong><p>Arraste um bloco ou escreva Python. Os dois lados trabalham juntos.</p></div>`;
  }
  for (const block of blocks) {
    const prepared = { ...structuredClone(block), label: block.text || block.schema };
    const view = window.CodeBlocks.render(prepared) || window.CodeBlocks.genericRender(prepared);
    const element = document.createElement("div");
    element.className = `program-block shape-${view.shape} cat-${block.category} ${selectedBlock === block.id ? "selected" : ""}`;
    element.style.setProperty("--color", categoryMeta[block.category]?.[2] || "#60788d");
    element.dataset.blockId = block.id; element.dataset.source = JSON.stringify(block.source);
    element.style.marginLeft = `${Math.min(block.depth || 0, 5) * 24}px`;
    element.innerHTML = `<div class="block-content">${view.html}</div>`;
    element._block = prepared; stack.append(element);
  }
  applyWorkspaceTransform();
}

function updateChrome() {
  const file = store.activeFile;
  $("#activeFileTab").textContent = file?.path?.replace(/^\//, "") || "";
  $("#statusFile").textContent = `Arquivo: ${file?.name || ""}`;
  $("#repoPath").value = outputRepoPath();
  $("#fileDirty").textContent = file?.modified ? "•" : "";
  $("#mainGrid").classList.toggle("explorer-open", store.state.view.explorer);
  $("#fileExplorer").classList.toggle("hidden", !store.state.view.explorer);
  $("#githubPanel").classList.toggle("open", store.state.view.github);
  updateSyncState();
}

function updateEditorFromState() {
  const editor = $("#codeEditor");
  const content = store.activeFile?.content || "";
  if (editor.value !== content) editor.value = content;
  renderCode();
}

function renderCode() {
  const editor = $("#codeEditor");
  const lines = editor.value.split("\n");
  $("#lineNumbers").innerHTML = lines.map((_, index) => `<span>${index + 1}</span>`).join("");
  $("#highlight").innerHTML = syntaxHighlight(editor.value) + "\n";
  $("#highlight").scrollTop = editor.scrollTop; $("#highlight").scrollLeft = editor.scrollLeft;
  $("#lineNumbers").scrollTop = editor.scrollTop;
}

function scheduleAnalysis(immediate = false) {
  const token = ++analyzeToken;
  store.state.sync = "updating"; updateSyncState();
  clearTimeout(scheduleAnalysis.timer);
  scheduleAnalysis.timer = setTimeout(() => analyze(token), immediate ? 0 : 160);
}

async function analyze(token) {
  const code = store.activeFile?.content || "";
  try {
    const response = await fetch("/api/project/semantic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const result = await response.json();
    if (token !== analyzeToken) return;
    if (!response.ok || !result.ok) throw new Error(result.error || "Falha na análise");
    analysis = result;
    store.state.sync = result.valid ? (result.partial ? "partial" : "synced") : (result.flat.length ? "partial" : "error");
    const file = store.activeFile; file.blocks = result.flat; file.symbols = result.symbols; file.diagnostics = result.diagnostics;
    renderCategories(); renderLibrary(); renderBlocks(); updateSyncState(); renderDiagnostics();
  } catch (error) {
    store.state.sync = "error"; updateSyncState(); log("error", error.message);
  }
}

function onEditorInput(event) {
  const value = event.target.value;
  if (value === store.activeFile.content) return;
  if (!inputSnapshot) store.snapshot("editar Python");
  clearTimeout(onEditorInput.snapshotTimer);
  onEditorInput.snapshotTimer = setTimeout(() => { inputSnapshot = ""; }, 500);
  inputSnapshot = value;
  store.activeFile.content = value; store.activeFile.modified = true; store.persist();
  renderCode(); scheduleAnalysis(); updateChrome(); showAutocomplete();
}

async function onPaste(event) {
  event.preventDefault();
  const editor = event.currentTarget;
  const pasted = event.clipboardData.getData("text/plain");
  const start = editor.selectionStart, end = editor.selectionEnd;
  const raw = editor.value.slice(0, start) + pasted + editor.value.slice(end);
  let code = raw;
  try {
    const response = await fetch("/api/project/format", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: raw }) });
    const result = await response.json(); if (result.code) code = result.code;
    if (result.changes?.length) log("info", result.changes.join(" "));
  } catch {}
  store.update(() => { store.activeFile.content = code; store.activeFile.modified = true; }, "colar e corrigir Python");
  updateEditorFromState(); editor.selectionStart = editor.selectionEnd = Math.min(start + pasted.length, code.length);
  scheduleAnalysis(true);
}

function bindUI() {
  const editor = $("#codeEditor");
  editor.addEventListener("input", onEditorInput);
  editor.addEventListener("paste", onPaste);
  editor.addEventListener("scroll", renderCode);
  editor.addEventListener("click", highlightBlockForCursor);
  editor.addEventListener("keyup", highlightBlockForCursor);
  editor.addEventListener("keydown", handleEditorKeys);
  $("#categories").addEventListener("click", event => { const button = event.target.closest("[data-category]"); if (!button) return; store.state.view.category = button.dataset.category; if (matchMedia("(max-width: 767px)").matches) $(".blocks-pane").classList.remove("library-closed"); store.persist(); renderCategories(); renderLibrary(); });
  $("#collapseLibrary").onclick = () => $(".blocks-pane").classList.toggle("library-closed");
  $("#libraryList").addEventListener("click", event => { const item = event.target.closest(".library-block"); if (item) insertBlock(JSON.parse(item.dataset.block)); });
  $("#libraryList").addEventListener("dragstart", event => event.dataTransfer.setData("application/x-code-studio-block", event.target.closest(".library-block")?.dataset.block || ""));
  $("#workspace").addEventListener("dragover", event => event.preventDefault());
  $("#workspace").addEventListener("drop", event => { event.preventDefault(); const data = event.dataTransfer.getData("application/x-code-studio-block"); if (data) insertBlock(JSON.parse(data)); });
  $("#blockStack").addEventListener("click", selectBlock);
  $("#blockStack").addEventListener("input", updateBlockField);
  $("#blockStack").addEventListener("change", updateBlockField);
  $("#outputTabs").addEventListener("click", switchOutput);
  $("#fileTree").addEventListener("click", switchFile);
  $("#addOutput").onclick = addOutput;
  $("#newBtn").onclick = addOutput;
  $("#newFileBtn").onclick = () => promptNewFile();
  $("#newFolderBtn").onclick = promptNewFolder;
  $("#libraryTemplateBtn").onclick = addMovementLibrary;
  $("#dependencyBtn").onclick = showDependencies;
  $("#importFileBtn").onclick = () => $("#fileImportInput").click();
  $("#fileImportInput").onchange = importFile;
  $("#filesToggle").onclick = () => store.update(state => state.view.explorer = !state.view.explorer, "alternar projeto", false);
  $(".mobile-switcher").onclick = switchMobileView;
  $("#githubToggle").onclick = () => store.update(state => state.view.github = !state.view.github, "alternar GitHub", false);
  $("#closeGithub").onclick = () => store.update(state => state.view.github = false, "fechar GitHub", false);
  $("#connectBtn").onclick = () => hub.connect().catch(error => log("error", error.message));
  $("#runBtn").onclick = runProgram; $("#stopBtn").onclick = () => hub.stop().catch(error => log("error", error.message));
  $("#downloadBtn").onclick = () => runProgram(false);
  $("#commitBtn").onclick = commitProject;
  $("#clearTerminal").onclick = () => $("#terminalLines").replaceChildren();
  $("#settingsBtn").onclick = openPreferences;
  $("#closePreferences").onclick = () => $("#preferencesPopover").hidden = true;
  $("#soundEnabled").onchange = event => updateSetting("sound", event.target.checked);
  $("#soundVolume").oninput = event => updateSetting("volume", event.target.value / 100);
  $("#wheelDiameter").onchange = event => updateGeometry("wheelDiameter", event.target.value);
  $("#axleTrack").onchange = event => updateGeometry("axleTrack", event.target.value);
  $("#robotWidth").onchange = event => updateGeometry("widthStuds", event.target.value);
  $("#robotLength").onchange = event => updateGeometry("lengthStuds", event.target.value);
  $("#profileStack").onclick = showTeamActivity;
  $("#closeProfile").onclick = () => $("#profilePanel").hidden = true;
  $("#fileTree").addEventListener("contextmenu", openFileMenu);
  $("#blockStack").addEventListener("contextmenu", openBlockMenu);
  document.addEventListener("pointerdown", event => { if (!event.target.closest(".context-menu")) document.querySelectorAll(".context-menu").forEach(menu => menu.hidden = true); });
  document.addEventListener("keydown", globalKeys);
  $("#workspace").addEventListener("pointerdown", beginPan);
  document.addEventListener("pointermove", movePan); document.addEventListener("pointerup", endPan);
  $(".workspace-controls").onclick = workspaceAction;
  store.addEventListener("change", () => { renderAll(); updateEditorFromState(); scheduleAnalysis(true); });
  hub.addEventListener("state", updateHub);
  hub.addEventListener("output", event => log("info", event.detail));
}

function switchMobileView(event) {
  const button = event.target.closest("[data-mobile-view]"); if (!button) return;
  const mode = button.dataset.mobileView;
  $(".mobile-switcher").querySelectorAll("button").forEach(item => item.classList.toggle("active", item === button));
  $("#mainGrid").dataset.mobileView = mode;
}

function insertBlock(block) {
  const candidate = structuredClone(block); window.CodeBlocks.prepare(candidate);
  let code = candidate.code || "";
  if (!code) return toast("Este bloco ainda precisa de parâmetros.", "warning");
  const existing = store.activeFile.content.trimEnd();
  const dependencies = blockDependencies(candidate, existing);
  store.update(() => { store.activeFile.content = `${dependencies}${existing}${existing ? "\n" : ""}${code}\n`; store.activeFile.modified = true; }, "inserir bloco");
  updateEditorFromState(); scheduleAnalysis(true); sound(520, .05);
  if (matchMedia("(max-width: 767px)").matches) $(".blocks-pane").classList.add("library-closed");
}

function blockDependencies(block, code) {
  const lines = [];
  const add = line => { if (!code.includes(line) && !lines.includes(line)) lines.push(line); };
  for (const dependency of block.imports || []) add(dependency);
  if (block.category === "motors") {
    add("from pybricks.pupdevices import Motor"); add("from pybricks.parameters import Port");
    const port = block.params?.port || "A"; add(`motor_${port.toLowerCase()} = Motor(Port.${port})`);
  }
  if (block.category === "movement") {
    const settings = store.state.project.settings;
    add("from pybricks.pupdevices import Motor"); add("from pybricks.parameters import Port"); add("from pybricks.robotics import DriveBase");
    add("motor_a = Motor(Port.A)"); add("motor_b = Motor(Port.B)");
    add(`robot = DriveBase(motor_a, motor_b, wheel_diameter=${Number(settings.wheelDiameter)}, axle_track=${Number(settings.axleTrack)})`);
  }
  if (block.category === "sensors") {
    const port = block.params?.port;
    const variablePort = String(port || "D").toLowerCase();
    add("from pybricks.parameters import Port");
    if (block.schema.startsWith("color_")) { add("from pybricks.pupdevices import ColorSensor"); add(`color_${variablePort} = ColorSensor(Port.${port})`); }
    if (block.schema.startsWith("ultrasonic_")) { add("from pybricks.pupdevices import UltrasonicSensor"); add(`distance_${variablePort} = UltrasonicSensor(Port.${port})`); }
    if (block.schema === "sensor_distance") { add("from pybricks.pupdevices import UltrasonicSensor"); add(`distance_${port || "D"} = UltrasonicSensor(Port.${port || "D"})`); }
    if (block.schema.startsWith("force_")) { add("from pybricks.pupdevices import ForceSensor"); add(`force_${variablePort} = ForceSensor(Port.${port})`); }
    if (block.schema === "sensor_force") { add("from pybricks.pupdevices import ForceSensor"); add(`force_${port || "E"} = ForceSensor(Port.${port || "E"})`); }
    if (block.schema.startsWith("imu_")) { add("from pybricks.hubs import PrimeHub"); add("hub = PrimeHub()"); }
  }
  if (["light", "sound", "hub"].includes(block.category)) { add("from pybricks.hubs import PrimeHub"); add("hub = PrimeHub()"); }
  if (block.schema === "wait") add("from pybricks.tools import wait");
  return lines.length ? `${lines.join("\n")}\n\n` : "";
}

function selectBlock(event) {
  if (event.target.closest(".gb-field")) return;
  const element = event.target.closest(".program-block"); if (!element) return;
  selectedBlock = element.dataset.blockId; renderBlocks();
  const source = JSON.parse(element.dataset.source); selectEditorSpan(source);
}

function updateBlockField(event) {
  const field = event.target.closest(".gb-field"); const element = event.target.closest(".program-block");
  if (!field || !element) return;
  const block = element._block; const value = field.type === "checkbox" ? field.checked : field.value;
  if (!window.CodeBlocks.update(block, field.dataset.field, value)) window.CodeBlocks.updateLegacy(block, field.dataset.field, value);
  const source = JSON.parse(element.dataset.source);
  replaceSpan(source, block.code); scheduleAnalysis(true);
}

function replaceSpan(span, replacement) {
  const lines = store.activeFile.content.split("\n");
  const before = lines.slice(0, span.startLine - 1).join("\n") + (span.startLine > 1 ? "\n" : "") + lines[span.startLine - 1].slice(0, span.startColumn);
  const after = lines[span.endLine - 1].slice(span.endColumn) + (span.endLine < lines.length ? "\n" + lines.slice(span.endLine).join("\n") : "");
  store.update(() => { store.activeFile.content = before + replacement + after; store.activeFile.modified = true; }, "editar parâmetro do bloco");
  updateEditorFromState();
}

function highlightBlockForCursor() {
  const editor = $("#codeEditor"); const before = editor.value.slice(0, editor.selectionStart); const line = before.split("\n").length;
  const match = analysis.flat.find(item => line >= item.source.startLine && line <= item.source.endLine);
  selectedBlock = match?.id || null;
  document.querySelectorAll(".program-block").forEach(element => element.classList.toggle("selected", element.dataset.blockId === selectedBlock));
  document.querySelector(`[data-block-id="${selectedBlock}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function selectEditorSpan(span) {
  const editor = $("#codeEditor"); const lines = editor.value.split("\n");
  const offset = (line, column) => lines.slice(0, line - 1).reduce((sum, value) => sum + value.length + 1, 0) + column;
  editor.focus(); editor.setSelectionRange(offset(span.startLine, span.startColumn), offset(span.endLine, span.endColumn));
}

function handleEditorKeys(event) {
  if (event.key === "Tab") {
    event.preventDefault(); const editor = event.currentTarget; const start = editor.selectionStart;
    editor.setRangeText("    ", start, editor.selectionEnd, "end"); editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function globalKeys(event) {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? store.redo() : store.undo(); }
  if (command && event.key.toLowerCase() === "y") { event.preventDefault(); store.redo(); }
  if ((event.key === "Delete" || event.key === "Backspace") && document.activeElement === $("#workspace") && selectedBlock) deleteSelectedBlock();
  if (event.key === "F5") { event.preventDefault(); runProgram(); }
  if (event.shiftKey && event.key === "F5") { event.preventDefault(); hub.stop(); }
}

function deleteSelectedBlock() {
  const block = analysis.flat.find(item => item.id === selectedBlock); if (!block) return;
  replaceSpan(block.source, ""); selectedBlock = null; sound(190, .04);
}

function switchOutput(event) { const button = event.target.closest("[data-file-id]"); if (button) activateFile(button.dataset.fileId); }
function switchFile(event) { const button = event.target.closest("[data-file-id]"); if (button) activateFile(button.dataset.fileId); }
function activateFile(id) { store.update(state => state.activeFileId = id, "abrir arquivo", false); }
function addOutput() {
  const numbers = store.state.project.files.map(file => Number(file.name.match(/^saida_(\d+)\.py$/)?.[1] || 0));
  const next = Math.max(0, ...numbers) + 1; const file = vfs.create(`saida_${next}.py`, "/programacao/saidas");
  store.state.activeOutput = next; store.state.activeFileId = file.file_id;
}
function promptNewFile() { const name = prompt("Nome do novo arquivo Python:", "movements.py"); if (name) try { vfs.create(name); } catch (error) { toast(error.message, "error"); } }
function promptNewFolder() {
  const raw = prompt("Nome da nova pasta:", "bibliotecas"); if (!raw) return;
  const safe = raw.trim().replace(/[^\w-]/g, "_"); if (!safe) return toast("Informe um nome de pasta válido.", "error");
  const path = `/${safe}`;
  if ((store.state.project.folders || []).includes(path)) return toast("Essa pasta já existe.", "warning");
  store.update(state => (state.project.folders ||= []).push(path), "criar pasta");
}

function addMovementLibrary() {
  if (store.state.project.files.some(file => file.path === "/libraries/movements.py")) return toast("A biblioteca de movimentos já existe.", "warning");
  if (!(store.state.project.folders || []).includes("/libraries")) store.state.project.folders.push("/libraries");
  const file = vfs.create("movements.py", "/libraries");
  file.content = `from pybricks.robotics import DriveBase\n\ndef avancar(robot: DriveBase, distancia_mm=100):\n    robot.straight(distancia_mm)\n\ndef girar(robot: DriveBase, angulo=90):\n    robot.turn(angulo)\n`;
  file.modified = true; store.persist(); updateEditorFromState(); scheduleAnalysis(true);
  toast("Biblioteca editável criada em libraries/movements.py.", "success");
}

function showDependencies() {
  const modules = new Map(store.state.project.files.map(file => [file.module_name, file.name]));
  const lines = store.state.project.files.map(file => {
    const deps = [...file.content.matchAll(/^\s*(?:from|import)\s+([\w.]+)/gm)].map(match => match[1]).filter(name => modules.has(name));
    return `${file.name}: ${deps.length ? deps.join(", ") : "sem dependências internas"}`;
  });
  log("info", `Dependências — ${lines.join(" · ")}`); toast("Grafo de dependências enviado ao console.", "info");
}

function openPreferences() {
  const settings = store.state.project.settings;
  $("#wheelDiameter").value = settings.wheelDiameter; $("#axleTrack").value = settings.axleTrack;
  $("#robotWidth").value = settings.widthStuds; $("#robotLength").value = settings.lengthStuds;
  $("#soundEnabled").checked = settings.sound; $("#soundVolume").value = Math.round(settings.volume * 100);
  updateFootprint(); $("#preferencesPopover").hidden = false;
}

function updateSetting(key, value) { store.state.project.settings[key] = value; store.persist(); }
function updateGeometry(key, raw) {
  const value = Number(String(raw).replace(",", ".")); if (!Number.isFinite(value) || value <= 0) return openPreferences();
  store.state.project.settings[key] = value; window.CODE_STUDIO_ROBOT_SETTINGS = store.state.project.settings;
  store.activeFile.modified = true; store.persist(); updateFootprint(); renderBlocks();
  toast("Geometria atualizada; novos blocos usarão estas medidas.", "success");
}
function updateFootprint() { const settings = store.state.project.settings; $("#robotFootprint").textContent = `Base estimada: ${settings.widthStuds * 8} × ${settings.lengthStuds * 8} mm`; }

function showTeamActivity(event) {
  const selected = event.target.closest("[data-user]")?.dataset.user || "equipe";
  $("#profileName").textContent = selected === "vitorino2011" ? "João Vitor" : "Atividade da equipe";
  $("#profileSummary").innerHTML = '<div class="metric-loading">As estatísticas aparecem somente quando o GitHub autenticado retornar dados reais.</div>';
  $("#versionRanking").innerHTML = ""; $("#profilePanel").hidden = false;
}

function positionMenu(menu, event) { menu.style.left = `${Math.min(event.clientX, innerWidth - 190)}px`; menu.style.top = `${Math.min(event.clientY, innerHeight - 170)}px`; menu.hidden = false; }
function openFileMenu(event) {
  const button = event.target.closest("[data-file-id]"); if (!button) return; event.preventDefault();
  const file = store.state.project.files.find(item => item.file_id === button.dataset.fileId); const menu = $("#fileContextMenu");
  menu.innerHTML = '<button data-act="rename">Renomear</button><button data-act="duplicate">Duplicar</button><button data-act="entry">Definir como principal</button><button data-act="delete">Excluir</button>';
  menu.onclick = click => { const action = click.target.closest("button")?.dataset.act; menu.hidden = true; if (action === "rename") { const name = prompt("Novo nome:", file.name); if (name) try { vfs.rename(file, name); } catch (error) { toast(error.message, "error"); } } if (action === "duplicate") vfs.duplicate(file); if (action === "entry") store.update(state => state.project.entrypoint = file.file_id, "definir arquivo principal"); if (action === "delete") vfs.remove(file); };
  positionMenu(menu, event);
}
function openBlockMenu(event) {
  const element = event.target.closest(".program-block"); if (!element) return; event.preventDefault(); selectedBlock = element.dataset.blockId;
  const menu = $("#blockContextMenu"); menu.innerHTML = '<button data-act="duplicate">Duplicar bloco</button><button data-act="delete">Excluir bloco</button>';
  menu.onclick = click => { const action = click.target.closest("button")?.dataset.act; menu.hidden = true; const block = analysis.flat.find(item => item.id === selectedBlock); if (action === "delete") deleteSelectedBlock(); if (action === "duplicate" && block) { const source = store.activeFile.content.split("\n").slice(block.source.startLine - 1, block.source.endLine).join("\n"); store.update(() => { store.activeFile.content += `\n${source}`; store.activeFile.modified = true; }, "duplicar bloco"); updateEditorFromState(); scheduleAnalysis(true); } };
  positionMenu(menu, event);
}
async function importFile(event) {
  const file = event.target.files[0]; if (!file) return; const text = await file.text();
  try { if (file.name.endsWith(".lls")) vfs.importLegacy(text, file.name); else { const created = vfs.create(file.name); created.content = text; } } catch (error) { toast(error.message, "error"); }
  event.target.value = "";
}

function outputRepoPath() { const number = store.activeFile?.name.match(/^saida_(\d+)\.py$/)?.[1]; return number ? `programacao/saidas/saida_${number}.py` : `programacao/${store.activeFile?.path.replace(/^\//, "")}`; }

async function commitProject() {
  const files = store.state.project.files.filter(file => file.modified || file.gitStatus === "novo").map(file => ({ path: file.path.replace(/^\//, ""), content: file.content }));
  if (!files.length) return toast("Não há arquivos alterados para enviar.", "info");
  try {
    const response = await fetch("/api/github/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files, author: $("#contributor").value, message: $("#commitMessage").value }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    store.update(state => state.project.files.forEach(file => { file.modified = false; file.gitStatus = "sincronizado"; }), "confirmar atualização GitHub", false);
    toast("Código atualizado no GitHub.", "success"); log("success", `Commit ${result.sha?.slice(0, 7)} criado com ${result.files?.length} arquivo(s).`);
  } catch (error) { toast(error.message || "GitHub indisponível", "error"); }
}

async function runProgram(start = true) {
  if (!analysis.valid) return toast("Corrija os erros de sintaxe antes de enviar.", "error");
  if (hub.state !== "READY") return toast("Conecte o HUB antes de executar.", "warning");
  try { await hub.run(store.activeFile.content); if (!start) await hub.stop(); log("success", start ? "Execução iniciada." : "Programa gravado no HUB."); } catch (error) { log("error", error.message); }
}

function updateHub(event) {
  const labels = { DISCONNECTED: "HUB desconectado", SEARCHING: "Procurando HUB…", FOUND: "HUB encontrado", CONNECTING: "Conectando…", READY: "HUB pronto", UPLOADING: "Enviando programa…", RUNNING: "Programa em execução", FAILED: "Falha na conexão" };
  $("#hubState").textContent = labels[event.detail.state] || event.detail.state;
  $("#hubCard").dataset.state = event.detail.state; $("#footerHub").textContent = labels[event.detail.state];
  $("#runBtn").disabled = event.detail.state !== "READY"; $("#stopBtn").disabled = event.detail.state !== "RUNNING";
}

function updateSyncState() {
  const meta = { synced: ["ok", "Sincronizado"], updating: ["busy", "Atualizando…"], partial: ["partial", "Parcial"], error: ["error", "Erro"] }[store.state.sync] || ["busy", "Atualizando…"];
  const node = $("#syncState"); node.className = `sync ${meta[0]}`; node.innerHTML = `<i></i>${meta[1]}`;
}

function renderDiagnostics() {
  $("#problemCount").textContent = analysis.diagnostics.length;
  for (const diagnostic of analysis.diagnostics) log("error", `Linha ${diagnostic.line}:${diagnostic.column} — ${diagnostic.friendly || diagnostic.message}`);
}

function showAutocomplete() {
  const editor = $("#codeEditor"); const before = editor.value.slice(0, editor.selectionStart); const token = before.match(/[\w.]+$/)?.[0] || "";
  let options = token.startsWith("Port.") ? registryApi?.modules?.["pybricks.parameters"]?.classes?.Port?.constants || [] : [];
  if (/motor(?:_[a-f])?\.$/i.test(token)) options = registryApi?.modules?.["pybricks.pupdevices"]?.classes?.Motor?.methods || [];
  if (/robot\.$/i.test(token)) options = registryApi?.modules?.["pybricks.robotics"]?.classes?.DriveBase?.methods || [];
  if (/hub\.(?:display|light|speaker|imu|system|ble)\.$/i.test(token)) {
    const component = token.split(".").at(-2); options = registryApi?.componentTypes?.[component] || [];
  }
  const popup = $("#autocomplete"); popup.hidden = !options.length; popup.innerHTML = options.map(option => `<button data-value="${option}"><b>${option}</b><small>Pybricks</small></button>`).join("");
  popup.onclick = event => { const button = event.target.closest("button"); if (!button) return; const prefix = token.split(".").at(-1); editor.setRangeText(button.dataset.value, editor.selectionStart - prefix.length, editor.selectionStart, "end"); popup.hidden = true; editor.dispatchEvent(new Event("input", { bubbles: true })); };
}

function beginPan(event) { if (event.button !== 1 && event.button !== 2) return; event.preventDefault(); panSession = { x: event.clientX, y: event.clientY, px: store.state.view.panX, py: store.state.view.panY }; }
function movePan(event) { if (!panSession) return; store.state.view.panX = panSession.px + event.clientX - panSession.x; store.state.view.panY = panSession.py + event.clientY - panSession.y; applyWorkspaceTransform(); }
function endPan() { if (panSession) store.persist(); panSession = null; }
function applyWorkspaceTransform() { $("#workspaceWorld").style.transform = `translate(${store.state.view.panX}px, ${store.state.view.panY}px) scale(${store.state.view.zoom})`; }
function workspaceAction(event) { const action = event.target.closest("button")?.dataset.act; if (!action) return; if (action === "zoomIn") store.state.view.zoom = Math.min(1.8, store.state.view.zoom + .1); if (action === "zoomOut") store.state.view.zoom = Math.max(.45, store.state.view.zoom - .1); if (action === "fit") Object.assign(store.state.view, { zoom: 1, panX: 96, panY: 88 }); if (action === "undo") return store.undo(); if (action === "redo") return store.redo(); if (action === "delete") return deleteSelectedBlock(); store.persist(); applyWorkspaceTransform(); }

function syntaxHighlight(code) {
  const escaped = escapeHtml(code);
  return escaped.replace(/(&quot;.*?&quot;|&#039;.*?&#039;)/g, '<span class="tok-string">$1</span>')
    .replace(/(^|\s)(#.*)$/gm, '$1<span class="tok-comment">$2</span>')
    .replace(/\b(from|import|as|def|class|if|elif|else|for|while|in|return|try|except|finally|with|break|continue|and|or|not|True|False|None)\b/g, '<span class="tok-keyword">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]); }
function log(type, message) { const line = document.createElement("div"); line.className = type; line.innerHTML = `<time>${new Date().toLocaleTimeString("pt-BR")}</time><span>${escapeHtml(message)}</span>`; $("#terminalLines").append(line); $("#terminalLines").scrollTop = 1e6; }
function toast(message, type = "info") { const node = $("#toast"); node.textContent = message; node.className = `toast show ${type}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2800); }
function sound(frequency, duration) { if (!store.state.project.settings.sound) return; const context = new AudioContext(); const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.frequency.value = frequency; gain.gain.value = store.state.project.settings.volume * .08; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration); }

init();

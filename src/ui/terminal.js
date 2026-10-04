/**
 * TERMINAL — Parte 17
 * -------------------
 * Abas "Saída" e "Problemas" (a aba "Ajuda" foi removida — 17.3).
 * Carimbo de hora em cada linha. aria-live="polite" (Parte 24).
 * A bateria NÃO aparece aqui (N13) — só no cartão do HUB.
 *
 * Três níveis de erro (17.1): Bloco · Python · Pybricks.
 * Formato obrigatório de mensagem (17.2):
 *   Arquivo / Linha / Coluna / Causa / Sugestão
 * Proibido: "Erro no código" sem contexto.
 */

export const LEVEL = {
  SUCCESS: "success",
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
};

const MAX_LINES = 400;

export class Terminal {
  constructor({ container, tabs, counter, onJumpToLine } = {}) {
    this.container = container;
    this.tabs = tabs ?? [];
    this.counter = counter ?? null;
    this.onJumpToLine = onJumpToLine ?? (() => {});
    this.lines = [];
    this.activeTab = "output";
    this.problemCount = 0;
    this.bindTabs();
  }

  bindTabs() {
    this.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        this.activeTab = tab.dataset.tab ?? "output";
        this.tabs.forEach((item) => item.classList.toggle("active", item === tab));
        this.render();
      });
    });
  }

  timestamp() {
    const now = new Date();
    return [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  /**
   * Escreve uma linha.
   * @param {string} text
   * @param {string} level LEVEL.*
   * @param {object} meta { file, line, column, cause, suggestion, tab }
   */
  write(text, level = LEVEL.INFO, meta = {}) {
    this.lines.push({
      text: String(text ?? ""),
      level,
      at: this.timestamp(),
      tab: meta.tab ?? (level === LEVEL.ERROR || level === LEVEL.WARNING ? "problems" : "output"),
      file: meta.file ?? null,
      line: meta.line ?? null,
      column: meta.column ?? null,
      cause: meta.cause ?? null,
      suggestion: meta.suggestion ?? null,
    });

    if (this.lines.length > MAX_LINES) this.lines = this.lines.slice(-MAX_LINES);
    this.updateCounter();
    this.render();
  }

  success(text, meta) { this.write(text, LEVEL.SUCCESS, meta); }
  info(text, meta) { this.write(text, LEVEL.INFO, meta); }
  warning(text, meta) { this.write(text, LEVEL.WARNING, meta); }
  error(text, meta) { this.write(text, LEVEL.ERROR, meta); }

  /**
   * Diagnóstico completo no formato da Parte 17.2.
   * Nunca escreve "erro no código" sem contexto.
   */
  diagnostic(diagnostic) {
    if (!diagnostic) return;
    const parts = [];
    if (diagnostic.file) parts.push(`Arquivo:  ${diagnostic.file}`);
    if (diagnostic.line) parts.push(`Linha:    ${diagnostic.line}${diagnostic.column ? `    Coluna: ${diagnostic.column}` : ""}`);
    if (diagnostic.cause) parts.push(`Causa:    ${diagnostic.cause}`);
    if (diagnostic.suggestion) parts.push(`Sugestão: ${diagnostic.suggestion}`);

    this.write(parts.join("\n") || diagnostic.short || "Erro no código.", LEVEL.ERROR, {
      tab: "problems",
      file: diagnostic.file,
      line: diagnostic.line,
      column: diagnostic.column,
    });
  }

  /** Mensagem de sucesso granular (Parte 17.4). */
  validationSummary(checks) {
    for (const check of checks ?? []) {
      const mark = check.ok ? "✓" : "✗";
      const text = `${mark} ${check.name}${check.ok ? "" : ` — ${check.detail || "verifique"}`}`;
      this.write(text, check.ok ? LEVEL.SUCCESS : LEVEL.ERROR, { tab: check.ok ? "output" : "problems" });
    }
    // 17.4: sintaxe válida NÃO significa lógica correta — não prometer isso
    this.write("Sintaxe válida não garante que a lógica da missão esteja correta.", LEVEL.INFO);
  }

  clear() {
    this.lines = [];
    this.updateCounter();
    this.render();
  }

  updateCounter() {
    this.problemCount = this.lines.filter((line) => line.tab === "problems").length;
    if (this.counter) this.counter.textContent = String(this.problemCount);
  }

  render() {
    if (!this.container) return;
    const visible = this.lines.filter((line) => line.tab === this.activeTab);
    const fragment = document.createDocumentFragment();

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "terminal-line info terminal-empty";
      empty.textContent = this.activeTab === "problems"
        ? "Nenhum problema detectado."
        : "Nenhuma saída ainda.";
      fragment.appendChild(empty);
    }

    for (const line of visible) {
      const row = document.createElement("div");
      row.className = `terminal-line ${line.level}`;
      if (line.line) row.dataset.line = String(line.line);

      const message = document.createElement("span");
      message.className = "terminal-message";
      message.textContent = line.text;

      const time = document.createElement("time");
      time.textContent = line.at;

      row.append(message, time);
      if (line.line) {
        row.classList.add("clickable");
        row.title = "Clique para ir até a linha";
        row.addEventListener("click", () => this.onJumpToLine(line.line, line.column));
      }
      fragment.appendChild(row);
    }

    this.container.replaceChildren(fragment);
    this.container.scrollTop = this.container.scrollHeight;
  }
}

export default Terminal;

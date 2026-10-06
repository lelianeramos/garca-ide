/**
 * EDITOR VIEW — Parte 15
 * ----------------------
 * Recursos PASSIVOS: nenhum vira botão (N09). Especificamente proibidos:
 * "Auto-complete", "Indentação", "Erros explicados" como botões.
 *
 * CORREÇÃO DO BUG DOS NÚMEROS DE LINHA CONCATENADOS:
 *   A régua agora é montada com UM ELEMENTO DE BLOCO POR LINHA (<div class="ln">),
 *   cada um com height/line-height iguais aos 20px do editor. Antes o conteúdo
 *   era texto corrido num contêiner com white-space:pre — sem quebras reais,
 *   os números se emendavam numa faixa só ("123456789..."). Com um nó por
 *   linha a concatenação é estruturalmente impossível.
 *   A régua acompanha a rolagem via transform:translateY(-scrollTop), então
 *   nunca dessincroniza do textarea.
 */

import {
  renderLineNumbers, highlightCode, syncScroll, nextIndent, reindent,
  handlePairKey, completionContext, getCompletions, applyCompletion,
  completionPosition, cursorPosition, documentationAt, signatureHelp,
  setLineHeight, lineTrack,
} from "../editor/pythonEditor.js";
import { measureEditor, verifyAlignment, pointToCaret, editorMetrics } from "../editor/editorMetrics.js";
import { sound } from "./sound.js";

const PAIR_KEYS = new Set(["(", "[", "{", '"', "'"]);

export class EditorView {
  constructor({
    textarea, gutter, highlight, popup, ruler, statusBar,
    onInput, onCursorMove, onPasteNormalized,
  }) {
    this.textarea = textarea;
    this.gutter = gutter;
    this.highlight = highlight;
    this.popup = popup;
    this.ruler = ruler;
    this.statusBar = statusBar;
    this.onInput = onInput ?? (() => {});
    this.onCursorMove = onCursorMove ?? (() => {});
    this.onPasteNormalized = onPasteNormalized ?? (() => {});

    this.diagnostics = [];
    this.completions = [];
    this.completionIndex = 0;
    this.completionOpen = false;
    this.scope = {};
    this.silentUpdate = false;
    this.tooltipTimer = null;

    this.bind();
  }

  /* ------------------------------ valor ------------------------------ */

  get value() { return this.textarea?.value ?? ""; }

  /** Atualiza o conteúdo sem disparar o pipeline (usado ao aplicar patch de bloco). */
  setValue(code, { caret = null, silent = true } = {}) {
    if (!this.textarea) return;
    this.silentUpdate = silent;
    const previousScroll = this.textarea.scrollTop;
    this.textarea.value = String(code ?? "");
    if (caret !== null) { this.textarea.selectionStart = caret; this.textarea.selectionEnd = caret; }
    this.textarea.scrollTop = previousScroll;
    this.refresh();
    this.silentUpdate = false;
  }

  get caret() { return this.textarea?.selectionStart ?? 0; }

  setCursor(line, column = 1) {
    if (!this.textarea) return;
    const lines = this.value.split("\n");
    let offset = 0;
    for (let index = 0; index < Math.min(line - 1, lines.length); index += 1) offset += lines[index].length + 1;
    offset += Math.max(0, column - 1);
    this.textarea.focus({ preventScroll: false });
    this.textarea.selectionStart = offset;
    this.textarea.selectionEnd = offset;
    this.revealLine(line);
    this.onCursorMove(cursorPosition(this.value, offset));
  }

  selectRange(start, end) {
    if (!this.textarea) return;
    this.textarea.focus();
    this.textarea.selectionStart = start;
    this.textarea.selectionEnd = end;
    const line = cursorPosition(this.value, start).line;
    this.revealLine(line);
  }

  revealLine(line) {
    if (!this.textarea) return;
    const metrics = editorMetrics();
    const top = metrics.paddingTop + (line - 1) * metrics.lineHeight;
    const visible = this.textarea.clientHeight - metrics.paddingTop - metrics.paddingBottom;
    if (top < this.textarea.scrollTop || top > this.textarea.scrollTop + visible) {
      this.textarea.scrollTop = Math.max(0, top - visible / 2);
      syncScroll(this.textarea, this.gutter, this.highlight);
    }
  }

  /**
   * Mede a métrica real do editor e a publica para o resto do código.
   * Roda no boot, a cada refresh e quando a fonte/zoom/janela muda.
   */
  measure() {
    const metrics = measureEditor(this.textarea);
    setLineHeight(metrics.lineHeight);
    this.metrics = metrics;
    return metrics;
  }

  /**
   * Autodiagnóstico do alinhamento (usado nos testes e no terminal).
   * Se alguém reintroduzir diferença de CSS entre o realce e o textarea,
   * isto acusa a diferença em vez de esconder com deslocamento artificial.
   */
  diagnose() {
    this.measure();
    const report = verifyAlignment(this.textarea, this.highlight);
    if (!report.aligned) {
      console.warn("[Garça Studio] editor desalinhado:", report.differences);
    }
    return report;
  }

  /* ------------------------------ eventos ------------------------------ */

  bind() {
    const textarea = this.textarea;
    if (!textarea) return;

    // B02/B13: TODOS estes eventos disparam o pipeline — nunca só o blur
    textarea.addEventListener("input", (event) => {
      this.refresh();
      if (this.silentUpdate) return;
      this.onInput(this.value, { immediate: event.inputType === "insertFromPaste" });
      this.maybeOpenCompletions();
    });

    textarea.addEventListener("paste", (event) => this.handlePaste(event));
    textarea.addEventListener("cut", () => setTimeout(() => { this.refresh(); this.onInput(this.value, { immediate: true }); }, 0));
    textarea.addEventListener("drop", () => setTimeout(() => { this.refresh(); this.onInput(this.value, { immediate: true }); }, 0));

    textarea.addEventListener("scroll", () => syncScroll(textarea, this.gutter, this.highlight), { passive: true });

    textarea.addEventListener("keydown", (event) => this.handleKey(event));
    textarea.addEventListener("keyup", (event) => {
      if (["Backspace", "Delete"].includes(event.key)) {
        this.refresh();
        this.onInput(this.value, { immediate: false });
      }
      this.onCursorMove(cursorPosition(this.value, this.caret));
    });

    ["click", "select", "focus"].forEach((name) =>
      textarea.addEventListener(name, () => {
        const position = cursorPosition(this.value, this.caret);
        this.refresh();
        this.onCursorMove(position);
      }));

    textarea.addEventListener("blur", () => this.closeCompletions());

    // Documentação ao passar o mouse (Parte 15.1)
    textarea.addEventListener("mousemove", (event) => this.handleHover(event));
    textarea.addEventListener("mouseleave", () => this.hideTooltip());

    // Zoom do navegador, troca de fonte e redimensionamento mudam a métrica:
    // remedimos para que nenhum valor "chutado" volte a aparecer.
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.refresh());
      this.resizeObserver.observe(textarea);
    }
    this.onWindowResize = () => this.refresh();
    window.addEventListener("resize", this.onWindowResize);
  }

  /**
   * B13: Ctrl+V atualiza os blocos IMEDIATAMENTE, na mesma interação.
   * paste -> capturar -> normalizar -> inserir -> histórico -> análise imediata
   */
  async handlePaste(event) {
    const clipboard = event.clipboardData?.getData("text");
    if (typeof clipboard !== "string" || !clipboard) return;
    event.preventDefault();

    const normalized = await this.onPasteNormalized(clipboard);
    const text = typeof normalized === "string" && normalized.length ? normalized : clipboard;

    const { selectionStart, selectionEnd, value } = this.textarea;
    this.textarea.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
    const caret = selectionStart + text.length;
    this.textarea.selectionStart = caret;
    this.textarea.selectionEnd = caret;

    this.refresh();
    // análise imediata, sem esperar debounce
    this.onInput(this.value, { immediate: true, pasted: true });
  }

  handleKey(event) {
    const textarea = this.textarea;

    // Autocomplete aberto: navegação
    if (this.completionOpen) {
      if (event.key === "ArrowDown") { event.preventDefault(); this.moveCompletion(1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); this.moveCompletion(-1); return; }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        this.acceptCompletion();
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); this.closeCompletions(); return; }
    }

    // Tab / Shift+Tab: indentar / desindentar (Parte 22.3)
    if (event.key === "Tab") {
      event.preventDefault();
      const hasSelection = textarea.selectionStart !== textarea.selectionEnd;
      const multiline = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).includes("\n");
      if (hasSelection && multiline) {
        const before = textarea.value;
        reindent(textarea, event.shiftKey ? -1 : 1);
        this.refresh();
        this.onInput(textarea.value, { immediate: false, reindent: true });
        return;
      }
      if (event.shiftKey) {
        reindent(textarea, -1);
      } else {
        insertAtCursor(textarea, "    ");
      }
      this.refresh();
      this.onInput(textarea.value, { immediate: false });
      return;
    }

    // Enter: indentação automática
    if (event.key === "Enter") {
      event.preventDefault();
      const { value, selectionStart, selectionEnd } = textarea;
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const currentLine = value.slice(lineStart, selectionStart);
      const indent = nextIndent(currentLine);

      // fecha parêntese/colchete mantendo o cursor dentro
      const openChar = currentLine.slice(-1);
      const closing = { "(": ")", "[": "]", "{": "}" }[openChar];
      if (closing && value[selectionStart] === closing) {
        const insertion = `\n${indent}\n${indent.slice(4) || ""}`;
        textarea.value = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
        const caret = selectionStart + 1 + indent.length;
        textarea.selectionStart = caret;
        textarea.selectionEnd = caret;
      } else {
        insertAtCursor(textarea, `\n${indent}`);
      }
      this.refresh();
      this.onInput(textarea.value, { immediate: false });
      return;
    }

    // Fechamento automático de pares
    if (PAIR_KEYS.has(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (handlePairKey(textarea, event.key)) {
        event.preventDefault();
        this.refresh();
        this.onInput(textarea.value, { immediate: false });
      }
    }

    // Ctrl+Espaço: força o autocomplete (atalho, não botão)
    if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
      event.preventDefault();
      this.openCompletions({ force: true });
    }
  }

  /* ------------------------------ autocomplete ------------------------------ */

  setScope(scope) { this.scope = scope ?? {}; }

  maybeOpenCompletions() {
    const context = completionContext(this.value, this.caret);
    if (context.kind === "member" || context.kind === "from" || context.kind === "import") {
      this.openCompletions();
      return;
    }
    if (context.prefix.length >= 2) { this.openCompletions(); return; }
    this.closeCompletions();
  }

  openCompletions({ force = false } = {}) {
    if (!this.popup) return;
    const context = completionContext(this.value, this.caret);
    if (!force && !context.prefix && context.kind === "word") { this.closeCompletions(); return; }

    this.completions = getCompletions(context, this.scope);
    if (!this.completions.length) { this.closeCompletions(); return; }

    this.completionIndex = 0;
    this.completionOpen = true;
    this.renderCompletions();
    const position = completionPosition(this.textarea, this.value, this.caret);
    this.popup.style.left = `${Math.min(position.left, Math.max(8, this.textarea.clientWidth - 268))}px`;
    this.popup.style.top = `${Math.min(position.top, Math.max(8, this.textarea.clientHeight - 120))}px`;
    this.popup.hidden = false;
  }

  renderCompletions() {
    if (!this.popup) return;
    const fragment = document.createDocumentFragment();
    this.completions.forEach((completion, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === this.completionIndex ? "active" : "";
      button.dataset.index = String(index);
      button.innerHTML = `<span class="ac-kind ac-${completion.kind}">${ICON_FOR[completion.kind] ?? "·"}</span>` +
        `<span class="ac-label">${escapeHtml(completion.label)}</span>` +
        `<small>${escapeHtml(completion.detail ?? "")}</small>`;
      if (completion.doc) button.title = completion.doc;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault(); // não rouba o foco do textarea
        this.completionIndex = index;
        this.acceptCompletion();
      });
      fragment.appendChild(button);
    });
    this.popup.replaceChildren(fragment);
    this.popup.setAttribute("aria-expanded", "true");
    this.popup.scrollTop = 0;
  }

  moveCompletion(delta) {
    if (!this.completions.length) return;
    this.completionIndex = (this.completionIndex + delta + this.completions.length) % this.completions.length;
    const buttons = this.popup?.querySelectorAll("button") ?? [];
    buttons.forEach((button, index) => button.classList.toggle("active", index === this.completionIndex));
    buttons[this.completionIndex]?.scrollIntoView({ block: "nearest" });
  }

  acceptCompletion() {
    const completion = this.completions[this.completionIndex];
    if (!completion) return;
    applyCompletion(this.textarea, completion);
    this.closeCompletions();
    this.refresh();
    sound.play("click");
    this.onInput(this.value, { immediate: true, completion: true });
  }

  closeCompletions() {
    this.completionOpen = false;
    this.completions = [];
    if (this.popup) { this.popup.hidden = true; this.popup.setAttribute("aria-expanded", "false"); }
  }

  /* ------------------------------ tooltip ------------------------------ */

  handleHover(event) {
    clearTimeout(this.tooltipTimer);
    this.tooltipTimer = setTimeout(() => {
      const position = caretFromMouse(this.textarea, event);
      if (position === null) { this.hideTooltip(); return; }
      const doc = documentationAt(this.value, position);
      const signature = signatureHelp(this.value, position);
      if (!doc && !signature) { this.hideTooltip(); return; }
      this.showTooltip(event.clientX, event.clientY, doc, signature);
    }, 320);
  }

  showTooltip(x, y, doc, signature) {
    let tooltip = document.getElementById("editorTooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "editorTooltip";
      tooltip.className = "editor-tooltip";
      tooltip.setAttribute("role", "tooltip");
      document.body.appendChild(tooltip);
    }
    const title = doc?.title ?? signature?.name ?? "";
    const lines = [
      title ? `<strong>${escapeHtml(title)}</strong>` : "",
      signature?.signature ? `<code>${escapeHtml(signature.signature)}</code>` : "",
      doc?.signature && !signature ? `<code>${escapeHtml(doc.signature)}</code>` : "",
      doc?.doc ? `<p>${escapeHtml(doc.doc)}</p>` : "",
      signature?.params?.length
        ? `<p class="ac-hint">parâmetro ${signature.activeParameter + 1} de ${signature.params.length}: <b>${escapeHtml(signature.params[Math.min(signature.activeParameter, signature.params.length - 1)] ?? "")}</b></p>`
        : "",
    ].filter(Boolean);

    tooltip.innerHTML = lines.join("");
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(x + 12, window.innerWidth - 320)}px`;
    tooltip.style.top = `${Math.min(y + 16, window.innerHeight - 120)}px`;
  }

  hideTooltip() {
    document.getElementById("editorTooltip")?.setAttribute("hidden", "");
  }

  /* ------------------------------ refresh ------------------------------ */

  /** Redesenha régua + realce. Chamado a cada entrada e a cada rolagem. */
  refresh() {
    if (!this.textarea) return;
    this.measure();
    const code = this.value;
    const lines = code.split("\n");
    const position = cursorPosition(code, this.caret);

    // RÉGUA: um <div class="ln"> por linha, dentro de uma trilha que desliza
    if (this.gutter) {
      const errorLines = this.diagnostics.filter((d) => d.severity === "error").map((d) => d.line);
      const track = renderLineNumbers(lines.length, position.line, errorLines);
      const previous = lineTrack(this.gutter);
      // Só reconstrói quando a quantidade de linhas ou a linha ativa mudam:
      // evita reflow desnecessário a cada tecla.
      if (!previous || previous.childElementCount !== lines.length ||
          previous.querySelector(".ln-active")?.dataset.line !== String(position.line) ||
          [...previous.children].some((node, index) => node.classList.contains("ln-error") !== errorLines.includes(index + 1))) {
        this.gutter.replaceChildren(track);
      }
      syncScroll(this.textarea, this.gutter, this.highlight);
    }

    // Realce com sublinhado de erro (Parte 15.4)
    if (this.highlight) {
      this.highlight.innerHTML = highlightCode(code, this.diagnostics, position.line);
      this.highlight.scrollTop = this.textarea.scrollTop;
      this.highlight.scrollLeft = this.textarea.scrollLeft;
    }

    // Régua lateral de diagnósticos (marcador discreto — Parte 14.4)
    if (this.ruler) this.renderRuler(lines.length);

    if (this.statusBar) {
      this.statusBar.textContent = `Ln ${position.line}, Col ${position.column}`;
    }
  }

  renderRuler(totalLines) {
    const marks = new Map();
    for (const diagnostic of this.diagnostics) {
      const severity = diagnostic.severity === "error" ? "error" : "warn";
      if (!marks.has(diagnostic.line) || severity === "error") marks.set(diagnostic.line, severity);
    }
    for (const entry of this.pythonOnly ?? []) marks.set(entry.line, "python");

    const metrics = editorMetrics();
    const fragment = document.createDocumentFragment();
    for (const [line, severity] of marks.entries()) {
      if (line < 1 || line > totalLines) continue;
      const mark = document.createElement("i");
      mark.className = `ruler-mark ruler-${severity}`;
      mark.style.top = `${metrics.paddingTop + (line - 1) * metrics.lineHeight}px`;
      mark.title = severity === "python"
        ? "Linha somente em Python — o bloco Código Python a preserva intacta"
        : `Linha ${line}: ${this.diagnostics.find((d) => d.line === line)?.cause ?? "problema"}`;
      fragment.appendChild(mark);
    }
    this.ruler.replaceChildren(fragment);
    const track = this.ruler.querySelector(".ruler-track") ?? this.ruler;
    track.style.transform = `translateY(${-this.textarea.scrollTop}px)`;
  }

  setDiagnostics(diagnostics, pythonOnly = []) {
    this.diagnostics = diagnostics ?? [];
    this.pythonOnly = pythonOnly ?? [];
    this.refresh();
  }
}

const ICON_FOR = {
  module: "▣", class: "◈", method: "ƒ", function: "ƒ",
  property: "◧", constant: "≡", keyword: "⌘", variable: "𝑥", snippet: "⌗",
};

function insertAtCursor(textarea, text) {
  const { value, selectionStart, selectionEnd } = textarea;
  textarea.value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
  const caret = selectionStart + text.length;
  textarea.selectionStart = caret;
  textarea.selectionEnd = caret;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** Aproxima a posição do caret a partir do mouse (apenas para o tooltip). */
function caretFromMouse(textarea, event) {
  const { line, column } = pointToCaret(textarea, event.clientX, event.clientY);
  const lines = textarea.value.split("\n");
  if (line > lines.length) return null;
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) offset += lines[index].length + 1;
  return Math.min(offset + column - 1, textarea.value.length);
}

export default EditorView;

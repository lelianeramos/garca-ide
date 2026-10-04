/**
 * HISTÓRICO UNIFICADO — B15
 * -------------------------
 * Parte 22.3: até 150 estados cobrindo EDITOR E BLOCOS no mesmo histórico.
 * Ctrl+Z desfaz; Ctrl+Y / Ctrl+Shift+Z refaz.
 *
 * Toda a correção automática ao colar entra como UMA única entrada (Parte 16.3),
 * então Ctrl+Z desfaz tudo de uma vez (T42).
 */

export const HISTORY_LIMIT = 150;

export class History {
  constructor(limit = HISTORY_LIMIT) {
    this.limit = limit;
    this.entries = [];
    this.index = -1;
    this.locked = false;
    this.onChange = () => {};
  }

  /**
   * Registra um estado.
   * @param {object} state { fileId, code, caret, label }
   */
  push(state, { coalesceKey = null } = {}) {
    if (this.locked) return;
    const current = this.entries[this.index];

    // Mesmo arquivo + mesma tecla em sequência -> agrupa (evita 1 estado por caractere)
    if (current && coalesceKey && current.coalesceKey === coalesceKey &&
        current.fileId === state.fileId && Date.now() - (current.at ?? 0) < 700) {
      this.entries[this.index] = { ...current, state: state.code, caret: state.caret, at: Date.now() };
      this.trim();
      this.onChange();
      return;
    }

    if (current && current.state === state.code) return;

    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({
      fileId: state.fileId,
      state: state.code,
      caret: state.caret ?? null,
      label: state.label ?? "",
      coalesceKey,
      at: Date.now(),
    });
    this.index = this.entries.length - 1;
    this.trim();
    this.onChange();
  }

  trim() {
    if (this.entries.length > this.limit) {
      const excess = this.entries.length - this.limit;
      this.entries = this.entries.slice(excess);
      this.index = Math.max(0, this.index - excess);
    }
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }

  undo() {
    if (!this.canUndo) return null;
    this.index -= 1;
    const entry = this.entries[this.index];
    this.onChange();
    return { fileId: entry.fileId, code: entry.state, caret: entry.caret, label: entry.label };
  }

  redo() {
    if (!this.canRedo) return null;
    this.index += 1;
    const entry = this.entries[this.index];
    this.onChange();
    return { fileId: entry.fileId, code: entry.state, caret: entry.caret, label: entry.label };
  }

  /** Trocou de arquivo: garante que o estado atual dele esteja no histórico. */
  touch(fileId, code, caret) {
    const current = this.entries[this.index];
    if (current && current.fileId === fileId && current.state === code) return;
    this.push({ fileId, code, caret, label: "troca de arquivo" });
  }

  clear() {
    this.entries = [];
    this.index = -1;
    this.onChange();
  }

  /** Executa `fn` sem gravar histórico (usado ao aplicar undo/redo). */
  transaction(fn) {
    this.locked = true;
    try { return fn(); } finally { this.locked = false; }
  }
}

export default History;

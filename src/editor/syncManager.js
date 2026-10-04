/**
 * SYNC MANAGER — sincronização bidirecional Blocos <-> Python
 * -----------------------------------------------------------
 * Parte 14. A IR é a fonte da verdade (Parte 3.3): não é o HTML, não é o
 * texto puro do editor.
 *
 *   Editar o Python -> reparse -> nova IR -> reconcilia blocos
 *   Editar um bloco -> altera a IR -> gera patch -> aplica no Python -> reparse
 *
 * B01: enquanto o Python estiver inválido, congela a última IR válida e mantém
 *      os blocos renderizados. Nunca escreve null.
 * B02: dispara em input/paste/cut/drop/Backspace/undo/redo — nunca só no blur.
 * B13: no paste, o pipeline roda IMEDIATO, sem esperar debounce.
 * B14: erro numa linha não quebra a conversão inteira.
 */

import { parseProgram } from "../parser/pythonParser.js";
import { irToBlocks, reconcileBlocks, expressionToBlock } from "../blocks/blockFactory.js";
import { extractSymbols, analyzeProject, librarySymbols, IMPORT_STATE } from "../semantic/analyzer.js";
import { patchBlock, removeBlock, insertBlock, ensureImports } from "../python/codeGenerator.js";
import { explain, suggestName, extractUnknownName } from "../diagnostics/errorParser.js";
import { KNOWN_NAMES, tail as apiTail } from "../pybricks/apiRegistry.js";

export const SYNC_STATE = {
  SYNCED: "synced",
  UPDATING: "updating",
  PARTIAL: "partial",
  ERROR: "error",
};

export const SYNC_LABEL = {
  synced: "Blocos + Python sincronizados",
  updating: "Atualizando…",
  partial: "Parcial",
  error: "Erro na linha",
};

export const DEBOUNCE_MS = 220; // dentro da faixa 150–350 ms da Parte 1.5/B01

export class SyncManager {
  constructor({ onChange, debounce = DEBOUNCE_MS } = {}) {
    this.onChange = onChange ?? (() => {});
    this.debounce = debounce;

    /** Última IR válida conhecida — B01: nunca é descartada por erro. */
    this.lastValid = { blocks: [], ir: null, symbols: null };
    this.blocks = [];
    this.diagnostics = [];
    this.pythonOnly = [];
    this.state = SYNC_STATE.SYNCED;
    this.code = "";
    this.timer = null;
    this.suppress = false;
    this.userFunctions = [];
    this.libraryFunctions = [];
  }

  /* ------------------------- Python -> Blocos ------------------------- */

  /**
   * Agenda a análise (digitação). Use `immediate=true` para paste (B13).
   */
  schedule(code, { immediate = false } = {}) {
    this.code = code;
    if (immediate) {
      clearTimeout(this.timer);
      this.runPipeline(code);
      return;
    }
    this.setState(SYNC_STATE.UPDATING);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.runPipeline(code), this.debounce);
  }

  /** Executa o pipeline completo sem debounce. */
  runPipeline(code) {
    this.code = code;
    const parsed = parseProgram(code);

    // Símbolos do arquivo (funções do usuário alimentam "Meus blocos")
    const symbols = extractSymbols(parsed.ir);
    this.userFunctions = symbols.functions;

    // Diagnósticos traduzidos para pt-BR (Anexo B)
    const candidates = [...KNOWN_NAMES].map(apiTail);
    this.diagnostics = parsed.diagnostics.map((diagnostic) => {
      const explained = explain(diagnostic);
      const unknown = extractUnknownName(diagnostic.message);
      if (unknown) explained.similar = suggestName(unknown, candidates);
      return explained;
    });

    if (parsed.flat.length === 0 && this.diagnostics.length > 0) {
      // Nada pôde ser recuperado — B01: mantém a última IR válida na tela
      this.setState(SYNC_STATE.ERROR);
      this.emit({ blocks: this.lastValid.blocks, keepBlocks: true });
      return;
    }

    const converted = irToBlocks(parsed.ir, {
      userFunctions: symbols.functions,
      libraryFunctions: this.libraryFunctions,
    });

    // B06: reconcilia em vez de recriar — preserva id, posição, seleção
    const nextBlocks = reconcileBlocks(this.blocks, converted.blocks);

    if (this.diagnostics.length === 0) {
      this.lastValid = { blocks: nextBlocks, ir: parsed.ir, symbols };
    }

    this.blocks = nextBlocks;
    this.pythonOnly = converted.pythonOnly;
    this.representedLines = converted.representedLines;
    this.symbols = symbols;
    this.ir = parsed.ir;

    if (this.diagnostics.length > 0) this.setState(SYNC_STATE.ERROR);
    else if (this.pythonOnly.length > 0) this.setState(SYNC_STATE.PARTIAL);
    else this.setState(SYNC_STATE.SYNCED);

    this.emit({ blocks: nextBlocks });
  }

  setState(state) {
    this.state = state;
  }

  /** Rótulo do indicador (Parte 14.2). */
  get stateLabel() {
    if (this.state === SYNC_STATE.PARTIAL) {
      const count = this.pythonOnly.length;
      return `${SYNC_LABEL.partial} — ${count} linha${count === 1 ? "" : "s"} somente Python`;
    }
    if (this.state === SYNC_STATE.ERROR) {
      const first = this.diagnostics[0];
      return first ? `${SYNC_LABEL.error} ${first.line}` : SYNC_LABEL.error;
    }
    return SYNC_LABEL[this.state];
  }

  emit(payload) {
    this.onChange({
      state: this.state,
      label: this.stateLabel,
      blocks: this.blocks,
      diagnostics: this.diagnostics,
      pythonOnly: this.pythonOnly,
      symbols: this.symbols,
      code: this.code,
      ...payload,
    });
  }

  /* ------------------------- Blocos -> Python ------------------------- */

  /**
   * Editou um parâmetro do bloco -> patch cirúrgico no Python (Parte 13.4).
   * Usa o SPAN do nó; nunca find/replace cego (N07).
   */
  applyBlockEdit(block) {
    const result = patchBlock(this.code, block);
    if (!result.changed) return { code: this.code, changed: false };
    this.suppress = true;
    this.code = result.code;
    // reparse -> confirma (Parte 3.3)
    this.runPipeline(result.code);
    this.suppress = false;
    return { code: result.code, changed: true };
  }

  /** Backspace/Delete no canvas (B07). */
  removeBlockFromCode(block) {
    const result = removeBlock(this.code, block);
    this.code = result.code;
    this.runPipeline(result.code);
    return result;
  }

  /** Arrastou um bloco da biblioteca para o canvas. */
  insertBlockIntoCode(block, afterLine = null) {
    let code = this.code;
    const inserted = insertBlock(code, block, afterLine);
    code = inserted.code;
    // B08: só ACRESCENTA o import que falta, e avisa
    const withImports = ensureImports(code, [block]);
    this.code = withImports.code;
    this.runPipeline(withImports.code);
    return { code: this.code, addedImports: withImports.added };
  }

  /** Regenera os imports exigidos pelos blocos atuais. */
  syncImports() {
    const result = ensureImports(this.code, this.blocks);
    if (!result.added.length) return result;
    this.code = result.code;
    this.runPipeline(result.code);
    return result;
  }

  /* ------------------------- Código <-> Bloco ------------------------- */

  /** Parte 14.6: bloco sob o cursor do editor. */
  blockAtLine(line) {
    const search = (list) => {
      for (const block of list || []) {
        const start = block.source?.startLine ?? 0;
        const end = block.source?.endLine ?? start;
        if (line >= start && line <= end) return block;
        const nested = search(block.children) ?? search(block.elseChildren);
        if (nested) return nested;
      }
      return null;
    };
    return search(this.blocks);
  }

  /** Parte 14.6: seleção no editor correspondente a um bloco. */
  selectionForBlock(block, code) {
    if (!block?.source) return null;
    const lines = String(code).split("\n");
    const startLine = block.source.startLine;
    const endLine = block.source.endLine ?? startLine;
    const start = lines.slice(0, startLine - 1).reduce((sum, line) => sum + line.length + 1, 0);
    const end = lines.slice(0, endLine).reduce((sum, line) => sum + line.length + 1, 0) - 1;
    return { start: Math.max(0, start), end: Math.max(start, end) };
  }

  /** Converte uma expressão solta em bloco repórter (campo booleano/valor). */
  expressionBlock(expression) {
    const parsed = parseProgram(String(expression ?? "").trim());
    const statement = parsed.flat?.[0];
    const node = statement?.type === "expressionStatement" ? statement.expression : statement;
    return expressionToBlock(node);
  }

  /* ------------------------- Projeto / VFS ------------------------- */

  /** Atualiza as funções vindas dos módulos internos (categoria Bibliotecas). */
  setLibraryFiles(files) {
    this.libraryFunctions = librarySymbols(files);
    this.projectAnalysis = analyzeProject(files);
    return this.projectAnalysis;
  }

  /** Imports quebrados do projeto inteiro (B23). */
  get brokenImports() {
    return (this.projectAnalysis?.imports ?? []).filter(
      (entry) => entry.state === IMPORT_STATE.MODULE_NOT_FOUND ||
                 entry.state === IMPORT_STATE.SYMBOL_NOT_FOUND ||
                 entry.state === IMPORT_STATE.AMBIGUOUS,
    );
  }
}

export default SyncManager;

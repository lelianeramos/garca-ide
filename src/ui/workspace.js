/**
 * WORKSPACE — canvas infinito de blocos (B10)
 * -------------------------------------------
 * SINTOMA ANTIGO: área de blocos presa a uma div com overflow-y:auto, rolagem
 * vertical desconfortável, sem conseguir navegar livremente.
 *
 * CORREÇÃO:
 *   - canvas infinito com transform: translate() scale() num "mundo" interno
 *   - botão direito + arrastar = pan livre (menu nativo suprimido no fundo)
 *   - RODA DO MOUSE = pan vertical (sem barra de rolagem)
 *   - Shift + roda = pan horizontal
 *   - Ctrl/Cmd + roda = zoom no cursor
 *   - botão do meio + arrastar = pan alternativo
 *   - posição e zoom persistidos por saída
 *
 * ACEITE (T29): com 40 blocos é possível navegar por toda a área só com o
 * mouse, sem barra de rolagem.
 */

import { renderStack, renderBlock } from "../blocks/blockRenderer.js";
import { BLOCK_BY_ID } from "../blocks/blockCatalog.js";
import { sound } from "./sound.js";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.2;

export class Workspace {
  constructor({ element, world, stack, onBlockChange, onSelect, onDropBlock, onContextMenu, onRemove }) {
    this.element = element;
    this.world = world;
    this.stack = stack;
    this.onBlockChange = onBlockChange ?? (() => {});
    this.onSelect = onSelect ?? (() => {});
    this.onDropBlock = onDropBlock ?? (() => {});
    this.onContextMenu = onContextMenu ?? (() => {});
    this.onRemove = onRemove ?? (() => {});

    this.blocks = [];
    this.selectedId = null;
    this.view = { panX: 24, panY: 18, zoom: 1 };
    this.dragging = null;
    this.panning = null;
    this.fieldEditing = null;

    this.bind();
    this.applyView();
  }

  /* ------------------------------ visão ------------------------------ */

  setView(view) {
    this.view = { ...this.view, ...(view ?? {}) };
    this.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.zoom));
    this.applyView();
  }

  applyView() {
    if (!this.world) return;
    const { panX, panY, zoom } = this.view;
    this.world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    this.world.style.transformOrigin = "0 0";
  }

  zoomBy(delta, anchor) {
    const before = this.view.zoom;
    const after = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * (1 + delta)));
    if (after === before) return;
    // zoom no cursor: mantém o ponto sob o ponteiro fixo
    const point = anchor ?? { x: this.element.clientWidth / 2, y: this.element.clientHeight / 2 };
    const ratio = after / before;
    this.view.panX = point.x - (point.x - this.view.panX) * ratio;
    this.view.panY = point.y - (point.y - this.view.panY) * ratio;
    this.view.zoom = after;
    this.applyView();
  }

  fitToContent() {
    if (!this.stack || !this.stack.children.length) { this.setView({ panX: 24, panY: 18, zoom: 1 }); return; }
    const bounds = this.stack.getBoundingClientRect();
    const host = this.element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const zoom = Math.max(MIN_ZOOM, Math.min(1, Math.min(
      (host.width - 48) / (bounds.width / this.view.zoom),
      (host.height - 48) / (bounds.height / this.view.zoom),
    )));
    this.view.zoom = zoom;
    this.applyView();
    const scaled = this.stack.getBoundingClientRect();
    this.view.panX = (host.width - scaled.width) / 2;
    this.view.panY = 18;
    this.applyView();
  }

  center() {
    this.setView({ panX: 24, panY: 18 });
  }

  /* ------------------------------ eventos ------------------------------ */

  bind() {
    const element = this.element;
    if (!element) return;

    // B10: roda = pan vertical; Ctrl+roda = zoom no cursor. Sem barra de rolagem.
    element.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        this.zoomBy(-Math.sign(event.deltaY) * 0.12, { x: event.clientX - rect.left, y: event.clientY - rect.top });
        return;
      }
      const factor = event.deltaMode === 1 ? 16 : 1;
      this.view.panY -= event.deltaY * factor;
      this.view.panX -= (event.shiftKey ? event.deltaY : event.deltaX) * factor;
      this.applyView();
    }, { passive: false });

    // Menu nativo suprimido no fundo do canvas (G07/B10)
    element.addEventListener("contextmenu", (event) => {
      const block = event.target.closest(".program-block");
      event.preventDefault();
      if (block) {
        this.select(block.dataset.blockId);
        this.onContextMenu(event, { kind: "block", blockId: block.dataset.blockId });
        return;
      }
      this.onContextMenu(event, { kind: "canvas" });
    });

    element.addEventListener("pointerdown", (event) => {
      element.focus({ preventScroll: true });

      const field = event.target.closest(".gb-field, .gb-slider");
      if (field) return; // editando um parâmetro: não arrasta nem seleciona

      const expandButton = event.target.closest('[data-act="expand"]');
      if (expandButton) {
        event.stopPropagation();
        this.toggleExpand(expandButton.closest(".program-block")?.dataset.blockId);
        return;
      }

      const block = event.target.closest(".program-block");

      // Pan: botão direito (2) ou botão do meio (1)
      if (event.button === 2 || event.button === 1) {
        event.preventDefault();
        this.panning = { x: event.clientX, y: event.clientY, panX: this.view.panX, panY: this.view.panY };
        element.classList.add("panning");
        element.setPointerCapture?.(event.pointerId);
        return;
      }

      if (!block) {
        this.select(null);
        return;
      }

      this.select(block.dataset.blockId);
      this.dragging = {
        blockId: block.dataset.blockId,
        element: block,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      block.setPointerCapture?.(event.pointerId);
    });

    element.addEventListener("pointermove", (event) => {
      if (this.panning) {
        this.view.panX = this.panning.panX + (event.clientX - this.panning.x);
        this.view.panY = this.panning.panY + (event.clientY - this.panning.y);
        this.applyView();
        return;
      }
      if (this.dragging) {
        const dx = event.clientX - this.dragging.startX;
        const dy = event.clientY - this.dragging.startY;
        if (!this.dragging.moved && Math.hypot(dx, dy) < 4) return;
        this.dragging.moved = true;
        this.dragging.element.classList.add("dragging");
        this.dragging.element.style.transform = `translate(${dx / this.view.zoom}px, ${dy / this.view.zoom}px)`;
      }
    });

    const endPointer = (event) => {
      if (this.panning) {
        this.panning = null;
        element.classList.remove("panning");
      }
      if (this.dragging) {
        const { moved, element: dragged } = this.dragging;
        dragged.classList.remove("dragging");
        dragged.style.transform = "";
        if (moved) this.onDropBlock(this.dragging.blockId, event);
        this.dragging = null;
      }
    };
    element.addEventListener("pointerup", endPointer);
    element.addEventListener("pointercancel", endPointer);

    // B12: edição de parâmetros — change aplica patch imediato
    element.addEventListener("input", (event) => this.handleField(event, false));
    element.addEventListener("change", (event) => this.handleField(event, true));

    // slider -> sincroniza o campo numérico ao lado
    element.addEventListener("input", (event) => {
      const slider = event.target.closest(".gb-slider");
      if (!slider) return;
      const block = slider.closest(".program-block");
      const field = block?.querySelector(`[data-field="${slider.dataset.sliderFor}"]`);
      if (field) field.value = slider.value;
    });

    // B07: Backspace/Delete removem o bloco selecionado e os filhos
    element.addEventListener("keydown", (event) => {
      if (event.target.closest(".gb-field")) return; // não interfere na digitação
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!this.selectedId) return;
        event.preventDefault();
        this.onRemove(this.selectedId);
        return;
      }
      if (event.key === "Escape") { this.select(null); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        this.onContextMenu(event, { kind: "duplicate", blockId: this.selectedId });
      }
    });

    // Drop vindo da paleta
    element.addEventListener("dragover", (event) => { event.preventDefault(); element.classList.add("drop-target"); });
    element.addEventListener("dragleave", () => element.classList.remove("drop-target"));
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      element.classList.remove("drop-target");
      const schema = event.dataTransfer?.getData("text/garca-block") || event.dataTransfer?.getData("text/plain");
      if (!schema || !BLOCK_BY_ID.has(schema)) return;
      this.onDropBlock(schema, event, { fromPalette: true });
    });
  }

  toggleExpand(blockId) {
    const block = this.find(blockId);
    if (!block) return;
    block.expanded = !block.expanded;
    this.render(this.blocks, { preserveSelection: true });
  }

  handleField(event, commit) {
    const field = event.target.closest(".gb-field");
    if (!field) return;
    const element = field.closest(".program-block");
    if (!element) return;

    const block = this.find(element.dataset.blockId);
    if (!block) return;

    const name = field.dataset.field;
    const spec = BLOCK_BY_ID.get(block.blockId);
    const paramSpec = spec?.params?.[name] ?? spec?.advanced?.[name];

    // Nunca grava null (B01/N02)
    let value;
    if (field.type === "checkbox") value = field.checked;
    else if (paramSpec?.type === "number") {
      const text = String(field.value ?? "").trim();
      if (text === "" || text === ",") return; // mantém o que o usuário digitou (13.6)
      const parsed = Number(text.replace(",", "."));
      if (!Number.isFinite(parsed)) {
        field.classList.add("gb-invalid");
        field.title = "Digite um número. Exemplo: 75,5";
        return;
      }
      field.classList.remove("gb-invalid");
      if (paramSpec.min !== undefined && parsed < paramSpec.min) {
        field.classList.add("gb-out-of-range");
        field.title = `Valor entre ${paramSpec.min} e ${paramSpec.max}${paramSpec.unit ? ` ${paramSpec.unit}` : ""}`;
        value = parsed; // 13.6: avisa, mas NÃO apaga o que foi digitado
      } else if (paramSpec.max !== undefined && parsed > paramSpec.max) {
        field.classList.add("gb-out-of-range");
        field.title = `Valor entre ${paramSpec.min} e ${paramSpec.max}${paramSpec.unit ? ` ${paramSpec.unit}` : ""}`;
        value = parsed;
      } else {
        field.classList.remove("gb-out-of-range");
        value = parsed;
      }
    } else value = field.value;

    block.params[name] = value;

    // slider espelha o campo
    const slider = element.querySelector(`[data-slider-for="${name}"]`);
    if (slider && typeof value === "number") slider.value = String(value);

    if (commit) {
      sound.play("click");
      this.onBlockChange(block, { commit: true });
    } else {
      this.onBlockChange(block, { commit: false });
    }
  }

  /* ------------------------------ seleção ------------------------------ */

  find(blockId) {
    const search = (list) => {
      for (const block of list || []) {
        if (block.id === blockId) return block;
        const found = search(block.children) ?? search(block.elseChildren);
        if (found) return found;
      }
      return null;
    };
    return search(this.blocks);
  }

  select(blockId) {
    if (this.selectedId === blockId) return;
    this.selectedId = blockId ?? null;
    this.element?.querySelectorAll(".program-block.selected").forEach((node) => node.classList.remove("selected"));
    if (blockId) this.element?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.classList.add("selected");
    this.onSelect(this.find(blockId));
  }

  clearSelection() { this.select(null); }

  /* ------------------------------ render ------------------------------ */

  render(blocks, { preserveSelection = false } = {}) {
    this.blocks = blocks ?? [];
    if (!this.stack) return;

    if (!this.blocks.length) {
      this.stack.innerHTML = "";
      this.stack.appendChild(emptyState());
      return;
    }

    renderStack(this.blocks, this.stack, {});
    if (preserveSelection && this.selectedId) {
      this.element?.querySelector(`[data-block-id="${CSS.escape(this.selectedId)}"]`)?.classList.add("selected");
    }
  }

  /** Parte 14.6: destaca o bloco correspondente à linha do cursor. */
  highlightLine(line) {
    if (!this.element) return;
    this.element.querySelectorAll(".program-block.cursor-match").forEach((node) => node.classList.remove("cursor-match"));
    if (!line) return;
    const target = this.element.querySelector(`.program-block[data-line="${line}"]`);
    target?.classList.add("cursor-match");
  }

  /** Rola o canvas até um bloco (Parte 14.6). */
  scrollToBlock(blockId) {
    const node = this.element?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
    if (!node || !this.element) return;
    const host = this.element.getBoundingClientRect();
    const target = node.getBoundingClientRect();
    this.view.panX += host.width / 2 - (target.left - host.left) - target.width / 2;
    this.view.panY += host.height / 2 - (target.top - host.top) - target.height / 2;
    this.applyView();
    node.classList.add("pulse");
    setTimeout(() => node.classList.remove("pulse"), 700);
  }
}

/** Canvas vazio com 3 atalhos (B16). */
function emptyState() {
  const wrapper = document.createElement("div");
  wrapper.className = "workspace-empty";
  wrapper.innerHTML = `
    <div class="empty-illustration" aria-hidden="true">
      <svg viewBox="0 0 120 88" width="120" height="88" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="14" y="10" width="44" height="22" rx="5" opacity=".55"/>
        <rect x="14" y="38" width="62" height="22" rx="5" opacity=".8"/>
        <rect x="26" y="66" width="38" height="16" rx="5" opacity=".4"/>
        <path d="M30 10V6h12v4M30 38v-4h12v4" opacity=".5"/>
      </svg>
    </div>
    <strong>Nenhum bloco nesta saída</strong>
    <p>Comece de três formas:</p>
    <ul>
      <li>${iconBullet()} <b>Arrastar um bloco</b> da biblioteca para cá</li>
      <li>${iconBullet()} <b>Escrever Python</b> no editor — os blocos aparecem sozinhos</li>
      <li>${iconBullet()} <b>Importar arquivo</b> .py no explorador do projeto</li>
    </ul>
  `;
  return wrapper;
}

const iconBullet = () => `<svg class="ui-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m5 12 4 4L19 6"/></svg>`;

export default Workspace;

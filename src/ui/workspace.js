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

import { renderStack, clearStack, renderBlock } from "../blocks/blockRenderer.js";
import { parseTextExpression } from "../blocks/blockFactory.js";
import { promoteTextToBlock } from "../blocks/socket.js";
import { BLOCK_BY_ID } from "../blocks/blockCatalog.js";
import { verifyLayout, describeLayout } from "./layoutGuard.js";
import { sound } from "./sound.js";
import { converterValorDeUnidade } from "../semantic/units.js";

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

    /*
     * Drop vindo da paleta.
     *
     * A posição importa: soltar DENTRO do encaixe de um bloco em C (ou do
     * chapéu "quando o programa iniciar") coloca o bloco como filho dele.
     * Soltar no fim da pilha solta no fim do programa. Sem isso o usuário
     * não conseguia montar um programa: o bloco caía sempre no fim do
     * arquivo, fora de qualquer `def`.
     */
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.markDropTarget(event.target);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    element.addEventListener("dragleave", (event) => {
      if (element.contains(event.relatedTarget)) return;
      this.clearDropTarget();
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      const target = this.markDropTarget(event.target);
      this.clearDropTarget();
      const schema = event.dataTransfer?.getData("text/garca-block") || event.dataTransfer?.getData("text/plain");
      if (!schema || !BLOCK_BY_ID.has(schema)) return;
      this.onDropBlock(schema, event, { fromPalette: true, ...(target ?? {}) });
    });
  }

  /**
   * Decide o destino de um arrasto: dentro de um encaixe ou no fim da pilha.
   * Devolve `{ parentId }` quando caiu num encaixe, `{}` quando caiu no vazio.
   */
  markDropTarget(node) {
    this.clearDropTarget();
    const cavity = node?.closest?.(".gb-cavity[data-slot='children']");
    if (!cavity) {
      this.element.classList.add("drop-target");
      return {};
    }
    cavity.classList.add("drop-active");
    return { parentId: cavity.dataset.block };
  }

  clearDropTarget() {
    this.element.classList.remove("drop-target");
    for (const node of this.element.querySelectorAll(".drop-active")) node.classList.remove("drop-active");
  }

  /*
   * EXPANDIR / RETRAIR É SÓ VISUAL (item 13).
   *
   * Este é o bug do "código cresce sozinho". Expandir um bloco mudava um
   * campo do objeto do bloco; se qualquer coisa no caminho chamasse
   * `onBlockChange`, o `patchBlock` reescrevia a linha INTEIRA a partir do
   * bloco — e como o bloco serializado era mais verboso que a linha
   * original, cada toque na seta acrescentava texto. Repetir era o
   * suficiente para o arquivo crescer sem parar.
   *
   * A correção é declarar a intenção, não tentar detectar o efeito depois:
   * `uiOnly: true` viaja junto com a mudança e o sincronizador recusa
   * qualquer alteração de código vinda dela. Não existe caminho em que
   * expandir escreva Python, porque o caminho nem chega no Python.
   */
  toggleExpand(blockId) {
    const block = this.find(blockId);
    if (!block) return;
    block.expanded = !block.expanded;
    this.render(this.blocks, { preserveSelection: true });
    // Registrado para o histórico de UI e para depuração; NÃO altera código.
    this.onBlockChange(block, { uiOnly: true, commit: false });
  }


  /*
   * CONTROLES SEMÂNTICOS: direção e unidade.
   *
   * Os dois NÃO usam `data-field` de propósito. A direção não é um valor
   * do campo — é o SINAL dele, e o valor continua sendo o módulo. Se os
   * dois usassem o mesmo atributo, editar o número e escolher a direção
   * escreveriam no mesmo lugar, e um sobrescreveria o outro.
   *
   * Por isso o caminho é separado ANTES do `handleField` genérico, que
   * assumiria que todo `.gb-field` tem `data-field`.
   */
  handleSemanticControl(event, commit) {
    const alvo = event.target;

    const direcao = alvo.closest?.("[data-direction-for]");
    const unidade = alvo.closest?.("[data-unit-for]");
    if (!direcao && !unidade) return false;

    const element = (direcao ?? unidade).closest(".program-block");
    if (!element) return true;

    const block = this.find(element.dataset.blockId);
    if (!block) return true;

    const caminho = (direcao ?? unidade).dataset[direcao ? "directionFor" : "unitFor"];
    const campos = block.params?.fields;
    if (!Array.isArray(campos)) return true;

    const indice = Number(String(caminho ?? "").match(/fields\.(\d+)\.?/)?.[1]);
    const campo = campos[indice];
    if (!campo) return true;

    if (direcao) {
      const opcao = [...direcao.options].find((o) => o.value === direcao.value);
      campo.direction = direcao.value;
      /*
       * O sinal vem da opção escolhida. Guardar `-1`/`1` separado do texto
       * é o que permite trocar a direção sem reescrever o número, e o que
       * faz `gb_move(gb, hub, -100)` virar "para trás 100" de verdade.
       */
      const sinal = opcao?.getAttribute?.("data-sign");
      if (sinal !== null && sinal !== undefined) campo.sign = Number(sinal);
    } else {
      /*
       * A conversão acontece ANTES de atualizar `unitKey`.
       *
       * A ordem importa e é sutil: `converterValorDeUnidade` compara a
       * unidade ATUAL com a NOVA para saber o fator. Trocar `unitKey`
       * primeiro as deixava iguais, a função retornava `null`, e o valor
       * ficava 300 — a tela dizendo "300 cm/s" enquanto o robô recebia
       * 300 mm/s.
       */
      const convertido = converterValorDeUnidade(campo, unidade.value);

      /*
       * VALOR E UNIDADE SÃO UM SÓ DADO.
       *
       * Se o valor não pode ser convertido — porque é uma expressão
       * (`d * 2`) ou um bloco encaixado — a unidade NÃO muda. Registrar
       * "cm/s" ao lado de um `literal 300` que significa 300 mm/s faria o
       * gerador converter na saída e mandar 3000 mm/s: o número na tela e
       * o número no robô deixam de ser o mesmo, e nada denuncia.
       *
       * Devolver o valor intacto é a escolha honesta; a criança continua
       * vendo a medida em mm/s, que é a que vale.
       */
      if (convertido === null) {
        /*
         * Devolve a seleção do `<select>` ao valor antigo, para a tela e o
         * estado concordarem. Sem isso, o dropdown mostra "cm/s" enquanto o
         * campo continua em mm/s — e a criança não tem como saber que a
         * escolha não pegou.
         */
        const anterior = campo.unitKey;
        for (const opcao of unidade.options) {
          /*
           * Desmarcar pelo atributo, e não por `selected = false`.
           *
           * Atribuir `false` não limpa a marcação em todo DOM (o linkedom
           * mantém os dois `<option>` marcados e o `select.value` fica
           * `undefined`), e aí o dropdown mostraría uma unidade que não
           * é a do campo — a criança veria "cm/s" num valor medido em
           * mm/s, que é o oposto de avisar que a escolha não pegou.
           */
          if (opcao.value === anterior) opcao.setAttribute("selected", "");
          else opcao.removeAttribute("selected");
        }
      } else {
        /*
         * O valor guardado passa a ser o da UNIDADE ESCOLHIDA, e a
         * `unitKey` acompanha. É o par inteiro que muda, nunca só a
         * etiqueta: era exatamente isso que fazia 300 virar 3000 na saída.
         */
        campo.value = convertido;
        campo.unitKey = unidade.value;

        /*
         * Mexer na unidade também é dizer que o campo vale.
         *
         * A chamada original pode não passar o argumento — e aí ele chega
         * marcado como ausente, para o gerador não inventar valor. Mas se
         * a criança escolhe "cm/s", ela está usando aquele campo: manter a
         * ausência faria a escolha não ter efeito nenhum no programa, que
         * é pior do que acrescentar um argumento explícito.
         */
        campo.ausente = false;
      }
    }

    this.onBlockChange(block, { commit });
    return true;
  }

  handleField(event, commit) {
    const field = event.target.closest(".gb-field");
    if (!field) return;

    /*
     * Os controles semânticos (direção/unidade) não têm `data-field`;
     * delegamos e saímos antes de o caminho genérico mexer neles.
     */
    if (this.handleSemanticControl(event, commit)) return;

    const element = field.closest(".program-block");
    if (!element) return;

    const block = this.find(element.dataset.blockId);
    if (!block) return;

    const name = field.dataset.field;
    if (name === undefined) return;
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
    } else if (field.classList.contains("gb-nested-value")) {
      /*
        Campo oculto de bloco aninhado: nunca é editado à mão.
        Chegar aqui significaria que a UI tentou escrever no socket como se
        fosse texto — e isso destruiria a árvore. Mantemos o bloco.
      */
      return;
    } else {
      /*
        TEXTO -> BLOCO (decisão "texto vira bloco").

        Só no momento da PROMESSÃO (commit), nunca a cada tecla. A
        promoção pergunta ao conversor de expressões se o texto tem
        estrutura; se tem, vira árvore de blocos; se não tem, continua
        sendo o que a criança digitou. Nenhum dos dois caminhos perde
        nada, e nenhum deles roda enquanto ela ainda está digitando.
      */
      value = promoteTextToBlock(
        field.value,
        paramSpec,
        (text) => parseTextExpression(text),
        (text, spec) => (spec?.type === "number" ? Number(String(text).replace(",", ".")) || 0 : text),
      );
    }

    /*
     * ESCRITA EM CAMPO DINÂMICO.
     *
     * Os campos de função (`custom_call`, `user_call`) não são parâmetros
     * com nome: são uma LISTA, e o `data-field` carrega o caminho
     * (`fields.1.value`). Escrever `block.params[name]` criava uma chave
     * literal chamada "fields.1.value" ao lado da lista — e a lista não
     * mudava. Digitar na velocidade de um `gb_move` nunca chegava ao
     * Python, e o bloco mostrava um valor que o programa não tinha.
     *
     * Não é defeito novo: vale para os campos dinâmicos que já existiam.
     * Só apareceu agora porque o caminho semântico usa mais campos.
     */
    const caminho = String(name ?? "").match(/^fields\.(\d+)\.(\w+)$/);
    if (caminho) {
      const indice = Number(caminho[1]);
      const chave = caminho[2];
      const campo = block.params.fields?.[indice];

      if (campo) {
        campo[chave] = value;

        /*
         * DIGITAR TORNA O CAMPO PRESENTE.
         *
         * O campo chegou marcado como `ausente` porque a chamada original
         * não passava esse argumento. Sem esta linha, a criança digitava
         * 300 na velocidade e o Python continuava sem ela — porque o
         * gerador pula campos ausentes, que é o que evita inventar
         * argumentos.
         */
        if (chave === "value" && String(value ?? "").trim() !== "") campo.ausente = false;
      }
    } else {
      block.params[name] = value;
    }

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

  /**
   * Desenha os blocos de forma RECONCILIANTE (ver blockRenderer.renderStack).
   *
   * Consequência que o usuário sente: digitar num campo de bloco NÃO
   * recria a árvore, então o foco nunca "escapa" do campo. Só o desenho
   * inicial e as trocas de forma recriam nós.
   */
  render(blocks, { preserveSelection = false } = {}) {
    this.blocks = blocks ?? [];
    if (!this.stack) return;

    if (!this.blocks.length) {
      // `clearStack` esvazia a cache de nós, então o aviso de "vazio" é
      // desenhado depois — nunca antes, senão ele sobrevive ao primeiro
      // bloco inserido e fica por cima da pilha.
      clearStack(this.stack);
      this.stack.appendChild(emptyState());
      return;
    }

    renderStack(this.blocks, this.stack, {});
    // O aviso de vazio some JUNTO com a renderização dos blocos, não antes.
    this.stack.querySelectorAll(":scope > .workspace-empty").forEach((node) => node.remove());
    if (preserveSelection && this.selectedId) {
      this.element?.querySelector(`[data-block-id="${CSS.escape(this.selectedId)}"]`)?.classList.add("selected");
    }
    this.checkLayout();
  }

  /**
   * Item #32: depois de QUALQUER operação, prova que nenhum bloco ficou
   * sobre outro. Roda no fim de cada render — é barato (uma varredura de
   * pares) e transforma um critério de falha em algo verificável.
   *
   * Devolve o relatório para quem quiser inspecionar; registra no console
   * apenas quando há problema, para não poluir.
   */
  checkLayout() {
    if (!this.stack) return null;
    const report = verifyLayout(this.stack);
    this.lastLayout = report;
    if (!report.ok && !this.layoutWarned) {
      // Uma vez por sessão: se(layoutWarned) some quando o layout volta a
      // ficar bom, uma falha passageira não vira spam no console.
      console.warn("[blocos] verificação de layout:", describeLayout(report));
      this.layoutWarned = true;
    } else if (report.ok) {
      this.layoutWarned = false;
    }
    return report;
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
/**
 * Workspace vazio — quase nada.
 *
 * Item #3 do pedido: nada de "Nenhum bloco nesta saída" permanente nem de
 * lista de três冠 caminhos. Uma área vazia JÁ comunica que não há programa.
 * A única dica é uma linha curta, discreta, e só na PRIMEIRA vez: depois
 * disso o espaço fica realmente vazio.
 *
 * A chave fica em `localStorage`, não em variável de módulo, para sobreviver
 * ao recarregamento da página.
 */
const FIRST_RUN_KEY = "garca:first-run-seen";

function emptyState() {
  const wrapper = document.createElement("div");
  wrapper.className = "workspace-empty";

  let firstRun = false;
  try { firstRun = !localStorage.getItem(FIRST_RUN_KEY); } catch { firstRun = false; }
  try { localStorage.setItem(FIRST_RUN_KEY, "1"); } catch { /* modo privado */ }

  if (!firstRun) return wrapper;   // vazio de verdade, sem texto

  wrapper.innerHTML =
    `<span class="empty-hint">Comece adicionando um bloco de Evento</span>`;
  return wrapper;
}

export default Workspace;

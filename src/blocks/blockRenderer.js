/**
 * BLOCK RENDERER — geometria e campos tipados
 * -------------------------------------------
 * Parte 12: a FORMA comunica o encaixe. Nunca um cadeado (N03).
 *   chapéu (hat) · empilhável (stack) · bloco em C · repórter · booleano · tampa (cap)
 *
 * Parte 13: cada tipo de dado vira o controle certo (porta = <select>, enum =
 * <select>, booleano = toggle, número = input + unidade, velocidade = slider).
 *
 * B09: texto dos campos SEMPRE legível — fundo claro, texto escuro, contraste >= 4.5:1.
 * B12: todos os valores são editáveis.
 */

import { BLOCK_BY_ID, CATEGORY_COLOR } from "./blockCatalog.js";
import { ENUMS, PT } from "../pybricks/apiRegistry.js";
import { icon } from "../ui/icons.js";

const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
);

/** Formata para exibição com vírgula decimal (Parte 13.2). */
export function ptNumber(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) return String(value ?? "");
  return String(Number(number.toFixed(6))).replace(".", ",");
}

/** Converte o que o usuário digitou em número (aceita vírgula OU ponto). */
export function parseNumber(value, fallback = 0) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  // "75, 5" NÃO é decimal: são dois argumentos (Parte 13.2)
  if (/,\s+\d/.test(text)) return fallback;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* ------------------------------------------------------------------ */
/* Controles tipados (Parte 13.1)                                      */
/* ------------------------------------------------------------------ */

const CONTROL = {
  port(field, value, spec) {
    const options = (spec.options ?? ["A", "B", "C", "D", "E", "F"])
      .map((port) => `<option value="${port}"${port === value ? " selected" : ""}>Porta ${port}</option>`)
      .join("");
    return `<select class="gb-field port-field" data-field="${field}" aria-label="Porta do dispositivo" title="Porta">${options}</select>`;
  },

  enum(field, value, spec) {
    const kind = spec.enum;
    const options = (spec.options ?? ENUMS[kind]?.map((v) => `${kind}.${v}`) ?? [])
      .map((option) => {
        const short = String(option).split(".").pop();
        const label = PT[kind]?.[short] ?? short;
        return `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    return `<select class="gb-field enum-field" data-field="${field}" aria-label="${escapeHtml(spec.label ?? field)}">${options}</select>`;
  },

  select(field, value, spec) {
    const options = (spec.options ?? [])
      .map((option) => {
        const [key, label] = Array.isArray(option) ? option : [option, option];
        return `<option value="${escapeHtml(key)}"${String(key) === String(value) ? " selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    return `<select class="gb-field enum-field" data-field="${field}" aria-label="${escapeHtml(spec.label ?? field)}">${options}</select>`;
  },

  number(field, value, spec) {
    const unit = spec.unit ? `<span class="gb-unit">${escapeHtml(spec.unit)}</span>` : "";
    const slider = spec.control === "slider+input"
      ? `<input class="gb-slider" type="range" data-slider-for="${field}" min="${spec.min ?? 0}" max="${spec.max ?? 100}" value="${Number(value) || 0}" aria-label="Ajustar ${escapeHtml(field)}" />`
      : "";
    return `<span class="gb-value">${slider}<input class="gb-field number-field" data-field="${field}" ` +
      `value="${escapeHtml(ptNumber(value))}" inputmode="decimal" ` +
      `${spec.min !== undefined ? `data-min="${spec.min}"` : ""} ${spec.max !== undefined ? `data-max="${spec.max}"` : ""} ` +
      `aria-label="${escapeHtml(spec.label ?? field)}" title="${escapeHtml(rangeHint(spec))}" />${unit}</span>`;
  },

  boolean(field, value, spec) {
    return `<label class="gb-toggle" title="${escapeHtml(spec.label ?? field)}">` +
      `<input class="gb-field boolean-field" data-field="${field}" type="checkbox"${value ? " checked" : ""} />` +
      `<span class="gb-switch" aria-hidden="true"></span></label>`;
  },

  text(field, value, spec) {
    return `<input class="gb-field text-field" data-field="${field}" value="${escapeHtml(value)}" ` +
      `aria-label="${escapeHtml(spec.label ?? field)}" placeholder="${escapeHtml(spec.placeholder ?? "")}" />`;
  },

  variable(field, value, spec) {
    return `<input class="gb-field name-field" data-field="${field}" value="${escapeHtml(value)}" ` +
      `list="gb-variable-list" aria-label="${escapeHtml(spec.label ?? field)}" />`;
  },

  expression(field, value, spec) {
    return `<input class="gb-field expr-field" data-field="${field}" value="${escapeHtml(value)}" ` +
      `spellcheck="false" aria-label="${escapeHtml(spec.label ?? field)}" />`;
  },

  /** Encaixe de bloco booleano (G02). Aceita texto até o usuário encaixar um bloco. */
  condition(field, value, spec) {
    return `<span class="gb-socket gb-socket-boolean" data-field="${field}" data-accepts="boolean" ` +
      `title="Encaixe um bloco booleano (hexágono) ou digite uma condição">` +
      `<input class="gb-field condition-field" data-field="${field}" value="${escapeHtml(value)}" ` +
      `spellcheck="false" aria-label="Condição" /></span>`;
  },
};

function rangeHint(spec) {
  if (spec.min !== undefined && spec.max !== undefined) return `Valor entre ${ptNumber(spec.min)} e ${ptNumber(spec.max)}${spec.unit ? ` ${spec.unit}` : ""}`;
  if (spec.unit) return `Valor em ${spec.unit}`;
  return "";
}

/** Escolhe o controle pelo tipo declarado no catálogo. */
function controlFor(field, value, spec) {
  const render = CONTROL[spec.type] ?? CONTROL.text;
  return render(field, value, spec);
}

/* ------------------------------------------------------------------ */
/* Rótulo do bloco a partir do template                                */
/* ------------------------------------------------------------------ */

/**
 * Monta o HTML interno do bloco substituindo {param} pelo controle tipado.
 * Texto fora dos marcadores é literal e escapado.
 */
export function blockInnerHtml(block) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  if (!spec) return escapeHtml(block.blockId);

  const template = spec.template ?? "";
  const parts = template.split(/\{(\w+)\}/g);
  let html = "";

  parts.forEach((part, index) => {
    if (index % 2 === 0) { html += escapeHtml(part); return; }
    const field = part;
    const paramSpec = spec.params?.[field] ?? spec.advanced?.[field];
    if (!paramSpec) { html += escapeHtml(`{${field}}`); return; }
    const value = block.params?.[field] ?? paramSpec.default ?? "";
    html += controlFor(field, value, { ...paramSpec, label: field });
  });

  return html.trim() || escapeHtml(spec.template ?? block.blockId);
}

/** Painel de parâmetros avançados (revelado ao expandir o bloco). */
function advancedHtml(block) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  if (!spec?.advanced) return "";
  const fields = Object.entries(spec.advanced)
    .map(([field, paramSpec]) => {
      const value = block.params?.[field] ?? paramSpec.default ?? "";
      return `<label class="gb-advanced-field"><span>${escapeHtml(field)}</span>${controlFor(field, value, paramSpec)}</label>`;
    })
    .join("");
  return `<div class="gb-advanced" ${block.expanded ? "" : "hidden"}>${fields}</div>`;
}

/* ------------------------------------------------------------------ */
/* Render de um bloco (elemento DOM)                                   */
/* ------------------------------------------------------------------ */

/**
 * @param {object} block
 * @param {object} options { selected, libraryFunctions, variables }
 * @returns {HTMLElement}
 */
export function renderBlock(block, options = {}) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  const element = document.createElement("div");
  if (!spec) {
    element.className = "program-block shape-stack";
    element.textContent = block.blockId;
    return element;
  }

  const color = options.color ?? CATEGORY_COLOR[spec.category] ?? "#42546a";
  element.className = [
    "program-block",
    `shape-${spec.shape}`,
    `cat-${spec.category}`,
    block.selected ? "selected" : "",
    block.disabled ? "disabled-block" : "",
    block.expanded ? "expanded" : "",
    options.cursorMatch ? "cursor-match" : "",
    options.error ? "has-error" : "",
  ].filter(Boolean).join(" ");

  element.dataset.blockId = block.id;
  element.dataset.schema = block.blockId;
  element.dataset.category = spec.category;
  element.dataset.shape = spec.shape;
  element.dataset.line = String(block.source?.startLine ?? "");
  element.style.setProperty("--color", color);
  element.tabIndex = -1;

  const hasAdvanced = Boolean(spec.advanced);

  element.innerHTML = `
    <div class="block-content">
      <span class="block-text">${blockInnerHtml(block)}</span>
      ${hasAdvanced ? `<button class="gb-expand" type="button" data-act="expand" title="Mais parâmetros" aria-label="Mais parâmetros" aria-expanded="${block.expanded ? "true" : "false"}">${icon(block.expanded ? "chevronDown" : "chevron", { size: 13 })}</button>` : ""}
      <span class="block-kind">${escapeHtml(shapeLabel(spec.shape))}</span>
    </div>
    ${hasAdvanced ? advancedHtml(block) : ""}
    ${spec.shape === "c-block" ? `<div class="gb-cavity" data-slot="children" data-block="${block.id}"></div>` : ""}
    ${spec.elseBranch ? `<div class="block-content gb-else-label">senão</div><div class="gb-cavity" data-slot="else" data-block="${block.id}"></div>` : ""}
  `;

  return element;
}

const SHAPE_LABEL = {
  hat: "início", stack: "", "c-block": "contém", reporter: "valor", boolean: "condição", cap: "fim",
};
const shapeLabel = (shape) => SHAPE_LABEL[shape] ?? "";

/** Renderiza uma pilha de blocos (com filhos aninhados). */
export function renderStack(blocks, container, options = {}) {
  container.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const block of blocks || []) {
    const element = renderBlock(block, options);
    fragment.appendChild(element);

    if (block.children?.length || block.elseChildren?.length) {
      const cavity = element.querySelector('[data-slot="children"]');
      if (cavity) {
        const inner = document.createElement("div");
        inner.className = "block-stack nested";
        renderStack(block.children, inner, options);
        cavity.appendChild(inner);
      }
      const elseCavity = element.querySelector('[data-slot="else"]');
      if (elseCavity) {
        const inner = document.createElement("div");
        inner.className = "block-stack nested";
        renderStack(block.elseChildren, inner, options);
        elseCavity.appendChild(inner);
      }
    }
  }

  container.appendChild(fragment);
}

/* ------------------------------------------------------------------ */
/* Bloco da PALETA (biblioteca) — NÃO editável                         */
/* ------------------------------------------------------------------ */

/**
 * Pedido do usuário: os blocos da biblioteca têm os mesmos rótulos do
 * LEGO Education, mas NÃO são editáveis ali — eles são modelos. Ao arrastar
 * para a área de trabalho é que viram editáveis (Parte 13).
 *
 * @returns {HTMLElement} botão arrastável, sem campos de edição
 */
export function renderPaletteBlock(block, defaults) {
  const spec = BLOCK_BY_ID.get(block.blockId ?? block);
  if (!spec) return null;
  const blockId = spec.id;
  const color = CATEGORY_COLOR[spec.category] ?? "#42546a";

  const button = document.createElement("button");
  button.type = "button";
  button.className = `library-block shape-${spec.shape}`;
  button.dataset.schema = blockId;
  button.dataset.category = spec.category;
  button.style.setProperty("--color", color);
  button.draggable = true;
  button.title = `${spec.doc}\n\nArraste para a área de blocos ou dê um clique duplo para inserir.`;
  button.setAttribute("aria-label", `${staticLabel(spec, defaults)}. ${spec.doc}`);

  // Rótulo estático: mostra o formato do bloco com valores de exemplo
  button.innerHTML = `<span class="lib-label">${escapeHtml(staticLabel(spec, defaults))}</span>`;
  return button;
}

/** Rótulo sem controles — substitui {param} pelo valor padrão formatado. */
export function staticLabel(spec, defaults = {}) {
  const template = spec.template ?? "";
  return template.replace(/\{(\w+)\}/g, (_, field) => {
    const paramSpec = spec.params?.[field] ?? spec.advanced?.[field];
    const value = defaults[field] ?? paramSpec?.default ?? "";
    if (!paramSpec) return `{${field}}`;
    if (paramSpec.type === "port") return String(value);
    if (paramSpec.type === "select") {
      const found = (paramSpec.options ?? []).find((option) => String(Array.isArray(option) ? option[0] : option) === String(value));
      return String(Array.isArray(found) ? found[1] : found ?? value);
    }
    if (paramSpec.type === "enum") {
      const short = String(value).split(".").pop();
      return PT[paramSpec.enum]?.[short] ?? short;
    }
    if (paramSpec.type === "condition") return "< >";
    if (paramSpec.type === "number") return ptNumber(value);
    return String(value || paramSpec.placeholder || "…");
  });
}

/* ------------------------------------------------------------------ */
/* Leitura dos campos de volta para os params                          */
/* ------------------------------------------------------------------ */

/**
 * Lê o valor de um campo DOM já no tipo certo.
 * Nunca devolve null (B01/N02): cai no padrão do catálogo.
 */
export function readFieldValue(field, spec, fallback) {
  if (!field) return fallback;

  if (field.type === "checkbox") return field.checked;

  const raw = field.value;

  switch (spec?.type) {
    case "number": {
      const parsed = parseNumber(raw, fallback);
      if (spec.min !== undefined && parsed < Number(spec.min)) return { value: parsed, warning: `${spec.label ?? "Valor"} entre ${ptNumber(spec.min)} e ${ptNumber(spec.max)}${spec.unit ? ` ${spec.unit}` : ""}` };
      if (spec.max !== undefined && parsed > Number(spec.max)) return { value: parsed, warning: `${spec.label ?? "Valor"} entre ${ptNumber(spec.min)} e ${ptNumber(spec.max)}${spec.unit ? ` ${spec.unit}` : ""}` };
      return parsed;
    }
    case "boolean":
      return raw === "true" || raw === true;
    case "port":
      return (spec.options ?? []).includes(raw) ? raw : fallback;
    case "enum":
    case "select":
      return raw || fallback;
    default:
      // Campo vazio usa o padrão do registry e marca "incompleto", nunca null (13.6)
      return raw === "" ? (fallback ?? "") : raw;
  }
}

/** Atualiza o texto exibido num campo numérico para o padrão pt-BR. */
export function normalizeFieldDisplay(field) {
  if (!field.classList?.contains("number-field")) return;
  const parsed = parseNumber(field.value, Number(field.dataset.fallback ?? 0));
  field.value = ptNumber(parsed);
}

export { escapeHtml, CONTROL };
export default { renderBlock, renderStack, renderPaletteBlock, blockInnerHtml, staticLabel, readFieldValue, ptNumber, parseNumber };

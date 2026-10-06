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

import { BLOCK_BY_ID, CATEGORY_COLOR, blockDoc } from "./blockCatalog.js";
import { ENUMS, PT, ptFunctionLabel } from "../pybricks/apiRegistry.js";
import { icon } from "../ui/icons.js";
import { isBlockValue } from "./socket.js";

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

  /**
   * Seletor de opções.
   *
   * `compact: true` é o caso especial do seletor de UNIDADE (voltas / cm /
   * mm): ele é colado dentro do campo numérico e não pode ter a largura de
   * um `<select>` normal nem repetir a palavra "selecione" na tela.
   */
  select(field, value, spec) {
    const options = (spec.options ?? [])
      .map((option) => {
        const [key, label] = Array.isArray(option) ? option : [option, option];
        return `<option value="${escapeHtml(key)}"${String(key) === String(value) ? " selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    const className = spec.compact ? "gb-field unit-field" : "gb-field enum-field";
    return `<select class="${className}" data-field="${field}" ` +
      `aria-label="${escapeHtml(spec.label ?? field)}" title="${escapeHtml(spec.label ?? field)}">${options}</select>`;
  },

  number(field, value, spec) {
    const unit = spec.unit ? `<span class="gb-unit">${escapeHtml(spec.unit)}</span>` : "";
    const slider = spec.control === "slider+input"
      ? `<input class="gb-slider" type="range" data-slider-for="${field}" min="${spec.min ?? 0}" max="${spec.max ?? 100}" value="${Number(value) || 0}" aria-label="Ajustar ${escapeHtml(spec.label ?? field)}" />`
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

  expression(field, value, spec, ctx = {}) {
    return expressionControl(field, value, spec, ctx);
  },

  /*
   * CAMPO COM UNIDADE — [ 10 ][ cm ▾]
   *
   * Nasce do socket de expressão de sempre: o `value` continua sendo o
   * MESMO elemento que aceita bloco encaixado, variável e expressão. O
   * seletor de unidade é uma coisa à direita, não uma troca de controle —
   * é por isso que `gb_move(gb, hub, distancia * 2)` continua encaixável
   * mesmo com unidade.
   *
   * O campo guarda o valor na unidade da FUNÇÃO (mm). O seletor só muda a
   * leitura; a conversão acontece na hora de gerar o Python, num lugar só.
   */
  unit(field, value, spec, ctx = {}) {
    const corpo = expressionControl(field, value, spec, ctx);
    const opcoes = (spec.unitOptions ?? [[spec.unit, spec.unit]])
      .filter(Boolean)
      .map((par) => {
        const [chave, rotulo] = Array.isArray(par) ? par : [par, par];
        const marcado = String(chave) === String(spec.unit) ? " selected" : "";
        return `<option value="${escapeHtml(chave)}"${marcado}>${escapeHtml(rotulo)}</option>`;
      })
      .join("");

    if (!opcoes) return corpo;

    /*
     * O agrupador usa `data-slot`, e não `data-field`.
     *
     * `data-field` identifica o INPUT que guarda o valor; repeti-lo no
     * wrapper criava dois elementos com o mesmo endereço na árvore, e
     * `querySelector("[data-field=...]")` devolvia o `<span>` em vez do
     * `<input>`. Quem lê o valor pelo atributo precisa achar o campo, não
     * a moldura.
     */
    return `<span class="gb-unit-control" data-slot="${field}" data-owner="${ctx.owner ?? ""}">` +
      corpo +
      `<select class="gb-field unit-field" data-unit-for="${field}" ` +
      `aria-label="Unidade de ${escapeHtml(spec.label ?? field)}">${opcoes}</select>` +
      `</span>`;
  },

  /*
   * CAMPO DE DIREÇÃO — [ para frente ▾ ] [ 100 ] [ mm ]
   *
   * A direção e o número são o MESMO dado visto de dois jeitos: o sinal do
   * número é a direção. Por isso o `<select>` carrega `data-sign`, e quem
   * escreve no Python lê esse sinal em vez de reescrever o número.
   *
   * Quando o valor é expressão, não há direção a mostrar — o dropdown fica
   * vazio e desabilitado, em vez de escolher "frente" por conta própria.
   */
  direction(field, value, spec, ctx = {}) {
    const opcoes = (spec.options ?? [])
      .map((par) => {
        const [chave, rotulo] = Array.isArray(par) ? par : [par, par];
        const sinal = chave === (spec.direction ?? "") ? " selected" : "";
        // A segunda opção é a de sinal negativo: o número e a direção são
        // o mesmo dado, e é o `data-sign` que liga os dois.
        const segunda = (spec.options ?? [])[1]?.[0];
        const dataSinal = chave === segunda ? ' data-sign="-1"' : ' data-sign="1"';
        return `<option value="${escapeHtml(chave)}"${sinal}${dataSinal}>${escapeHtml(rotulo)}</option>`;
      })
      .join("");

    const definido = Boolean(spec.direction);
    /*
     * O `field` JÁ vem como `fields.N.value`. Encaminhar `${field}.value`
     * de novo produzia `data-field="fields.0.value.value"`, e o seletor não
     * encontrava mais o campo — a edição do valor parava de funcionar.
     */
    const corpo = expressionControl(field, value, spec, ctx);

    return `<span class="gb-direction-control" data-slot="${field}" data-owner="${ctx.owner ?? ""}">` +
      `<select class="gb-field direction-field" data-direction-for="${field}" ` +
      `${definido ? "" : "disabled "}aria-label="Direção de ${escapeHtml(spec.label ?? field)}">${opcoes}</select>` +
      `${corpo}` +
      (spec.unit ? `<span class="gb-unit">${escapeHtml(spec.unit)}</span>` : "") +
      `</span>`;
  },

  /** Encaixe de bloco booleano (G02). Aceita texto até o usuário encaixar um bloco. */
  condition(field, value, spec, ctx = {}) {
    return `<span class="gb-socket gb-socket-boolean" data-field="${field}" data-accepts="condition" ` +
      `data-owner="${ctx.owner ?? ""}" data-socket="${field}" ` +
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
function controlFor(field, value, spec, ctx = {}) {
  const render = CONTROL[spec.type] ?? CONTROL.text;
  return render(field, value, spec, ctx);
}

/* ------------------------------------------------------------------ */
/* SOCKETS: o bloco encaixado vira um bloco de verdade na tela         */
/* ------------------------------------------------------------------ */
/*
 * Um socket de expressão tem TRÊS estados, e todos os três são reais:
 *
 *   1. VAZIO       -> o contorno do encaixe, clicável. A criança vê que
 *                     ali cabe um bloco.
 *   2. COM VALOR   -> um número ou texto digitado, em campo editável.
 *                     É o modo rápido: escrever 50 não deve custar um
 *                     clique.
 *   3. COM BLOCO   -> o bloco ANINHADO desenhado dentro do encaixe, com a
 *                     geometria dele (oval de repórter, hexágono de
 *                     booleano). Este é o estado que o projeto não tinha:
 *                     antes o `erro * KP_STRAIGHT` aparecia como o texto
 *                     "(erro * KP_STRAIGHT)" dentro de uma caixa.
 *
 * O bloco aninhado é renderizado pelo MESMO `blockInnerHtml` dos blocos de
 * primeira classe — não existe um "modo simplificado". É por isso que um
 * operador dentro de um socket tem exatamente a mesma cara do operador
 * solto na paleta, e por isso a geometria aninhada é consistente sem
 * nenhum CSS especial.
 */
/**
 * Desenha um bloco dentro de um socket.
 *
 * O bloco aninhado é renderizado por `blockInnerHtml`, o MESMO caminho dos
 * blocos de primeira classe. Não existe um "modo simplificado" para
 * encaixados: um operador dentro de um socket tem exatamente a mesma
 *.geometry do operador solto, e por isso a forma aninhada é consistente
 * sem CSS separado para cada caso.
 */
function blockHtml(block) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  if (!spec) return `<span class="gb-nested">${escapeHtml(String(block.blockId))}</span>`;

  const shapeClass = spec.shape === "boolean" ? "gb-socket-boolean" : "gb-socket-shape";
  return `<span class="gb-nested-block ${shapeClass}" data-nested-id="${escapeHtml(block.id ?? "")}">` +
    `<span class="gb-nested-text">${blockInnerHtml(block)}</span>` +
    `</span>`;
}

/**
 * Literal dentro de um socket.
 *
 * Um NÚMERO ou um TEXTO é desenhado como campo editável, e não como bloco
 * desenhado. A diferença importa na prática: se `50` virasse um bloco
 * oval, a criança precisaria removê-lo antes de digitar outro número — e
 * mexer em velocidade é a coisa que ela mais faz. O número é o valor do
 * socket; a ÁRVORE é o que ela encaixa por cima dele.
 *
 * `None`, `True` e `False` também são campos: são menos de três valores
 * possíveis e um seletor é mais claro do que um bloco.
 */
function literalControl(field, block, paramSpec, ownerBlock) {
  const ctx = { owner: ownerBlock?.id ?? "", accepts: paramSpec?.type ?? "expression" };
  const id = block?.blockId;
  if (id === "literal_number") {
    return `<input class="gb-field number-field" data-field="${field}" inputmode="decimal" ` +
      `value="${escapeHtml(block.params?.value ?? 0)}" aria-label="${escapeHtml(paramSpec?.label ?? field)}" />`;
  }
  if (id === "literal_text") {
    return `<input class="gb-field expr-field" data-field="${field}" ` +
      `value="${escapeHtml(block.params?.value ?? "")}" aria-label="${escapeHtml(paramSpec?.label ?? field)}" />`;
  }
  if (id === "literal_bool") {
    return `<select class="gb-field select-field" data-field="${field}" aria-label="verdadeiro ou falso">` +
      `<option value="True"${block.params?.value === "True" ? " selected" : ""}>sim</option>` +
      `<option value="False"${block.params?.value === "False" ? " selected" : ""}>não</option>` +
      `</select>`;
  }
  if (id === "literal_none") {
    return `<span class="gb-nested-block gb-socket-shape" data-literal="none">nada</span>` +
      `<input type="hidden" class="gb-nested-value" data-field="${field}" value="literal_none" />`;
  }
  /*
   * Não é literal: é um bloco de verdade encaixado. O `ctx` precisa
   * viajar junto, senão o socket sai sem DONO e o `drop` não sabe sobre
   * qual bloco a criança está soltando — e qualquer bloco caberia em
   * qualquer encaixe.
   */
  return nestedBlockControl(field, block, ctx);
}

/**
 * Campo oculto + desenho do bloco encaixado.
 *
 * O `data-owner` e o `data-accepts` não são decoração: é com eles que o
 * `workspace` descobre, no `drop`, QUAL bloco é o dono do encaixe e QUE TIPO
 * ele aceita. Sem os dois, qualquer bloco podia ser solto em qualquer lugar.
 */
function nestedBlockControl(field, block, ctx = {}) {
  return `<input type="hidden" class="gb-nested-value" data-field="${field}" ` +
      `value="${escapeHtml(block.blockId)}" />` +
    `<span class="gb-socket gb-socket-filled" data-field="${field}" data-accepts="${ctx.accepts ?? "expression"}" ` +
      `data-owner="${ctx.owner ?? ""}" data-socket="${field}" ` +
      `title="Bloco encaixado. Clique para trocá-lo.">${blockHtml(block)}</span>`;
}

function expressionControl(field, value, spec, ctx = {}) {
  // 1. bloco encaixado
  if (isBlockValue(value)) {
    return `<span class="gb-socket gb-socket-filled" data-field="${field}" data-accepts="${ctx.accepts ?? "expression"}" ` +
      `data-owner="${ctx.owner ?? ""}" data-socket="${field}" ` +
      `title="Encaixe um bloco aqui (ou clique para trocar)">` +
      blockHtml(value, { embedded: true }) +
      `</span>`;
  }

  // 2. lista de argumentos de chamada: cada item é um socket próprio
  if (Array.isArray(value)) {
    const sockets = value
      .map((_, index) => `<span class="gb-socket gb-socket-empty" data-field="${field}.${index}" ` +
        `data-accepts="${ctx.accepts ?? "expression"}" data-owner="${ctx.owner ?? ""}" ` +
        `data-socket="${field}.${index}" title="Encaixe um bloco aqui"></span>`)
      .join(`<span class="gb-socket-sep">,</span>`);
    return `<span class="gb-sockets" data-field="${field}">${sockets}</span>`;
  }

  // 3. valor cru: o campo de sempre
  return `<input class="gb-field expr-field" data-field="${field}" value="${escapeHtml(value ?? "")}" ` +
    `spellcheck="false" aria-label="${escapeHtml(spec.label ?? field)}" />`;
}

/* ------------------------------------------------------------------ */
/* Rótulo do bloco a partir do template                                */
/* ------------------------------------------------------------------ */

/**
 * Monta o HTML interno do bloco substituindo {param} pelo controle tipado.
 * Texto fora dos marcadores é literal e escapado.
 *
 * Item #5: os parênteses que Involviam um campo viram parte do CAMPO, não
 * texto solto na frase. "por (50)" desenhava o "(" e o ")" como caracteres
 * comuns, e o ")" sobrava sozinho numa linha quando a frase quebrava —
 * parecendo um bloco quebrado. Agora o campo já nasce com a casca visual que
 * o LEGO usa: o valor dentro de uma cápsula.
 */
export function blockInnerHtml(block) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  if (!spec) return escapeHtml(block.blockId);

  // Bloco de função do projeto: um campo por parâmetro detectado em `def`.
  if (Array.isArray(block.params?.fields)) return customCallHtml(block);
  // Bloco de função do projeto: um campo por parâmetro detectado em `def`.
  if (Array.isArray(block.params?.fields)) return customCallHtml(block);

  const template = spec.template ?? "";
  const parts = template.split(/\{(\w+)\}/g);
  const out = [];

  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 0) { out.push({ text: parts[index] }); continue; }
    const field = parts[index];
    const paramSpec = spec.params?.[field] ?? spec.advanced?.[field];
    if (!paramSpec) { out.push({ text: `{${field}}` }); continue; }
    const declared = block.params?.[field];
    const value = declared === undefined || declared === null ? paramSpec.default ?? "" : declared;

    /*
      Campo de texto invisível que carrega o NOME de um bloco aninhado.

      Ele existe por um motivo de robustez: o código que lê o valor de um
      campo (`readFieldValue`, o patch por SPAN, o histórico) trabalha com
      strings. Dar a ele o nome do bloco mantém esses caminhos funcionando
      sem reescrevê-los, enquanto a criança vê o bloco desenhado ao lado.
      Nada aqui é exibido — `.gb-nested-value` é `display:none`.
    */
    if (isBlockValue(value)) {
      out.push({ control: literalControl(field, value, paramSpec, block) });
      continue;
    }

    out.push({
      control: controlFor(
        field,
        value,
        { ...paramSpec, label: paramSpec.label ?? field },
        // O dono e o tipo aceito viajam para o HTML, para o `drop` poder
        // recusar o encaixe errado antes de alterar qualquer árvore.
        { owner: block?.id ?? "", accepts: paramSpec?.type ?? "expression" },
      ),
    });
  }

  return joinControls(out).trim() || escapeHtml(spec.template ?? block.blockId);
}

/**
 * Agrupa controles VIZINHOS numa cápsula única e absorve os parênteses.
 *
 * Este é o ponto onde a FORMA do bloco ensina a função (item #5). Três
 * defeitos de leitura saem daqui de uma vez:
 *
 *   "por (50) cm"  ->  o "(" e o ")" eram TEXTO e quebravam de linha,
 *                      deixando um ")" órfão sozinho embaixo do bloco;
 *   "50" + "cm"    ->  número e seletor de medida eram irmãos e cada um
 *                      podia cair numa linha diferente;
 *   "62,4 mm"      ->  idem, e a unidade ficava grudada no limite da caixa.
 *
 * A regra é curta: TEXTO LITERAL SEPARA, controles vizinhos se FUNDEM.
 * "motor A ou motor B" continua separado, porque ali o texto carrega
 * significado e a divisão é o que a criança precisa enxergar.
 */
function joinControls(parts) {
  let html = "";
  let group = "";

  const flush = () => {
    if (!group) return;
    html += `<span class="gb-group">${group}</span>`;
    group = "";
  };

  for (const part of parts) {
    if (part.control !== undefined) { group += part.control; continue; }

    let text = part.text ?? "";
    if (!text) continue;

    /*
     * O parêntese de abertura pertence à cápsula do campo SEGUINTE, mas só
     * quando vem no fim do trecho de texto. Em "mover ↑ por (50) cm" o
     * trecho " por (" fecha o grupo com [↑] e abre um grupo NOVO com "(".
     *
     * O detalhe que importa: quando o "(" fecha um texto com palavras, as
     * palavras vão para ANTES da cápsula. Sem isso aparecia
     * "mover por (↑ 50 cm)" — o "(" comia a direção junto.
     */
    const trimmed = text.trimEnd();
    const trailingOpen = trimmed.endsWith("(");
    if (group) {
      // parte final antes do "(" vira texto, e só o resto vai para a cápsula
      const head = text.replace(/\(+\s*$/, "");
      const opens = (text.match(/\(/g) || []).length;
      if (head.trim()) { flush(); html += escapeHtml(head); }
      group = "(".repeat(opens) + group;
      text = "";
    } else {
      flush();
      text = text;
    }
    if (!trailingOpen && !text.trim()) continue;

    if (text) {
      const opens = (text.match(/\(/g) || []).length;
      const closes = (text.match(/\)/g) || []).length;
      const literal = text.replace(/[()]/g, "");
      if (group) {
        group = "(".repeat(opens) + group;
        if (closes) group += ")".repeat(closes);
        if (literal) { flush(); html += escapeHtml(literal); }
      } else {
        html += "(".repeat(opens);
        if (literal) html += escapeHtml(literal);
        html += ")".repeat(closes);
      }
    }
  }
  flush();
  return html;
}

/**
 * Bloco de função Python do projeto: "Mover com giroscópio" com um campo
 * tipado por parâmetro, dentro da própria frase.
 *
 * O nome técnico (`gyro_move`) continua no Python gerado — a tradução é
 * somente visual. O que NÃO aparece é o campo genérico `args`.
 */
function customCallHtml(block) {
  const label = block.params?.label || ptFunctionLabel(block.params?.function) || "função";
  const fields = functionFieldsHtml(block);
  return `<span class="gb-library-name">${escapeHtml(label)}</span>${fields ? ` ${fields}` : ""}`;
}

/**
 * Parâmetros de função como campos TIPADOS dentro da frase do bloco.
 *
 * Item #6 do pedido: a criança não deve ver `args` — um campo de texto
 * genérico com o nome técnico dentro. `def gyro_move(distance, speed)`
 * precisa virar:
 *
 *     Mover com giroscópio   distância [  ]   velocidade [  ]
 *
 * O nome técnico continua existindo — só não aparece para quem programa.
 * `unit` e `type` vêm da detecção de assinatura em semantic/analyzer.
 */
function functionFieldsHtml(block) {
  const fields = Array.isArray(block.params?.fields) ? block.params.fields : [];
  if (!fields.length) return "";
  return fields
    .map((field, index) => {
      const spec = {
        type: field.type || "expression",
        label: field.label || ptFunctionLabel(field.name) || field.name,
        unit: field.unit,
        options: field.options,
        min: field.min,
        max: field.max,
        placeholder: field.placeholder,
        /*
         * Campos semânticos chegam com informação que o catálogo não tem:
         * as opções de unidade, o rótulo de direção e o sinal. Sem
         * repassá-los, o controle certo seria desenhado sem os dados que o
         * justificam — e o `10 cm` voltaria a ser `10`.
         */
        unitOptions: field.unitOptions,
        unitKey: field.unitKey,
        direction: field.direction,
        sign: field.sign,
        name: field.name,
      };
      return controlFor(`fields.${index}.value`, field.value ?? "", spec);
    })
    .join(" ");
}

/**
 * Sub-painel de um bloco: campos organizados em pares rótulo + controle.
 *
 * Usado pelo bloco de movimento (item #9) para caber roda e eixo em duas
 * colunas curtas em vez de esticar a frase inteira por 500px.
 */
function fieldsPanelHtml(block) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  const groups = spec?.geometry;
  if (!groups) return "";
  const cells = Object.entries(groups)
    .map(([field, paramSpec]) => {
      const value = block.params?.[field] ?? paramSpec.default ?? "";
      const label = GEOMETRY_LABEL[field] ?? field;
      return `<label class="gb-cell"><span class="gb-cell-label">${escapeHtml(label)}</span>` +
        controlFor(field, value, { ...paramSpec, label }) +
        `</label>`;
    })
    .join("");
  return `<div class="gb-panel" data-panel="geometry">${cells}</div>`;
}

const GEOMETRY_LABEL = {
  wheel_diameter: "Roda",
  axle_track: "Eixo",
};

/** Painel de parâmetros avançados (revelado ao expandir o bloco). */
function advancedHtml(block) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  if (!spec?.advanced) return "";
  const fields = Object.entries(spec.advanced)
    .map(([field, paramSpec]) => {
      const value = block.params?.[field] ?? paramSpec.default ?? "";
      // Item #6: o rótulo do campo é o NOME HUMANO do parâmetro, nunca a
      // chave técnica. Antes escrevia "speed_percent" e "positive_direction"
      // no bloco — vocabulário de AST dentro de programação visual.
      const label = ADVANCED_LABEL[field] ?? ptFunctionLabel(field) ?? field;
      return `<label class="gb-advanced-field"><span>${escapeHtml(label)}</span>` +
        controlFor(field, value, { ...paramSpec, label }) +
        `</label>`;
    })
    .join("");
  return `<div class="gb-advanced" ${block.expanded ? "" : "hidden"}>${fields}</div>`;
}

/**
 * Rótulos humanos dos parâmetros extras. O que não está aqui cai no
 * `ptFunctionLabel`, que traduz o nome técnico para português.
 */
const ADVANCED_LABEL = {
  speed_percent: "força",
  positive_direction: "sentido",
  negative_direction: "sentido contrário",
  model: "HUB",
  duration: "duração",
  rate: "velocidade",
  mode: "modo",
  duty: "potência",
  value: "valor",
  accel: "aceleração",
  deaccel: "desaceleração",
  turn_rate: "velocidade do giro",
  sound: "som",
};

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
    element.__schema = block.blockId;
    element.__params = { ...(block.params ?? {}) };
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
  // O CSS posiciona o botao de expandir no canto; a classe diz que ele existe.
  if (hasAdvanced) element.classList.add("has-advanced");

  element.innerHTML = `
    <div class="block-content">
      <span class="block-text">${blockInnerHtml(block)}</span>
      ${hasAdvanced ? `<button class="gb-expand" type="button" data-act="expand" title="Mais parâmetros" aria-label="Mais parâmetros" aria-expanded="${block.expanded ? "true" : "false"}">${icon(block.expanded ? "chevronDown" : "chevron", { size: 13 })}</button>` : ""}
      <span class="block-kind">${escapeHtml(shapeLabel(spec.shape))}</span>
    </div>
    ${hasAdvanced ? advancedHtml(block) : ""}
    ${fieldsPanelHtml(block)}
    ${hasCavity(spec) ? `<div class="gb-cavity" data-slot="children" data-block="${block.id}"></div>` : ""}
    ${spec.elseBranch ? `<div class="block-content gb-else-label">senão</div><div class="gb-cavity" data-slot="else" data-block="${block.id}"></div>` : ""}
  `;

  // Memória do nó: o que foi desenhado. O patch incremental compara com isto
  // em vez de recriar o HTML (e destruir o campo que o usuário está digitando).
  element.__schema = block.blockId;
  element.__shape = spec.shape;
  element.__hasElse = Boolean(spec.elseBranch);
  element.__params = { ...(block.params ?? {}) };

  return element;
}

const SHAPE_LABEL = {
  hat: "início", stack: "", "c-block": "contém", reporter: "valor",
  boolean: "condição", cap: "fim", code: "Python",
};
const shapeLabel = (shape) => SHAPE_LABEL[shape] ?? "";

/* ------------------------------------------------------------------ */
/* PATCH INCREMENTAL — a causa do "input perde o foco"                  */
/* ------------------------------------------------------------------ */

/**
 * Atualiza UM bloco já desenhado, sem trocar o HTML.
 *
 * MOTIVO: `renderStack` recriava a árvore inteira a cada tecla digitada
 * (`container.innerHTML = ""`). O input sob o dedo do usuário era destruído
 * e recriado a cada caractere — o foco ia embora e a criança precisava
 * clicar de novo para continuar digitando.
 *
 * Aqui o nó é preservado e só os VALORES divergentes são escritos. E o
 * campo que está com o foco NUNCA é reescrito: o cursor de digitação fica
 * exatamente onde a criança deixou.
 *
 * @returns {boolean} true se o HTML precisou ser reconstruído
 */
export function patchBlockElement(element, block, options = {}) {
  const spec = BLOCK_BY_ID.get(block.blockId);
  if (!element || !spec) return true;

  // Forma ou categoria mudaram: o desenho precisa ser refeito.
  if (element.__schema !== block.blockId || element.__shape !== spec.shape || element.__hasElse !== Boolean(spec.elseBranch)) {
    return true;
  }

  const previous = element.__params ?? {};
  const next = block.params ?? {};
  const active = document.activeElement;
  const focusedField = active && element.contains(active) ? active : null;

  // Campos dinâmicos (função do projeto): params.fields é uma lista.
  const previousFields = Array.isArray(previous.fields) ? previous.fields : [];
  const nextFields = Array.isArray(next.fields) ? next.fields : [];
  if (previousFields.length !== nextFields.length) return true;

  // O painel de geometria (item #9) também precisa ser sincronizado: sem
  // ele, editar "roda" no canvas atualizava a tela mas não o Python.
  const specFields = { ...(spec.params ?? {}), ...(spec.advanced ?? {}), ...(spec.geometry ?? {}) };
  let changed = false;

  for (const [field, paramSpec] of Object.entries(specFields)) {
    const value = next[field] ?? paramSpec.default ?? "";
    if (sameValue(previous[field], value)) continue;
    changed = true;

    const node = element.querySelector(`[data-field="${cssEscape(field)}"]`);
    if (!node) continue;
    if (node === focusedField) continue;   // <- o usuário está digitando aqui
    writeFieldValue(node, value, paramSpec);
  }

  nextFields.forEach((field, index) => {
    if (sameValue(previousFields[index]?.value, field.value)) return;
    changed = true;
    const node = element.querySelector(`[data-field="fields.${index}.value"]`);
    if (!node || node === focusedField) return;
    writeFieldValue(node, field.value ?? "", { type: field.type });
  });

  // Rótulo visual pode ter mudado (bloco de função renomeado).
  if (!sameValue(previous.label, next.label)) {
    const nameNode = element.querySelector(".gb-library-name");
    if (nameNode) nameNode.textContent = next.label || ptFunctionLabel(next.function) || "função";
  }

  // Painel de parâmetros extras
  const advanced = element.querySelector(".gb-advanced");
  if (advanced) {
    const shouldShow = Boolean(block.expanded);
    if (shouldShow !== !advanced.hasAttribute("hidden")) {
      advanced.toggleAttribute("hidden", !shouldShow);
      element.querySelector('[data-act="expand"]')?.setAttribute("aria-expanded", String(shouldShow));
    }
  }

  element.classList.toggle("selected", Boolean(block.selected));
  element.classList.toggle("disabled-block", Boolean(block.disabled));
  element.classList.toggle("expanded", Boolean(block.expanded));
  element.dataset.line = String(block.source?.startLine ?? "");

  element.__params = { ...next };
  if (options.color) element.style.setProperty("--color", options.color);
  return false;
}

function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return String(a ?? "") === String(b ?? "");
}

/** Escreve um valor no controle respeitando o tipo declarado. */
function writeFieldValue(node, value, paramSpec) {
  if (node.type === "checkbox") {
    if (node.checked !== Boolean(value)) node.checked = Boolean(value);
    return;
  }
  const text = paramSpec?.type === "number" ? ptNumber(value) : String(value ?? "");
  if (node.value !== text) {
    // Preserva o cursor quando o valor realmente é o mesmo com outra máscara
    if (document.activeElement === node) return;
    node.value = text;
  }
}

const cssEscape = (value) => (window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));

/* ------------------------------------------------------------------ */
/* Render RECONCILIANTE de uma pilha de blocos                         */
/* ------------------------------------------------------------------ */

/**
 * Reconcilia os blocos no contêiner reusing os nós que já existem.
 *
 * Contrato (o que a interface do programa precisa):
 *   - o DOM de um bloco SÓ é reconstruído quando a forma dele muda;
 *   - editar um campo NÃO recria a árvore -> o foco não se perde;
 *   - remover um bloco remove o nó dele (e o dos filhos);
 *   - a ordem visual acompanha a ordem do Python.
 *
 * @param {Array} blocks
 * @param {HTMLElement} container
 * @param {object} options
 */
export function renderStack(blocks, container, options = {}) {
  if (!container) return;
  const list = blocks ?? [];
  const nodes = container.__blockNodes ?? (container.__blockNodes = new Map());
  const seen = new Set();

  list.forEach((block, index) => {
    let element = nodes.get(block.id);
    if (!element) {
      element = renderBlock(block, options);
      nodes.set(block.id, element);
    } else {
      // Reconstrói SÓ quando a forma mudou; senão faz patch de valores.
      if (patchBlockElement(element, block, options)) {
        const replacement = renderBlock(block, options);
        element.replaceWith(replacement);
        element = replacement;
        nodes.set(block.id, replacement);
      }
    }
    seen.add(block.id);

    // Só move o nó se ele não estiver já na posição (evita layout à toa).
    if (container.children[index] !== element) {
      container.insertBefore(element, container.children[index] ?? null);
    }

    // Filhos dentro do encaixe
    if (block.children?.length || specHasCavity(block)) {
      const cavity = element.querySelector('[data-slot="children"]');
      if (cavity) renderStack(block.children ?? [], pilhaDaCavidade(cavity), options);
    }
    if (element.__hasElse) {
      const elseCavity = element.querySelector('[data-slot="else"]');
      if (elseCavity) renderStack(block.elseChildren ?? [], pilhaDaCavidade(elseCavity), options);
    }
  });

  // Nós que não existem mais no modelo saem do DOM.
  for (const [id, node] of nodes) {
    if (seen.has(id)) continue;
    node.remove();
    nodes.delete(id);
  }
  // Blocos sem id estável (estado vazio) continuam funcionando.
  container.querySelectorAll(":scope > .workspace-empty").forEach((node) => node.remove());
}

/**
 * A PILHA INTERNA DE UMA CAVIDADE — sempre uma, nunca duas.
 *
 * Este é o conserto da duplicata que a criança viu ao apagar um caractere
 * dentro de um bloco do "quando o programa iniciar".
 *
 * O código procurava `:scope > .block-stack.nested` e criava
 * `class="block-stack gb-stack"`. A classe `nested` nunca existiu, então a
 * busca dava `null` TODA VEZ, e um novo nó de pilha era acrescentado à
 * cavidade a cada tecla. O corpo do programa ia se empilhando: três cópias
 * do mesmo bloco, e apagar não resolvia porque havia outras duas.
 *
 * A garantia é explícita e não depende de nome de classe: se a cavidade já
 * tem pilha, ela é reutilizada; se tem mais de uma (por qualquer motivo
 * passado ou futuro), as extras são removidas. Um bloco em C tem no máximo
 * um corpo.
 */
function pilhaDaCavidade(cavidade) {
  const existentes = [...cavidade.querySelectorAll(":scope > .block-stack")];
  let pilha = existentes[0];
  if (!pilha) {
    pilha = document.createElement("div");
    pilha.className = "block-stack nested gb-stack";
    cavidade.appendChild(pilha);
  }
  for (const extra of existentes.slice(1)) extra.remove();
  return pilha;
}

function specHasCavity(block) {
  return hasCavity(BLOCK_BY_ID.get(block.blockId));
}

/**
 * Quais blocos têm um "encaixe" para receber outros blocos.
 *
 * Não é só o bloco em C: o chapéu "quando o programa iniciar" também é,
 * porque o que vem abaixo dele é o CORPO do programa (a função `main()`).
 * Sem esta cavidade o usuário não tinha onde encaixar nada abaixo do evento.
 */
function hasCavity(spec) {
  return spec?.shape === "c-block" || spec?.isMain === true;
}

/** Esvazia a pilha e limpa o cache de nós. */
export function clearStack(container) {
  if (!container) return;
  container.__blockNodes?.clear();
  container.replaceChildren();
}

/* ------------------------------------------------------------------ */
/* Bloco da PALETA (biblioteca) — modelo, sem campos de edição          */
/* ------------------------------------------------------------------ */

/**
 * Na paleta o bloco é um MODELO: mostra o formato, não os campos.
 *
 * PEDIDO DO USUÁRIO: o texto aparece inteiro ao passar o mouse (o bloco
 * cresce sobre os vizinhos, no espírito do LEGO Education) e UM CLIQUE JÁ
 * INSERE o bloco no programa. Arrastar continua existindo como alternativa,
 * mas nunca é obrigatório.
 *
 * @returns {HTMLElement} botão arrastável, sem campos de edição
 */
export function renderPaletteBlock(block, defaults) {
  const spec = BLOCK_BY_ID.get(block.blockId ?? block);
  if (!spec) return null;
  const color = CATEGORY_COLOR[spec.category] ?? "#42546a";
  const doc = blockDoc(spec);

  const button = document.createElement("button");
  button.type = "button";
  button.className = `library-block shape-${spec.shape}`;
  button.dataset.schema = spec.id;
  button.dataset.category = spec.category;
  button.style.setProperty("--color", color);
  button.draggable = true;
  button.title = `${doc}\n\nClique para inserir no programa, ou arraste até a área de blocos.`;
  button.setAttribute("aria-label", `${staticLabel(spec, defaults)}. ${doc}`);

  /*
    Dois rótulos, sempre os dois no DOM:

      • curto  — o nome que cabe numa linha na paleta estreita;
      • completo — o nome inteiro, que só aparece no hover.

    Ambos ficam no DOM de propósito: o texto curto é o que se lê no
    dia a dia, e o completo é o que tira a dúvida "o que mesmo é isso?".
    Nenhum dos dois usa reticência silenciosa.
  */
  button.innerHTML =
    `<span class="lib-label-short">${escapeHtml(staticLabel(spec, defaults, { compact: true }))}</span>` +
    `<span class="lib-label-full">${escapeHtml(staticLabel(spec, defaults))}</span>`;
  return button;
}

/**
 * Rótulo sem controles — substitui {param} pelo valor padrão formatado.
 * @param {object} options `compact: true` devolve o rótulo curto usado na lista
 *                    (o completo aparece no hover).
 */
export function staticLabel(spec, defaults = {}, options = {}) {
  const template = options.compact
    ? (spec.shortTemplate ?? deriveShortTemplate(spec) ?? spec.template ?? "")
    : (spec.template ?? "");
  return template.replace(/\{\s*(\w+)\s*\}/g, (_, field) => {
    const paramSpec = spec.params?.[field] ?? spec.advanced?.[field] ?? spec.geometry?.[field];
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

/**
 * Versão CURTA do rótulo, deduzida do template completo.
 *
 * Item #11: a paleta é estreita e precisa de um nome que caiba numa linha
 * sem esconder o que o bloco faz. Em vez de manter `shortTemplate` à mão em
 * 130 blocos (e deixar a maioria sem), o curto é DERIVADO: some o que é
 * ruído (cauda explicativa depois da primeira oração) e mantém verbo +
 * objeto + o primeiro valor — que é o que identifica o bloco.
 *
 *   "fazer curva de (200) girando (90)"  -> "fazer curva de (200)"
 *   "tocar nota (C4) por (0,5) batidas"  -> "tocar nota (C4)"
 *   "transmita (mensagem1) e espere"     -> "transmita (mensagem1)"
 */
/**
 * Versão CURTA do rótulo para a paleta estreita (item #11).
 *
 * Em vez de manter `shortTemplate` à mão nos 130 blocos do catálogo — e
 * deixar a maioria sem, que é o que fazia o nome aparecer cortado — o
 * curto é DEDUZIDO: corta a cauda explicativa ("... por 500 mm", "... e
 * espere") e mantém verbo, objeto e o primeiro valor.
 *
 *   "fazer curva de (200) girando (90)"  -> "fazer curva de (200)"
 *   "tocar nota (C4) por (0,5) batidas"  -> "tocar nota (C4)"
 *   "motor na porta A"                   -> "motor na porta A"
 *
 * O corte NUNCA acontece dentro de "(...)": o valor é o que distingue
 * "fazer curva" de "fazer reta".
 */
function deriveShortTemplate(spec) {
  const template = spec.template ?? "";
  if (!template) return null;

  const short = cutAtClause(template);

  if (short.length > 32) {
    const cut = short.lastIndexOf(" ", 32);
    return (cut > 12 ? short.slice(0, cut) : short.slice(0, 32)).trimEnd() + "…";
  }
  return short;
}

/*
  Palavras que anunciam a cauda.

  "de", "do", "da", "em", "para" NÃO entram na lista de propósito: em
  "fazer curva DE (200)" e "motor NA porta A" essas preposições fazem parte
  do nome do bloco, e cortar ali dava "fazer curva" e "motor" — dois nomes
  que não dizem o que o bloco faz. A lista tem só o que de fato introduz
  uma condição ou uma ação separada.
*/
const CLAUSE_STARTERS = /^(e|com|girando|então|já|usando|após|antes|durante|enquanto)$/i;

/**
 * Encontra onde a cauda explicativa começa, pulando o conteúdo dos
 * parênteses. "(200)" não é cauda; " girando (90)" é.
 */
function cutAtClause(template) {
  // tokeniza preservando os espaços: "girar ↻ por (90) graus"
  const tokens = template.match(/\s+|[^\s]+/g) ?? [];
  let depth = 0;
  const kept = [];

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      // espaço só entra se já existe algo antes dele
      if (kept.length) kept.push(token);
      continue;
    }
    const bare = token.replace(/^[([{]+/, "").replace(/[)\]}]+$/, "");
    const startsOpen = /^[([{]/.test(token);
    const endsOpen = /[)\]}]$/.test(token);

    if (depth === 0 && kept.length && !startsOpen && CLAUSE_STARTERS.test(bare)) break;

    kept.push(token);
    if (startsOpen) depth += 1;
    if (endsOpen) depth -= 1;
  }
  return kept.join("").trim();
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
export default {
  renderBlock, renderStack, clearStack, patchBlockElement,
  renderPaletteBlock, blockInnerHtml, staticLabel, readFieldValue, ptNumber, parseNumber,
};

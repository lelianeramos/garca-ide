/**
 * EDITOR METRICS — fonte única da verdade da geometria do editor
 * ==============================================================
 *
 * CAUSA RAIZ DO BUG DO CURSOR (documentada aqui para não voltar):
 *
 *   O editor é um <textarea> transparente com um <pre> de realce por cima.
 *   Ambos precisam ter EXATAMENTE a mesma métrica (fonte, line-height,
 *   padding, tab-size, letter-spacing), senão a linha que o olho vê não é a
 *   linha em que o navegador coloca o caret.
 *
 *   Antes, o realce era montado com as linhas em `display:block` E separadas
 *   por "\n" dentro de um contêiner com `white-space: pre`. Cada "\n" virava
 *   uma caixa de linha extra: cada linha ocupava 40px no realce e 20px no
 *   textarea. Resultado: clicar na linha visível 3 colocava o cursor na 2.
 *
 * REGRA DESTE MÓDULO: nada de número mágico (7.2px de caractere, 53px de
 * padding, 12px de topo). Tudo é MEDIDO do elemento real e redesenhado em
 * tempo real quando a fonte, o zoom ou o tamanho da janela mudam.
 */

/** Valores usados só até a primeira medição real (evita NaN no 1º frame). */
export const FALLBACK = Object.freeze({
  charWidth: 7.2,
  lineHeight: 20,
  paddingTop: 12,
  paddingRight: 12,
  paddingBottom: 30,
  paddingLeft: 53,
  fontSize: 12,
  gutterWidth: 42,
});

let cached = { ...FALLBACK };
let probe = null;
let probeOwner = null;

/**
 * Cria (uma única vez) um elemento invisível com a mesma fonte do editor,
 * usado para medir a largura real de um caractere.
 */
function ensureProbe(owner) {
  if (probe && probe.isConnected && probeOwner === owner) return probe;
  if (probe) probe.remove();
  probeOwner = owner;
  probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "pointer-events:none",
    "white-space:pre",
    "top:0",
    "left:0",
    "width:auto",
    "height:auto",
  ].join(";");
  probe.textContent = "0".repeat(100);
  owner.appendChild(probe);
  return probe;
}

/**
 * Lê a métrica REAL do textarea do editor.
 * @param {HTMLElement} textarea
 * @returns {typeof FALLBACK}
 */
export function measureEditor(textarea) {
  if (!textarea || !textarea.isConnected) return cached;
  const style = getComputedStyle(textarea);
  const px = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  // A largura do caractere é medida, nunca presumida: fontes diferentes
  // (Cascadia Code, JetBrains Mono, Consolas) têm larguras diferentes.
  const probeElement = ensureProbe(textarea.parentElement ?? document.body);
  probeElement.style.font = style.font;
  probeElement.style.letterSpacing = style.letterSpacing;
  probeElement.style.wordSpacing = style.wordSpacing;
  probeElement.style.tabSize = style.tabSize;
  const width100 = probeElement.getBoundingClientRect().width;
  const charWidth = width100 > 0 ? width100 / 100 : FALLBACK.charWidth;

  const lineHeightRaw = style.lineHeight;
  const lineHeight = lineHeightRaw === "normal"
    ? Math.round(px(style.fontSize) * 1.5)
    : px(lineHeightRaw) || FALLBACK.lineHeight;

  cached = {
    charWidth,
    lineHeight,
    fontSize: px(style.fontSize),
    paddingTop: px(style.paddingTop),
    paddingRight: px(style.paddingRight),
    paddingBottom: px(style.paddingBottom),
    paddingLeft: px(style.paddingLeft),
    gutterWidth: Math.max(0, px(style.paddingLeft) - 11),
  };
  return cached;
}

/** Última métrica medida (sem reler o DOM). */
export function editorMetrics() {
  return cached;
}

/**
 * Verifica se o realce e o textarea estão alinhados.
 * Usado pelo autodiagnóstico e pelos testes de regressão: se alguém
 * reintroduzir uma diferença de CSS, isso acusa em vez de "corrigir" com
 * um deslocamento artificial.
 *
 * @returns {{aligned:boolean, differences:string[], metrics:object}}
 */
export function verifyAlignment(textarea, highlight) {
  const metrics = measureEditor(textarea);
  const differences = [];
  if (!highlight) return { aligned: true, differences, metrics };

  const read = (element) => {
    const style = getComputedStyle(element);
    return [
      ["font-family", style.fontFamily],
      ["font-size", style.fontSize],
      ["line-height", style.lineHeight],
      ["letter-spacing", style.letterSpacing],
      ["word-spacing", style.wordSpacing],
      ["tab-size", style.tabSize],
      ["padding-top", style.paddingTop],
      ["padding-right", style.paddingRight],
      ["padding-bottom", style.paddingBottom],
      ["padding-left", style.paddingLeft],
      ["box-sizing", style.boxSizing],
      ["text-indent", style.textIndent],
    ];
  };

  for (const [key, value] of read(textarea)) {
    const mirror = read(highlight).find(([name]) => name === key)?.[1];
    if (mirror !== value) differences.push(`${key}: textarea=${value} · realce=${mirror}`);
  }

  // A altura de UMA linha do realce tem de ser exatamente uma linha de código.
  const firstLine = highlight.querySelector(".code-line");
  if (firstLine) {
    const height = firstLine.getBoundingClientRect().height;
    if (Math.abs(height - metrics.lineHeight) > 0.6) {
      differences.push(`altura da linha do realce: ${height}px · esperado ${metrics.lineHeight}px`);
    }
  }

  // Duas linhas consecutivas do realce não podem ter um vão entre elas.
  const lines = highlight.querySelectorAll(".code-line");
  if (lines.length > 1) {
    const a = lines[0].getBoundingClientRect();
    const b = lines[1].getBoundingClientRect();
    const step = b.top - a.top;
    if (Math.abs(step - metrics.lineHeight) > 0.6) {
      differences.push(`passo entre linhas: ${step}px · esperado ${metrics.lineHeight}px`);
    }
  }

  return { aligned: differences.length === 0, differences, metrics };
}

/**
 * Converte (linha, coluna) 1-based na posição em pixels DENTRO do textarea.
 * É o mesmo cálculo que o navegador faz ao clicar — sem deslocamento falso.
 */
export function caretToPoint(textarea, line, column) {
  const metrics = editorMetrics();
  return {
    x: metrics.paddingLeft + (column - 1) * metrics.charWidth - textarea.scrollLeft,
    y: metrics.paddingTop + (line - 1) * metrics.lineHeight - textarea.scrollTop,
  };
}

/**
 * Converte a posição do mouse na caixa do textarea em {line, column} 1-based.
 * Usado só para tooltip/hover — o clique real é do próprio navegador.
 */
export function pointToCaret(textarea, clientX, clientY) {
  const rect = textarea.getBoundingClientRect();
  const metrics = editorMetrics();
  const scaleX = rect.width ? textarea.clientWidth / rect.width : 1;
  const scaleY = rect.height ? textarea.clientHeight / rect.height : 1;
  const x = (clientX - rect.left) * scaleX + textarea.scrollLeft;
  const y = (clientY - rect.top) * scaleY + textarea.scrollTop;

  const column = Math.max(1, Math.round((x - metrics.paddingLeft) / metrics.charWidth) + 1);
  const line = Math.max(1, Math.floor((y - metrics.paddingTop) / metrics.lineHeight) + 1);
  return { line, column };
}

export default { measureEditor, editorMetrics, verifyAlignment, caretToPoint, pointToCaret, FALLBACK };

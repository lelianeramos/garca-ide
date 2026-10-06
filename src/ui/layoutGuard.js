/**
 * VERIFICADOR DE LAYOUT DE BLOCOS
 * ==============================
 * Item #32 do pedido: "NENHUM BLOCO PODE FICAR SOBRE OUTRO" é critério de
 * FALHA de implementação, não uma observação estética.
 *
 * Por que isso existe mesmo com o fluxo corrigido: o fluxo de caixa resolve a
 * sobreposição estrutural, mas há caminhos que escrevem posição à mão
 * (transform de arraste, pan, zoom). Um verificador explícito transforma
 * "achismo que não quebrou" em "está provado que não quebrou", e roda depois
 * de cada operação.
 *
 * Item #33: um bloco dentro de um `se` NÃO é sobreposição indevida. Por isso
 * a checagem percorre a ÁRVORE e ignora pares em relação ancestral, em vez
 * de comparar retângulos às cegas.
 *
 * Não existe "auto-corrigir posição": a correção da causa é o fluxo. Se o
 * verificador accusationar algo, é bug de estrutura e precisa ser consertado
 * na origem, não com um `top` calculado.
 */

/** Tolerância em px:ímperfeição de subpixel de renderização. */
const TOLERANCE = 2;

/**
 * @param {Element} root container com os `.program-block`
 * @returns {{ok:boolean, overlaps:Array, orphans:Array, sizes:Array}}
 */
export function verifyLayout(root) {
  const blocks = [...root.querySelectorAll(".program-block")];
  const overlaps = [];

  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i];
      const b = blocks[j];
      // §33: relação ancestral = encaixe legítimo, não sobreposição.
      if (a.contains(b) || b.contains(a)) continue;

      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapX > TOLERANCE && overlapY > TOLERANCE) {
        overlaps.push({
          a: a.dataset.schema ?? a.dataset.blockId,
          b: b.dataset.schema ?? b.dataset.blockId,
          x: Math.round(overlapX),
          y: Math.round(overlapY),
        });
      }
    }
  }

  // Bloco com bounding box de área zero não está sendo renderizado.
  const orphans = blocks
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 1 || r.height < 1;
    })
    .map((el) => el.dataset.schema ?? el.dataset.blockId);

  // Pilha aninhada fora do fluxo é a regressão que causou a sobreposição;
  // detectar aqui é mais barato do que depurar coordenadas.
  const badStacks = [...root.querySelectorAll(".block-stack:not(.gb-stack-root)")]
    .filter((el) => getComputedStyle(el).position !== "static")
    .map((el) => el.className);

  const sizes = blocks.map((el) => {
    const r = el.getBoundingClientRect();
    return { schema: el.dataset.schema, width: Math.round(r.width), height: Math.round(r.height) };
  });

  return { ok: overlaps.length === 0 && orphans.length === 0 && badStacks.length === 0, overlaps, orphans, badStacks, sizes };
}

/**
 * Relatório curto para o console do desenvolvedor.
 * @returns {string}
 */
export function describeLayout(report) {
  if (report.ok) return `layout ok — ${report.sizes.length} blocos, nenhuma sobreposição`;
  const parts = [];
  if (report.overlaps.length) parts.push(`${report.overlaps.length} sobreposição(ões): ` + report.overlaps.map((o) => `${o.a} X ${o.b} (${o.x}x${o.y}px)`).join(", "));
  if (report.orphans.length) parts.push(`blocos sem área: ${report.orphans.join(", ")}`);
  if (report.badStacks.length) parts.push(`pilha fora do fluxo: ${report.badStacks.join(", ")}`);
  return parts.join(" | ");
}

/**
 * O GUARDIÃO DE LAYOUT.
 *
 * O projeto já tem um verificador (`src/ui/layoutGuard.js`) que acusa bloco
 * sobre bloco, bloco sem área e pilha fora do fluxo. Aqui ele é testado com
 * geometria FINGIDA, porque um verificador que nunca accuse nada é pior do
 * que não existir: dá confiança falsa.
 *
 * O teste também roda o verificador sobre a árvore REAL produzida pelo
 * renderizador, para garantir que a estrutura que o renderizador cria é
 * aceita pelo próprio fiscal do projeto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { verifyLayout } from "../src/ui/layoutGuard.js";
import { SyncManager } from "../src/editor/syncManager.js";
import { renderStack } from "../src/blocks/blockRenderer.js";

/* ---------- DOM com geometria controlada ---------- */

function domComCaixas(caixas) {
  // Cada elemento recebe a caixa pedida; a árvore é montada à mão.
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
  globalThis.document = document;
  globalThis.window = window;
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.getComputedStyle = window.getComputedStyle ?? (() => ({ position: "static" }));
  return { document, window };
}

/* ---------- o verificador acusa o que deve ser acusado ---------- */

test("acusar sobreposição real entre dois blocos irmãos", () => {
  const { document } = domComCaixas();
  const root = document.createElement("div");
  const a = document.createElement("div");
  const b = document.createElement("div");
  for (const el of [a, b]) {
    el.className = "program-block";
    el.dataset.schema = "var_set";
    root.appendChild(el);
  }
  a.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 });
  b.getBoundingClientRect = () => ({ left: 50, top: 20, right: 250, bottom: 60, width: 200, height: 40 });

  const r = verifyLayout(root);
  assert.equal(r.ok, false, "o verificador deixou passar uma sobreposição real");
  assert.equal(r.overlaps.length, 1);
  assert.equal(r.overlaps[0].x, 150);
  assert.equal(r.overlaps[0].y, 20);
});

test("não acusar blocos que só se encostam", () => {
  const { document } = domComCaixas();
  const root = document.createElement("div");
  const a = document.createElement("div");
  const b = document.createElement("div");
  for (const el of [a, b]) { el.className = "program-block"; el.dataset.schema = "var_set"; root.appendChild(el); }
  a.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 });
  b.getBoundingClientRect = () => ({ left: 0, top: 40, right: 200, bottom: 80, width: 200, height: 40 });

  assert.equal(verifyLayout(root).overlaps.length, 0,
    "blocos empilhados em sequência não são sobreposição");
});

test("não acusar filho dentro do pai (encaixe legítimo)", () => {
  const { document } = domComCaixas();
  const root = document.createElement("div");
  const pai = document.createElement("div");
  const filho = document.createElement("div");
  pai.className = "program-block";
  filho.className = "program-block";
  pai.dataset.schema = "control_if";
  filho.dataset.schema = "var_set";
  pai.appendChild(filho);
  root.appendChild(pai);
  // Mesma caixa: o filho está DENTRO do pai, o que é o esperado num C-block.
  pai.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 });
  filho.getBoundingClientRect = () => ({ left: 10, top: 40, right: 190, bottom: 60, width: 180, height: 20 });

  assert.equal(verifyLayout(root).overlaps.length, 0,
    "encaixe de bloco dentro de bloco não é sobreposição indevida");
});

test("acusar bloco sem área (não renderizado)", () => {
  const { document } = domComCaixas();
  const root = document.createElement("div");
  const el = document.createElement("div");
  el.className = "program-block";
  el.dataset.schema = "var_set";
  root.appendChild(el);
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });

  const r = verifyLayout(root);
  assert.equal(r.ok, false);
  assert.deepEqual(r.orphans, ["var_set"]);
});

test("acusar pilha fora do fluxo (a regressão da sobreposição)", () => {
  const { document } = domComCaixas();
  const root = document.createElement("div");
  const pilha = document.createElement("div");
  pilha.className = "block-stack";
  root.appendChild(pilha);
  globalThis.getComputedStyle = () => ({ position: "absolute" });

  const r = verifyLayout(root);
  assert.equal(r.ok, false, "pilha absoluta dentro do canvas precisa ser acusada");
  assert.equal(r.badStacks.length, 1);
});

/* ---------- a árvore real do renderizador é aceita ---------- */

test("a árvore que o renderizador produz passa no verificador", async () => {
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
  globalThis.document = document;
  globalThis.window = window;
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.getComputedStyle = () => ({ position: "static" });

  /*
   * Geometria que REFLETE A ÁRVORE: cada bloco ocupa a faixa vertical
   * correspondente à sua profundidade dentro do pai, e a largura do pai.
   *
   * Dar a mesma caixa para todo mundo faria o verificador acusar
   * sobreposição onde não há — o teste mediria o mock, não o renderizador.
   * Aqui irmãos ficam em faixas distintas, e filho fica DENTRO do pai, que é
   * a relação que o verificador trata como encaixe legítimo.
   */
  const caixas = new WeakMap();
  const medir = (el) => {
    if (caixas.has(el)) return caixas.get(el);
    const paiBloco = el.parentElement?.closest?.(".program-block");
    const faixa = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
    const recuo = paiBloco ? 16 : 0;
    const top = faixa * 40;
    const caixa = {
      left: recuo, top, right: 200, bottom: top + 36,
      width: 200 - recuo, height: 36,
    };
    caixas.set(el, caixa);
    return caixa;
  };
  for (const El of [window.Element, window.HTMLElement]) {
    if (El.prototype.__patched) continue;
    El.prototype.getBoundingClientRect = function () { return medir(this); };
    El.prototype.__patched = true;
  }

  const stack = document.createElement("div");
  stack.className = "block-stack gb-stack gb-stack-root";
  document.body.appendChild(stack);

  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.hubs import PrimeHub\n\n" +
    "def main():\n    hub = PrimeHub()\n    x = 1\n    y = 2\n\nmain()\n",
  );
  renderStack(sm.blocks, stack, {});

  const r = verifyLayout(stack);
  assert.equal(r.overlaps.length, 0, `sobreposição na árvore real: ${JSON.stringify(r.overlaps)}`);
  assert.equal(r.orphans.length, 0, `bloco sem área: ${JSON.stringify(r.orphans)}`);
  assert.equal(r.badStacks.length, 0,
    `pilha fora do fluxo: ${JSON.stringify(r.badStacks)} — o renderizador tem que aplicar gb-stack`);
  assert.ok(r.sizes.length >= 3, "os blocos têm que ser medidos");
});

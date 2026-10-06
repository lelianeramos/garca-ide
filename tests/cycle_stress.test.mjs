/**
 * VARREDURA DE CICLOS DE VIDA — cada operação que a criança faz, repetida.
 *
 * A estratégia éruns: para cada operação (digitar, apagar bloco, inserir,
 * remover, desfazer, colar), executamos a sequência muitas vezes e verificamos
 * TRÊS invariantes que, se quebrarem, correspondem a bugs que a criança vê:
 *
 *   1. NENHUM BLOCO DUPLICADO na tela;
 *   2. NENHUMA LINHA PERDIDA (código não chega a sumir em silêncio);
 *   3. O BLOCO APAGADO CONTINUA APAGADO (não ressuscita no ciclo seguinte).
 *
 * A última é a que responde "quando tento apagar o bloco duplicado ele não
 * apaga": um bloco que reaparece no ciclo seguinte é um bloco que a criança
 * não consegue tirar da tela.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { SyncManager } from "../src/editor/syncManager.js";
import { renderStack } from "../src/blocks/blockRenderer.js";
import { verifyLayout } from "../src/ui/layoutGuard.js";

const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.document = document;
globalThis.window = window;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.getComputedStyle = () => ({ position: "static" });

const PROGRAMA = `from pybricks.hubs import PrimeHub
from pybricks.motor import Motor
from pybricks.parameters import Port

def main():
    hub = PrimeHub()
    esq = Motor(Port.B)
    va = 5
    y = 6
    if va > 1:
        hub.speaker.beep(500)
    else:
        hub.speaker.beep(100)
    for i in range(3):
        esq.run_angle(90)

main()
`;

function ambiente() {
  const stack = document.createElement("div");
  stack.className = "block-stack gb-stack gb-stack-root";
  document.body.appendChild(stack);
  return stack;
}

const desenhar = (sm, stack) => {
  renderStack(sm.blocks, stack, {});
  const contagem = new Map();
  for (const el of stack.querySelectorAll("[data-block-id]")) {
    contagem.set(el.dataset.blockId, (contagem.get(el.dataset.blockId) ?? 0) + 1);
  }
  return contagem;
};

const duplicados = (c) => [...c.entries()].filter(([, n]) => n > 1).map(([id]) => id);

const achatar = (lista, out = []) => {
  for (const b of lista ?? []) { out.push(b); achatar(b.children, out); achatar(b.elseChildren, out); }
  return out;
};

/* ------------------------------------------------------------------ */

test("30 rodadas de digitação não duplicam nem perdem linha", () => {
  const stack = ambiente();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  const original = sm.code;
  for (let i = 0; i < 30; i += 1) {
    const nome = ["va", "v", "valor", "velocidade", "v", "va"][i % 6];
    sm.runPipeline(original.replace("    va = 5", `    ${nome} = 5`));
    const dups = duplicados(desenhar(sm, stack));
    assert.equal(dups.length, 0, `rodada ${i} (nome "${nome}") duplicou: ${dups.join(", ")}`);
  }
});

test("30 vezes apagar e reinserir o mesmo bloco", () => {
  const stack = ambiente();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);
  const comBloco = sm.code;

  for (let i = 0; i < 30; i += 1) {
    // Apaga a última linha do corpo do main e reescreve.
    const alvo = achatar(sm.blocks).reverse().find((b) => b.source && b.blockId !== "event_program_start");
    if (!alvo) break;
    const antes = sm.code;
    sm.removeBlockFromCode(alvo);
    const dups = duplicados(desenhar(sm, stack));
    assert.equal(dups.length, 0, `rodada ${i}: duplicou ao apagar: ${dups.join(", ")}`);
    sm.runPipeline(antes);
    desenhar(sm, stack);
  }
  assert.match(sm.code, /speaker\.beep\(500\)/, "o programa tem que voltar ao original");
  assert.equal(sm.code.split("speaker.beep").length - 1, 2,
    `o corpo não pode encher de linhas:\n${sm.code}`);
});

test("o bloco apagado não ressuscita no ciclo seguinte", () => {
  const stack = ambiente();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  const alvo = achatar(sm.blocks).find((b) => b.blockId === "var_set");
  const idAlvo = alvo.id;
  const linha = alvo.source.startLine;

  sm.removeBlockFromCode(alvo);
  desenhar(sm, stack);

  // Três redesenhos: o bloco não pode reaparecer.
  for (let i = 0; i < 3; i += 1) {
    sm.runPipeline(sm.code);
    const contagem = desenhar(sm, stack);
    assert.equal(contagem.has(idAlvo), false,
      `o bloco ${idAlvo} (linha ${linha}) ressuscitou no redesenho ${i}`);
  }
  assert.ok(!sm.code.split("\n")[linha - 1]?.includes("= 5"),
    `a linha removida voltou:\n${sm.code}`);
});

test("alternar entre dois programas não deixa resíduo do anterior", () => {
  const stack = ambiente();
  const sm = new SyncManager();
  const A = "def main():\n    x = 1\n\nmain()\n";
  const B = "def main():\n    hub = PrimeHub()\n    y = 2\n    z = 3\n\nmain()\n";

  sm.runPipeline(A); desenhar(sm, stack);
  const quantosA = desenhar(sm, stack).size;

  for (let i = 0; i < 20; i += 1) {
    sm.runPipeline(B);
    const d = duplicados(desenhar(sm, stack));
    assert.equal(d.length, 0, `rodada ${i} (B) duplicou: ${d.join(", ")}`);
    sm.runPipeline(A);
    const d2 = duplicados(desenhar(sm, stack));
    assert.equal(d2.length, 0, `rodada ${i} (A) duplicou: ${d2.join(", ")}`);
    assert.equal(desenhar(sm, stack).size, quantosA,
      `rodada ${i}: sobraram blocos do programa B`);
  }
});

test("blocos em C aninhados três níveis não se misturam", () => {
  const stack = ambiente();
  const sm = new SyncManager();
  sm.runPipeline(
    "def main():\n" +
    "    if a:\n" +
    "        for i in range(3):\n" +
    "            if b:\n" +
    "                x = 1\n\nmain()\n",
  );
  desenhar(sm, stack);
  assert.equal(duplicados(desenhar(sm, stack)).length, 0);

  // Cada cavidade tem exatamente uma pilha interna.
  for (const cavidade of stack.querySelectorAll(".gb-cavity")) {
    const pilhas = cavidade.querySelectorAll(":scope > .block-stack");
    assert.equal(pilhas.length, 1,
      `uma cavidade com ${pilhas.length} pilhas — os corpos se sobrepõem`);
  }
});

test("50 redesenhos seguidos do mesmo programa são idempotentes", () => {
  const stack = ambiente();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  const uma = desenhar(sm, stack).size;
  const html = stack.innerHTML;
  for (let i = 0; i < 50; i += 1) desenhar(sm, stack);
  assert.equal(desenhar(sm, stack).size, uma, "o número de blocos mudou sem o código mudar");
  assert.equal(stack.innerHTML, html, "o HTML mudou sem o código mudar");
});

test("a árvore final passa no verificador de layout", () => {
  const stack = ambiente();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  for (let i = 0; i < 10; i += 1) {
    sm.runPipeline(PROGRAMA.replace("va = 5", `v${"a".repeat(i)} = 5`));
    desenhar(sm, stack);
    const r = verifyLayout(stack);
    assert.equal(r.overlaps.length, 0, `sobreposição na rodada ${i}: ${JSON.stringify(r.overlaps)}`);
    assert.equal(r.badStacks.length, 0, `pilha fora do fluxo na rodada ${i}: ${JSON.stringify(r.badStacks)}`);
  }
});

test("o número de linhas do código nunca encolhe sozinho", () => {
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  const inicial = sm.code.split("\n").filter((l) => l.trim()).length;
  for (let i = 0; i < 25; i += 1) {
    sm.runPipeline(PROGRAMA.replace("    va = 5", `    v${i} = 5`));
    const agora = sm.code.split("\n").filter((l) => l.trim()).length;
    assert.equal(agora, inicial,
      `rodada ${i}: o código encolheu de ${inicial} para ${agora} — linha perdida`);
  }
});

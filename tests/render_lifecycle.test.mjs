/**
 * CICLO DE VIDA DO CANVAS — o que a criança realmente vê e faz.
 *
 * Estes testes usam um DOM de verdade (linkedom) e exercitam o caminho
 * completo: digitar no editor -> reconciliar -> desenhar -> apagar.
 *
 * Os bugs que eles caçam:
 *
 *   - DUPLICAÇÃO: dois elementos na mesma posição, um por cima do outro,
 *     depois de digitar/apagar dentro de um bloco aninhado;
 *   - FOCO: o elemento que a criança está digitando é destruído;
 *   - REMOÇÃO: apagar um bloco não tira nada da tela;
 *   - CSS: um bloco dentro de outro tem caixa menor que o conteúdo, ou
 *     aparece com tamanho zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { SyncManager } from "../src/editor/syncManager.js";
import { renderStack, clearStack, renderBlock } from "../src/blocks/blockRenderer.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";

/* ------------------------------------------------------------------ */
/* Ambiente de DOM                                                     */
/* ------------------------------------------------------------------ */

const { document, window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.document = document;
globalThis.window = window;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;

function novoCanvas() {
  const el = document.createElement("div");
  el.className = "workspace";
  document.body.appendChild(el);
  const stack = document.createElement("div");
  stack.className = "block-stack";
  el.appendChild(stack);
  return { el, stack };
}

/** Desenha e devolve a quantidade de elementos por bloco lógico. */
function desenhar(sm, stack) {
  renderStack(sm.blocks, stack, {});
  return contarPorId(stack);
}

/** Blocos com o MESMO id de bloco lógico appearing mais de uma vez. */
function contarPorId(stack) {
  const vistos = new Map();
  for (const el of stack.querySelectorAll("[data-block-id]")) {
    const id = el.dataset.blockId;
    if (!id) continue;
    vistos.set(id, (vistos.get(id) ?? 0) + 1);
  }
  return vistos;
}

const duplicados = (contagem) => [...contagem.entries()].filter(([, n]) => n > 1);

const PROGRAMA = `from pybricks.hubs import PrimeHub
from pybricks.motor import Motor
from pybricks.parameters import Port

def main():
    hub = PrimeHub()
    esq = Motor(Port.B)
    va = 5
    y = 6

main()
`;

/* ------------------------------------------------------------------ */
/* 1. Duplicação ao digitar                                            */
/* ------------------------------------------------------------------ */

test("digitar dentro de um bloco do chapéu não duplica nada", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();

  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  // A criança apaga caracteres do nome da variável, um por vez.
  for (const nome of ["va", "v", "", "n", "no", "nov"]) {
    sm.runPipeline(PROGRAMA.replace("    va = 5", `    ${nome} = 5`));
    const contagem = desenhar(sm, stack);
    const dups = duplicados(contagem);
    assert.equal(dups.length, 0,
      `duplicou com o nome "${nome}": ${JSON.stringify(dups)}`);
  }
});

test("o bloco dentro do chapéu mantém a identidade enquanto se digita", () => {
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  const chapeu = sm.blocks[0];
  const chapeuId = chapeu.id;
  const filhoId = chapeu.children.find((b) => b.blockId === "var_set")?.id;

  sm.runPipeline(PROGRAMA.replace("    va = 5", "    v = 5"));
  assert.equal(sm.blocks[0].id, chapeuId, "o chapéu não pode trocar de id a cada tecla");
  const filho = sm.blocks[0].children.find((b) => b.blockId === "var_set");
  assert.equal(filho?.id, filhoId, "o bloco digitado não pode trocar de id a cada tecla");
});

test("adicionar e remover linhas dentro do chapéu não deixa resíduo", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);
  const antes = desenhar(sm, stack).size;

  // Acrescenta três linhas no corpo do main.
  const maior = PROGRAMA.replace("    y = 6", "    y = 6\n    z = 7\n    w = 8\n    q = 9");
  sm.runPipeline(maior);
  const depois = desenhar(sm, stack).size;
  assert.ok(depois > antes, "as linhas novas precisam aparecer");
  assert.equal(duplicados(desenhar(sm, stack)).length, 0, "nada pode duplicar");

  // E volta ao original: nada sobra no DOM.
  sm.runPipeline(PROGRAMA);
  const voltou = desenhar(sm, stack);
  assert.equal(voltou.size, antes, `sobraram ${voltou.size - antes} elementos no canvas`);
  assert.equal(duplicados(voltou).length, 0);
});

test("apagar o bloco some da tela, não vira cópia", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  const alvo = sm.blocks[0].children.find((b) => b.blockId === "var_set");
  const idAlvo = alvo.id;
  assert.ok(alvo, "o bloco alvo precisa existir");

  sm.removeBlockFromCode(alvo);
  const contagem = desenhar(sm, stack);

  assert.equal(contagem.has(idAlvo), false,
    `o bloco ${idAlvo} continua na tela depois de apagado`);
  assert.equal(duplicados(contagem).length, 0);
});

test("apagar o mesmo bloco duas vezes não ressuscita nada", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  const alvo = sm.blocks[0].children.find((b) => b.blockId === "var_set");
  sm.removeBlockFromCode(alvo);
  desenhar(sm, stack);
  const meio = desenhar(sm, stack).size;

  // Segundo pedido de remoção, agora com o bloco já fora do código.
  sm.removeBlockFromCode(alvo);
  const fim = desenhar(sm, stack);
  assert.equal(fim.size, meio, "a segunda remoção não pode alterar a tela");
  assert.equal(duplicados(fim).length, 0);
});

/* ------------------------------------------------------------------ */
/* 2. Foco — o campo digitado não pode ser destruído                    */
/* ------------------------------------------------------------------ */

test("o elemento com foco não é reconstruído ao atualizar", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  // A criança clica no campo e começa a digitar.
  const campo = stack.querySelector('[data-field="name"]');
  assert.ok(campo, "o campo de nome precisa existir");
  campo.focus?.();

  // Atualiza o valor do bloco por baixo (o que o `input` faz a cada tecla).
  const bloco = sm.blocks[0].children.find((b) => b.blockId === "var_set");
  bloco.params.name = "vai";
  renderStack(sm.blocks, stack, {});

  const depois = stack.querySelector('[data-field="name"]');
  assert.equal(depois, campo, "o input foi recriado: o cursor da criança se perde");
});

/* ------------------------------------------------------------------ */
/* 3. Estrutura: pai contém filho, e o CSS tem base para funcionar    */
/* ------------------------------------------------------------------ */

test("todo bloco desenhado tem classe, id e caixa", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  const blocos = stack.querySelectorAll("[data-block-id]");
  assert.ok(blocos.length >= 4, `esperava vários blocos, veio ${blocos.length}`);
  for (const el of blocos) {
    assert.ok(el.classList.contains("program-block"),
      `o bloco ${el.dataset.blockId} não tem a classe program-block (o CSS não se aplica)`);
    assert.ok(el.dataset.schema, `o bloco ${el.dataset.blockId} não tem data-schema`);
    assert.ok(el.textContent.trim().length > 0,
      `o bloco ${el.dataset.blockId} ficou sem texto`);
  }
});

test("o corpo de um bloco em C fica DENTRO dele, não como irmão", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);

  const chapéu = stack.querySelector('[data-schema="event_program_start"]');
  assert.ok(chapéu, "o chapéu precisa estar desenhado");
  const cavidade = chapéu.querySelector('.gb-cavity[data-slot="children"]');
  assert.ok(cavidade, "o chapéu precisa da cavidade de corpo");
  const filhos = cavidade.querySelectorAll("[data-block-id]");
  assert.ok(filhos.length >= 3,
    `o corpo do chapéu deveria conter os blocos do main(), tem ${filhos.length}`);
});

test("blocos aninhados não ganham a classe de bloco de primeira classe", () => {
  const sm = new SyncManager();
  sm.runPipeline("correcao = erro * KP_STRAIGHT\n");
  const { stack } = novoCanvas();
  desenhar(sm, stack);

  const aninhado = stack.querySelector(".gb-nested-block");
  assert.ok(aninhado, "o operador aninhado precisa ser desenhado");
  assert.equal(aninhado.classList.contains("program-block"), false,
    "bloco dentro de socket não pode virar bloco de primeira classe ( quebraria o layout)");
  assert.ok(aninhado.dataset.nestedId, "o aninhado precisa de identificação própria");
});

test("renderizar duas vezes no mesmo lugar não empilha", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  for (let i = 0; i < 5; i += 1) desenhar(sm, stack);
  const contagem = desenhar(sm, stack);
  assert.equal(duplicados(contagem).length, 0,
    `cinco redesenhos empilharam blocos: ${JSON.stringify(duplicados(contagem))}`);
});

test("limpar o canvas remove tudo", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline(PROGRAMA);
  desenhar(sm, stack);
  assert.ok(stack.querySelectorAll("[data-block-id]").length > 0);
  clearStack(stack);
  assert.equal(stack.querySelectorAll("[data-block-id]").length, 0,
    "o canvas ficou com blocos depois de limpar");
});

/* ------------------------------------------------------------------ */
/* 4. Identidade em sequências com irmãos iguais                        */
/* ------------------------------------------------------------------ */

test("dois blocos iguais em sequência são dois elementos", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    x = 1\n    x = 1\n\nmain()\n");
  // São TRÊS elementos: o chapéu e os dois `var_set` do corpo dele.
  const contagem = desenhar(sm, stack);
  assert.equal(contagem.size, 3, `as duas linhas precisam virar dois blocos, veio ${contagem.size}`);
  assert.equal(duplicados(contagem).length, 0, "ids repetidos no mesmo nível");
});

test("apagar o primeiro de dois irmãos não move o segundo", () => {
  const { stack } = novoCanvas();
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    x = 1\n    y = 2\n\nmain()\n");
  desenhar(sm, stack);
  const idPrimeiro = sm.blocks[0].children[0].id;
  const idSegundo = sm.blocks[0].children[1].id;

  sm.removeBlockFromCode(sm.blocks[0].children[0]);
  desenhar(sm, stack);
  assert.equal(sm.blocks[0].children[0].id, idSegundo,
    "o segundo irmão herdou o id do primeiro");
  assert.notEqual(sm.blocks[0].children[0].id, idPrimeiro);
});

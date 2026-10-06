/* ==================================================================
 * OS CONTROLES SEMÂNTICOS NO DOM
 * ==================================================================
 *
 * `semantic_pipeline` prova que o bloco e o Python estão certos. Este
 * prova que a EDIÇÃO funciona: que trocar "frente" por "trás" muda o
 * Python, e que trocar "mm/s" por "cm/s" converte o número.
 *
 * Esses são os dois momentos em que a criança mexe no programa e espera
 * que o robô faça outra coisa. Se o dropdown só mudar a tela e o Python
 * ficar igual, o bloco é uma mentira — e é o tipo de erro que só
 * aparece na pista.
 *
 * Os testes chamam `Workspace.handleSemanticControl` DE VERDADE, pelo
 * mesmo caminho que o clique usa. Uma cópia da lógica passaria mesmo com
 * o handler quebrado, que é justamente o que estes testes vêm caçar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { parseProgram } from "../src/parser/pythonParser.js";
import { extractSymbols, librarySymbols } from "../src/semantic/analyzer.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";
import { renderBlock } from "../src/blocks/blockRenderer.js";
import { blockToPython } from "../src/python/codeGenerator.js";
import { Workspace } from "../src/ui/workspace.js";

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

/* ------------------------------------------------------------------ */
/* Biblioteca e montagem                                                */
/* ------------------------------------------------------------------ */

const MOVIMENTO = `def gb_move(gb, hub, distancia, velocidade=300):
    """Move o robô em linha reta.

    Args:
        distancia: quanto o robô anda, em milímetros.
                   Positivo move para frente, negativo move para trás.
        velocidade: em milímetros por segundo.
    """
    gb.straight(distancia, velocidade)
`;

const BIBLIOTECA = librarySymbols([
  { path: "movimento.py", content: MOVIMENTO, symbols: extractSymbols(parseProgram(MOVIMENTO).ir) },
]);

/** Bloco de biblioteca + elemento no DOM + Workspace pronto para o handler. */
function montar(programa, biblioteca = BIBLIOTECA) {
  const { ir } = parseProgram(programa);
  const { blocks } = irToBlocks(ir, { libraryFunctions: biblioteca, sourceText: programa });
  const bloco = blocks[0];

  const host = document.createElement("div");
  host.className = "workspace";
  document.body.appendChild(host);

  const elemento = renderBlock(bloco);
  elemento.classList.add("program-block");
  elemento.dataset.blockId = bloco.id;
  host.appendChild(elemento);

  const mudancas = [];
  const ws = Object.create(Workspace.prototype);
  ws.find = () => bloco;
  ws.onBlockChange = (_b, opcoes) => mudancas.push(opcoes);

  return { bloco, elemento, ws, mudancas };
}

/**
 * Escolhe uma opção do `<select>` e passa pelo handler real.
 *
 * `select.value = x` não funciona no linkedom (propriedade somente
 * leitura); marcar a `<option>` como selecionada é o caminho suportado e
 * faz `select.value` refletir a escolha — que é o que o handler lê.
 */
function escolher(sel, ws, valor) {
  sel.querySelector(`option[value="${valor}"]`).selected = true;
  ws.handleSemanticControl({ target: sel }, true);
}

/**
 * Digita num campo pelo handler REAL.
 *
 * Escrever direto em `params.fields[n].value` passaria mesmo com o
 * `handleField` quebrado — e ele ESTAVA quebrado: a escrita ia para uma
 * chave literal "fields.1.value" e a lista nunca mudava. Digitar na tela
 * é o que pega esse tipo de erro.
 */
function digitar(campo, bloco, texto, ws) {
  campo.value = texto;
  ws.handleField({ target: campo }, true);
}

/* ================================================================== */
/* O DROPDOWN DE DIREÇÃO                                               */
/* ================================================================== */

test("o dropdown existe e vem com a direção que o Python indica", () => {
  const { elemento } = montar("gb_move(gb, hub, -100)");
  const select = elemento.querySelector("[data-direction-for]");

  assert.ok(select, "o campo de direção precisa ser desenhado");
  assert.equal(select.value, "tras", "-100 no Python é para trás");
  assert.equal(select.options.length, 2);
});

test("trocar para trás inverte o sinal no Python", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, 100)");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, 100)");

  escolher(elemento.querySelector("[data-direction-for]"), ws, "tras");

  assert.equal(bloco.params.fields[0].sign, -1, "a opção de trás carrega o sinal -1");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, -100)");
});

test("voltar para frente desfaz a inversão", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, -100)");

  escolher(elemento.querySelector("[data-direction-for]"), ws, "frente");

  assert.equal(blockToPython(bloco), "gb_move(gb, hub, 100)");
});

test("o número digitado continua mandando depois da troca de direção", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, 100)");
  digitar(elemento.querySelector('[data-field="fields.0.value"]'), bloco, "250", ws);

  escolher(elemento.querySelector("[data-direction-for]"), ws, "tras");

  assert.equal(blockToPython(bloco), "gb_move(gb, hub, -250)");
});

test("trocou a direção e o número, e os dois valem", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, 100)");

  digitar(elemento.querySelector('[data-field="fields.0.value"]'), bloco, "75", ws);
  escolher(elemento.querySelector("[data-direction-for]"), ws, "tras");

  assert.equal(blockToPython(bloco), "gb_move(gb, hub, -75)");
});

test("a troca de direção notifica a mudança uma vez só", () => {
  const { elemento, ws, mudancas } = montar("gb_move(gb, hub, 100)");

  escolher(elemento.querySelector("[data-direction-for]"), ws, "tras");

  assert.equal(mudancas.length, 1, "um clique, uma mudança — duas fariam o histórico duplicar");
});

/* ================================================================== */
/* O SELETOR DE UNIDADE                                                */
/* ================================================================== */

test("o campo com unidade oferece as medidas do papel", () => {
  const { elemento } = montar("gb_move(gb, hub, 100, velocidade=300)");
  const select = elemento.querySelector("[data-unit-for]");

  assert.ok(select, "velocidade precisa ter seletor de unidade");
  assert.deepEqual([...select.options].map((o) => o.value), ["mm/s", "cm/s", "m/s"]);
});

test("valor em bloco não troca de unidade (o par tem de ficar inteiro)", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, distancia=1000)");
  const velocidade = bloco.params.fields[1];

  digitar(elemento.querySelector('[data-field="fields.1.value"]'), bloco, "300", ws);

  /*
   * Digitar ASSENTA na tela vira bloco (literal), que é a decisão do
   * projeto — não é texto solto. Um bloco aninhado não é número que se
   * possa converter, então a unidade NÃO muda: registrar "cm/s" ao lado de
   * um literal 300 faria o gerador mandar 3000 mm/s, e a tela e o robô
   * parariam de falar a mesma medida.
   */
  assert.equal(velocidade.unitKey, "mm/s");

  escolher(elemento.querySelector("[data-unit-for]"), ws, "cm/s");

  assert.equal(velocidade.unitKey, "mm/s", "unidade não troca com valor que não é número");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, distancia=1000, 300)");
});

test("um valor numérico solto é convertido ao trocar a unidade", () => {
  /*
   * A conversão numérica acontece quando o valor NÃO virou bloco: ele
   * chega ao gerador como texto, e aí a medida pode mudar de forma sem
   * perder o que a criança escreveu.
   */
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, distancia=1000)");
  const velocidade = bloco.params.fields[1];
  velocidade.value = "300";
  velocidade.unitKey = "mm/s";

  escolher(elemento.querySelector("[data-unit-for]"), ws, "cm/s");

  /*
   * 300 mm/s são 30 cm/s. O Python continua recebendo 300, porque é a
   * unidade que a função espera — a conversão é de ida e volta, e não
   * perde nada no caminho.
   */
  assert.equal(velocidade.value, "30");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, distancia=1000, 300)");
});

test("a conversão de unidade é estável na ida e volta", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, distancia=1000)");
  const velocidade = bloco.params.fields[1];
  velocidade.value = "300";
  velocidade.unitKey = "mm/s";

  const select = elemento.querySelector("[data-unit-for]");
  escolher(select, ws, "cm/s");
  assert.equal(velocidade.value, "30");

  escolher(select, ws, "mm/s");
  assert.equal(velocidade.value, "300");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, distancia=1000, 300)");
});

test("expressão não é convertida nem troca de unidade", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, distancia=1000)");
  const velocidade = bloco.params.fields[1];
  velocidade.value = "d * 2";
  velocidade.unitKey = "mm/s";

  const select = elemento.querySelector("[data-unit-for]");
  escolher(select, ws, "cm/s");

  /*
   * Recusar a conversão não pode ter efeito colateral. O campo era
   * ausente (a chamada não passava velocidade), e continua ausente: uma
   * troca de unidade que não deu em nada não tem por que acrescentar um
   * argumento ao programa da criança.
   */
  assert.equal(velocidade.value, "d * 2", "expressão não vira número");
  assert.equal(velocidade.unitKey, "mm/s");
  assert.equal(select.value, "mm/s", "o dropdown volta ao que vale");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, distancia=1000)");
});

test("digitar num campo opcional que estava vazio passa a valer", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, 100)");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, 100)", "não inventa argumento que não estava lá");

  digitar(elemento.querySelector('[data-field="fields.1.value"]'), bloco, "500", ws);

  assert.equal(blockToPython(bloco), "gb_move(gb, hub, 100, 500)");
});

test("campo apagado de volta ao vazio não deixa argumento fantasma", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, 100, 500)");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, 100, 500)");

  digitar(elemento.querySelector('[data-field="fields.1.value"]'), bloco, "", ws);

  /*
   * O campo esvaziado tem de sumir do Python. Deixar `500` lá seria um
   * argumento invisível, e apagar a tela não pode mudar o programa por
   * baixo dos panos.
   */
  assert.equal(bloco.params.fields[1].value, "");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, 100)");
});

/* ================================================================== */
/* EXPRESSÕES E BLOCOS ENCAIXADOS                                      */
/* ================================================================== */

test("expressão não ganha direção habilitada", () => {
  const { elemento } = montar("gb_move(gb, hub, distancia * 2)");
  const select = elemento.querySelector("[data-direction-for]");

  /*
   * A direção de uma expressão é INDETERMINADA. Habilitada, a criança
   * escolheria "frente" e o gerador inventaria um sinal que não estava
   * no Python.
   */
  assert.equal(select.disabled, true);
  assert.equal(elemento.querySelector('[data-field="fields.0.value"]').value, "distancia * 2");
});

test("o campo continua sendo socket de expressão", () => {
  const { elemento } = montar("gb_move(gb, hub, distancia)");
  const entrada = elemento.querySelector('[data-field="fields.0.value"]');

  /*
   * A classe `expr-field` é a MESMA dos sockets do resto do catálogo. É
   * isso que faz `distancia` poder virar um bloco encaixado, e não
   * apenas texto.
   */
  assert.ok(entrada.classList.contains("expr-field"));
});

test("mudar a direção de uma expressão não inventa sinal", () => {
  const { bloco, elemento, ws } = montar("gb_move(gb, hub, distancia * 2)");
  const antes = bloco.params.fields[0].value;

  escolher(elemento.querySelector("[data-direction-for]"), ws, "tras");

  assert.equal(bloco.params.fields[0].value, antes, "expressão não pode virar -1");
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, distancia * 2)");
});

/* ================================================================== */
/* O QUE NÃO PODE ACONTECER                                            */
/* ================================================================== */

test("campo sem sinal documentado não ganha dropdown de direção", () => {
  const SEM_SINAL = `def gb_move(gb, hub, distancia):
    """Move o robô.

    Args:
        distancia: em milímetros.
    """
    pass
`;

  const biblioteca = librarySymbols([
    { path: "m.py", content: SEM_SINAL, symbols: extractSymbols(parseProgram(SEM_SINAL).ir) },
  ]);

  const { elemento } = montar("gb_move(gb, hub, 100)", biblioteca);

  /*
   * Sem documentação do sinal, a IDE NÃO CHUTA "frente". Mostrar o número
   * puro é a escolha honesta: a criança vê 100 e sabe que é 100, sem uma
   * etiqueta que ninguém garantiza.
   */
  assert.equal(elemento.querySelector("[data-direction-for]"), null);
  assert.equal(elemento.querySelector('[data-field="fields.0.value"]').value, "100");
});

test("o número continua negativo no Python mesmo sem dropdown", () => {
  const SEM_SINAL = `def gb_move(gb, hub, distancia):
    """Move o robô.

    Args:
        distancia: em milímetros.
    """
    pass
`;

  const biblioteca = librarySymbols([
    { path: "m.py", content: SEM_SINAL, symbols: extractSymbols(parseProgram(SEM_SINAL).ir) },
  ]);

  const { bloco } = montar("gb_move(gb, hub, -100)", biblioteca);
  assert.equal(blockToPython(bloco), "gb_move(gb, hub, -100)", "o sinal não pode sumir da tela");
});
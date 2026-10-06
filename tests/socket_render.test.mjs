/**
 * RENDERIZAÇÃO DOS SOCKETS — o que a criança realmente vê.
 *
 * Estes testes rodam em Node, sem navegador: eles verificam o HTML gerado,
 * que é onde mora a diferença entre "a expressão é um bloco" e "a expressão
 * é um texto dentro de uma caixa". Se `erro * KP_STRAIGHT` voltar a ser uma
 * string renderizada, estes testes falham — e a falha é a do item #2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram } from "../src/parser/pythonParser.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";
import { blockInnerHtml } from "../src/blocks/blockRenderer.js";
import { isBlockValue, socketAccepts, canDropInto, kindOfBlock } from "../src/blocks/socket.js";
import { BLOCK_BY_ID } from "../src/blocks/blockCatalog.js";

const render = (code) => {
  const { blocks } = irToBlocks(parseProgram(code).ir, { userFunctions: [], libraryFunctions: [] });
  return blockInnerHtml(blocks[0]);
};

/* ------------------------- a árvore é real ------------------------- */

test("expressão com variáveis vira bloco aninhado, não texto", () => {
  const { blocks } = irToBlocks(parseProgram("correcao = erro * KP_STRAIGHT\n").ir, { userFunctions: [], libraryFunctions: [] });
  const value = blocks[0].params.value;
  assert.ok(isBlockValue(value), "o parâmetro `value` tem que ser um bloco, não uma string");
  assert.equal(value.blockId, "op_multiply");
  assert.equal(value.params.left.blockId, "var_report");
  assert.equal(value.params.left.params.name, "erro");
  assert.equal(value.params.right.params.name, "KP_STRAIGHT");
});

test("condição de while vira composição booleana aninhada", () => {
  const { blocks } = irToBlocks(parseProgram("while abs(gb.distance()) < alvo:\n    x = 1\n").ir, { userFunctions: [], libraryFunctions: [] });
  const cond = blocks[0].params.condition;
  assert.equal(cond.blockId, "op_lt");
  assert.equal(cond.params.left.blockId, "op_abs");
  // `gb` é reconhecido como base de movimento, então `gb.distance()` vira o
  // bloco de sensor da IDE — que é o correto, e melhor do que genérico.
  assert.equal(cond.params.left.params.value.blockId, "movement_distance");
  assert.equal(cond.params.right.params.name, "alvo");
});

test("`and` de comparações compõe duas árvores", () => {
  const { blocks } = irToBlocks(parseProgram("x = a < b and c > d\n").ir, { userFunctions: [], libraryFunctions: [] });
  const v = blocks[0].params.value;
  assert.equal(v.blockId, "op_and");
  assert.equal(v.params.left.blockId, "op_lt");
  assert.equal(v.params.right.blockId, "op_gt");
});

test("aninhamento tem a profundidade certa e respeita precedência", () => {
  const { blocks } = irToBlocks(parseProgram("v = a + b * c\n").ir, { userFunctions: [], libraryFunctions: [] });
  const v = blocks[0].params.value;
  assert.equal(v.blockId, "op_add");
  // `b * c` tem de ficar dentro do lado DIREITO, como no Python.
  assert.equal(v.params.right.blockId, "op_multiply");
  assert.equal(v.params.left.params.name, "a");
});

/* ------------------------- o HTML ------------------------- */

test("o bloco aninhado aparece desenhado no socket", () => {
  const html = render("correcao = erro * KP_STRAIGHT\n");
  assert.match(html, /gb-nested-block/, "tem que haver um bloco desenhado dentro do socket");
  assert.match(html, /gb-socket-filled/, "o socket preenchido precisa se distinguir do vazio");
  assert.ok(!html.includes("erro * KP_STRAIGHT"), "o texto da expressão NÃO pode sobrar na tela");
});

test("o HTML aninhado é recursivo: três níveis aparecem", () => {
  const html = render("v = a + b * c\n");
  const niveis = (html.match(/gb-nested-block/g) ?? []).length;
  // op_add, op_multiply e os três var_report (a, b, c)
  assert.equal(niveis, 5, `esperava 5 blocos desenhados, veio ${niveis}`);
});

test("socket com número puro continua um campo editável", () => {
  const html = render("v = 50\n");
  assert.match(html, /gb-field/, "um número deve continuar digitável");
  assert.ok(!html.includes("gb-nested-block"), "número literal não precisa virar bloco desenhado");
});

test("o bloco aninhado nunca expõe um valor cru ao editor", () => {
  const html = render("correcao = erro * KP_STRAIGHT\n");
  assert.ok(!html.includes("[object Object]"), "nunca pode vazar objeto serializado");
  assert.ok(!html.includes("undefined"), "nunca pode vazar undefined");
});

/* ------------------------- compatibilidade de socket ------------------------- */

test("booleano só encaixa em socket de condição", () => {
  const opEq = { blockId: "op_eq", shape: "boolean" };
  const cond = BLOCK_BY_ID.get("control_if").params.condition;
  assert.equal(kindOfBlock(opEq), "boolean");
  assert.ok(canDropInto(cond, opEq), "booleano tem que caber em condição");

  // O catálogo não tem mais `op_eq` (virou `op_lt`/`op_gt`/...), então a
  // verificação usa um bloco instanciado, que é o que o drag-and-drop
  // realmente entrega ao `canDropInto`.
  const expressao = { type: "expression", default: "0" };
  assert.equal(canDropInto(expressao, opEq), false, "booleano NÃO é arrastável para expressão");
  assert.equal(canDropInto({ type: "number", default: 0 }, opEq), false, "nem para número");
  assert.equal(canDropInto({ type: "condition", default: "True" }, opEq), true);
});

test("statement não encaixa dentro de reporter", () => {
  const espera = { blockId: "control_wait", shape: "stack" };
  const socketExpr = BLOCK_BY_ID.get("var_set").params.value;
  assert.equal(kindOfBlock(espera), "statement");
  assert.equal(socketAccepts(socketExpr).has("statement"), false);
  assert.equal(canDropInto(socketExpr, espera), false);
});

test("socket de porta não aceita nenhum bloco", () => {
  const porta = BLOCK_BY_ID.get("motor_setup").params.left ?? BLOCK_BY_ID.get("motor_run_time").params.port;
  assert.equal(socketAccepts(porta).size, 0, "porta é valor literal, não encaixe");
});

test("reporter aceita em socket numérico e de expressão", () => {
  const reporter = { blockId: "var_report", shape: "reporter" };
  const numero = BLOCK_BY_ID.get("op_add").params.left;
  assert.equal(kindOfBlock(reporter), "reporter");
  assert.ok(canDropInto(numero, reporter));
});

test("kindOfBlock lê a especificação, não só o bloco instanciado", () => {
  // Sem isto, validar encaixe pela spec diria "reporter" para tudo.
  assert.equal(kindOfBlock(BLOCK_BY_ID.get("op_eq")), "boolean");
  assert.equal(kindOfBlock(BLOCK_BY_ID.get("control_wait")), "statement");
  assert.equal(kindOfBlock(BLOCK_BY_ID.get("control_break")), "cap");
  assert.equal(kindOfBlock(BLOCK_BY_ID.get("var_report")), "reporter");
  assert.equal(kindOfBlock(BLOCK_BY_ID.get("event_program_start")), "statement");
});

/* ------------------- falha fechada, não falha permissiva ------------------- */

test("shape desconhecido é tratado como statement e não encaixa", () => {
  // Se o fallback fosse "reporter", um erro de digitação no catálogo
  // viraria permissão silenciosa de encaixar o bloco onde ele não cabe.
  const typo = { blockId: "x", shape: "typo" };
  assert.equal(kindOfBlock(typo), "statement");
  assert.equal(canDropInto({ type: "expression" }, typo), false);
  assert.equal(canDropInto({ type: "number" }, typo), false);
  assert.equal(canDropInto({ type: "condition" }, typo), false);
});

test("argumento nulo ou string não vira reporter", () => {
  assert.equal(kindOfBlock(null), "statement");
  assert.equal(kindOfBlock("reporter"), "statement");
  assert.equal(canDropInto({ type: "expression" }, null), false);
});

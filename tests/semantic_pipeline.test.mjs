/* ==================================================================
 * PIPELINE COMPLETO: ARQUIVO DA BIBLIOTECA -> BLOCO -> PYTHON
 * ==================================================================
 *
 * Os testes de `semantic_criteria` provam que o schema está certo.
 * Estes provam que o schema CHEGA AO BLOCO — que é onde a ideia vira
 * produto, e onde os erros mais caros aparecem: o bloco nasce bonito e
 * o Python regerado não bate.
 *
 * A biblioteca é montada dentro do próprio teste, sem `@block` e sem
 * metadado externo: só assinatura e docstring, que é o caso que uma
 * criança de 11 anos encontra ao abrir o editor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseProgram } from "../src/parser/pythonParser.js";
import { extractSymbols, librarySymbols } from "../src/semantic/analyzer.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";
import { blockToPython } from "../src/python/codeGenerator.js";
import { blockInnerHtml } from "../src/blocks/blockRenderer.js";

/* ------------------------------------------------------------------ */
/* Biblioteca de teste                                                */
/* ------------------------------------------------------------------ */

const MOVIMENTO = `from pybricks.parameters import Side


def gb_move(gb, hub, distancia, velocidade=300):
    """Move o robô em linha reta.

    Args:
        distancia: quanto o robô anda, em milímetros.
                   Positivo move para frente, negativo move para trás.
        velocidade: em milímetros por segundo.
    """
    gb.straight(distancia, velocidade)


def gb_turn(gb, hub, angulo):
    """Gira o robô no próprio lugar.

    Args:
        angulo: quanto gira, em graus.
               Positivo gira para a direita, negativo gira para a esquerda.
    """
    gb.turn(angulo)


def gb_curve(gb, hub, raio, angulo, velocidade=300):
    """Faz uma curva.

    Args:
        raio: raio da curva, em milímetros.
        angulo: quanto gira, em graus.
                Positivo gira para a direita, negativo gira para a esquerda.
        velocidade: em milímetros por segundo.
    """
    gb.arc(raio, angulo)


def ler_cor(sensor: Literal["vermelho", "azul", "verde"]):
    """Lê uma cor do sensor.

    Args:
        sensor: qual sensor ler.
    """
    return sensor
`;

const BIBLIOTECA = librarySymbols([
  { path: "movimento.py", content: MOVIMENTO, symbols: extractSymbols(parseProgram(MOVIMENTO).ir) },
]);

/** Python -> bloco -> Python, com a biblioteca carregada. */
function idaEVolta(programa, opcoes = {}) {
  const { ir } = parseProgram(programa);
  const resultado = irToBlocks(ir, {
    libraryFunctions: BIBLIOTECA,
    sourceText: programa,
    aliases: opcoes.aliases ?? {},
  });
  const bloco = resultado.blocks[0] ?? null;
  return { bloco, python: bloco ? blockToPython(bloco) : null, ...resultado };
}

/* ================================================================== */
/* O BLOCO TEM O NOME E OS CONTROLES CERTO?                            */
/* ================================================================== */

test("gb_move vira o bloco 'mover', não uma chamada genérica", () => {
  const { bloco } = idaEVolta("gb_move(gb, hub, 100)");
  assert.equal(bloco.blockId, "custom_call", "usa o bloco genérico com campos semânticos");
  assert.equal(bloco.params.label, "mover");
  assert.notEqual(bloco.params.label, "função", "o rótulo genérico significa que o schema não chegou");
});

test("o campo de direção mostra frente com 100 mm", () => {
  const { bloco } = idaEVolta("gb_move(gb, hub, 100)");
  const distancia = bloco.params.fields.find((f) => f.name === "distancia");

  assert.equal(distancia.type, "direction");
  assert.equal(distancia.direction, "frente");
  assert.equal(distancia.value, "100");
  assert.equal(distancia.sign, 1);
  assert.equal(distancia.unit, "mm");
});

test("o mesmo Python com sinal negativo mostra tras", () => {
  const { bloco } = idaEVolta("gb_move(gb, hub, -100)");
  const distancia = bloco.params.fields.find((f) => f.name === "distancia");

  assert.equal(distancia.direction, "tras");
  assert.equal(distancia.value, "100", "a tela mostra o módulo");
  assert.equal(distancia.sign, -1, "o sinal fica separado do valor");
});

test("gb_turn usa os rótulos de direção que a docstring escreveu", () => {
  const positiva = idaEVolta("gb_turn(gb, hub, 90)").bloco.params.fields[0];
  const negativa = idaEVolta("gb_turn(gb, hub, -90)").bloco.params.fields[0];

  assert.equal(positiva.direction, "direita");
  assert.equal(negativa.direction, "esquerda");
  assert.equal(positiva.unit, "°", "graus aparece com o símbolo de grau");
});

test("Literal vira dropdown com as opções escritas pelo autor", () => {
  const { bloco } = idaEVolta('ler_cor("azul")');
  const campo = bloco.params.fields[0];

  assert.equal(campo.type, "select", "enum da anotação vira dropdown de seleção");
  assert.deepEqual(campo.options, [
    ["vermelho", "vermelho"],
    ["azul", "azul"],
    ["verde", "verde"],
  ]);
});

test("o campo com unidade oferece as opções de medida", () => {
  const { bloco } = idaEVolta("gb_move(gb, hub, 100)");
  const velocidade = bloco.params.fields.find((f) => f.name === "velocidade");

  assert.equal(velocidade.type, "unit");
  assert.equal(velocidade.unitKey, "mm/s");
  assert.deepEqual(velocidade.unitOptions.map(([rotulo]) => rotulo), ["mm/s", "cm/s", "m/s"]);
});

/* ================================================================== */
/* ROUND-TRIP PELA INTEIRA                                             */
/* ================================================================== */

test("nenhuma chamada perde nada na ida e volta", () => {
  const casos = [
    "gb_move(gb, hub, 100)",
    "gb_move(gb, hub, -100)",
    "gb_move(gb, hub, distancia)",
    "gb_move(gb, hub, distancia * 2)",
    "gb_move(gb, hub, 100, velocidade=300)",
    "gb_move(gb, hub, distancia, 250)",
    "gb_turn(gb, hub, 90)",
    "gb_turn(gb, hub, -90)",
    "gb_curve(gb, hub, 50, -45)",
    "gb_curve(gb, hub, 50, 45, 200)",
    'ler_cor("azul")',
  ];

  for (const programa of casos) {
    const { python } = idaEVolta(programa);
    assert.equal(python, programa, `round-trip quebrou em: ${programa}`);
  }
});

test("os argumentos ocultos saem no Python mesmo estando fora da tela", () => {
  const { bloco, python } = idaEVolta("gb_move(gb, hub, 100)");

  assert.deepEqual(bloco.params.semantic.ocultos, ["gb", "hub"]);
  assert.deepEqual(
    bloco.params.fields.map((f) => f.name),
    ["distancia", "velocidade"],
    "gb e hub não aparecem na tela",
  );
  assert.equal(python, "gb_move(gb, hub, 100)");
});

test("o round-trip não depende de o bloco saber o valor escondido", () => {
  /*
   * O bloco precisa saber `gb` e `hub` porque eles não estão na tela. Se
   * essa informação faltar, o Python gerado fica com menos argumentos do
   * que a assinatura exige — e o programa da criança muda.
   */
  const { bloco } = idaEVolta("gb_move(gb, hub, 100)");
  assert.deepEqual(bloco.params.ocultosValores, { gb: "gb", hub: "hub" });
});

/* ================================================================== */
/* O HTML TEM O QUE A CRIANÇA ESPERA                                   */
/* ================================================================== */

test("o HTML traz o dropdown de direção com o certo marcado", () => {
  const { bloco } = idaEVolta("gb_move(gb, hub, -100)");
  const html = blockInnerHtml(bloco);

  assert.match(html, /<option value="tras" selected data-sign="-1">tras<\/option>/);
  assert.match(html, /value="100"/);
  assert.match(html, /<span class="gb-unit">mm<\/span>/);
});

test("expressão não recebe dropdown de direção habilitada", () => {
  const { bloco } = idaEVolta("gb_move(gb, hub, distancia * 2)");
  const html = blockInnerHtml(bloco);

  /*
   * A direção de uma expressão é INDETERMINADA. Deixá-la habilitada faria
   * a criança escolher "frente" e o gerador inventar um sinal que não
   * estava no Python.
   */
  assert.match(html, /data-direction-for="fields\.0\.value" disabled/);
  assert.match(html, /value="distancia \* 2"/);
});

/* ================================================================== */
/* QUALQUER FUNÇÃO, NÃO SÓ AS TRÊS PRIMEIRAS                            */
/* ================================================================== */

test("uma função fora da lista inicial também vira bloco inteligente", () => {
  /*
   * A exigência do projeto: não pode ser `if (nome === "gb_move")`. Se uma
   * função nova da biblioteca não virar bloco semântico, o mecanismo está
   * hardcoded — e essa é exatamente a armadilha que o teste fecha.
   */
  const EXTRA = `def girar_luz(hub, angulo: float, ligar: bool = True):
    """Gira a luz do hub.

    Args:
        angulo: quanto gira, em graus. Positivo para a direita, negativo para a esquerda.
        ligar: se acende a luz.
    """
    hub.light.hub_light_angle(angulo)
`;

  const biblioteca = librarySymbols([
    { path: "extra.py", content: EXTRA, symbols: extractSymbols(parseProgram(EXTRA).ir) },
  ]);
  const { ir } = parseProgram("girar_luz(hub, 45)");
  const { blocks } = irToBlocks(ir, { libraryFunctions: biblioteca, sourceText: "girar_luz(hub, 45)" });

  const bloco = blocks[0];
  assert.equal(bloco.params.label, "girar luz");
  assert.equal(bloco.params.fields[0].direction, "direita");
  assert.equal(blockToPython(bloco), "girar_luz(hub, 45)");
});

test("função sem nenhuma pista continua virando bloco (nunca some)", () => {
  const VAZIA = "def misterio(a, b):\n    return a + b\n";
  const biblioteca = librarySymbols([
    { path: "misterio.py", content: VAZIA, symbols: extractSymbols(parseProgram(VAZIA).ir) },
  ]);

  const { ir } = parseProgram("misterio(1, 2)");
  const { blocks } = irToBlocks(ir, { libraryFunctions: biblioteca, sourceText: "misterio(1, 2)" });

  assert.ok(blocks.length > 0, "sem schema, ainda tem que haver bloco");
  assert.equal(blockToPython(blocks[0]), "misterio(1, 2)");
});

test("função que não é de biblioteca nenhuma não some do programa", () => {
  const { ir } = parseProgram("nao_existe(1)");
  const { blocks, pythonOnly } = irToBlocks(ir, { libraryFunctions: [], sourceText: "nao_existe(1)" });

  assert.ok(blocks.length > 0 || pythonOnly.length > 0, "nada pode desaparecer");
});
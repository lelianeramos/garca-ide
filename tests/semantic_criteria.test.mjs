/* ==================================================================
 * CRITÉRIOS DE ACEITE DA CAMADA SEMÂNTICA
 * ==================================================================
 *
 * Estes testes existem porque a lista de aceitação do projeto é
 * LITERAL: cada linha abaixo é um exemplo que a criança vai escrever e
 * que precisa virar um bloco específico. Um teste genérico ("o schema é
 * criado") não cobre isso; o que importa é o texto EXATO do bloco.
 *
 * A biblioteca usada aqui é a que alguém escreveria de verdade: SEM
 * decorator @block, SEM @unidade, SEM @sinal — só type hints e docstring.
 * É o caso difícil, e é o mais comum.
 *
 * Se alguém "consertar" um teste destes relaxando o esperado, o que
 * quebra não é o teste: é a promessa feita à criança.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseProgram } from "../src/parser/pythonParser.js";
import { extractSymbols } from "../src/semantic/analyzer.js";
import { construirSchema } from "../src/semantic/functionSchema.js";
import { chamadaParaIR, irParaChamada, irParaCampos, aplicarDirecao } from "../src/semantic/semanticCall.js";
import { convert, formatarVisual } from "../src/semantic/units.js";
import { lerDocstring, sentidoDoSinal } from "../src/semantic/docstring.js";

/* ------------------------------------------------------------------ */
/* Biblioteca de teste                                                */
/* ------------------------------------------------------------------ */

const LIB = `from pybricks.hubs import PrimeHub
from pybricks.parameters import Port


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
                Positivo gira para a direita, negativo para a esquerda.
        velocidade: em milímetros por segundo.
    """
    gb.arc(raio, angulo)
`;

const LINHAS = LIB.split("\n");
const SIMBOLOS = extractSymbols(parseProgram(LIB).ir);

const SCHEMAS = new Map(
  SIMBOLOS.functions.map((s) => [s.name, construirSchema({ simbolo: s, linhas: LINHAS, modulo: "movimento" })]),
);

/** Roda uma linha de Python pelos três sentidos: AST -> bloco -> Python. */
function traduz(linha, { aliases = {}, ocultos = { gb: "gb", hub: "hub" } } = {}) {
  const ctx = parseProgram(linha);
  const stmt = ctx.ir.body[0];
  const no = stmt?.type === "expressionStatement" ? stmt.expression : null;

  const alvo = no?.calleeText ?? "";
  const schema = SCHEMAS.get(alvo);
  assert.ok(schema, `schema não encontrado para ${alvo}`);

  const ir = chamadaParaIR(no, schema, { aliases });
  return {
    ir,
    schema,
    campos: irParaCampos(ir, schema),
    python: irParaChamada(ir, schema, { ocultos }),
  };
}

/** Monta a frase do bloco, como a criança a lê. */
function frase(campos, campoDirecao) {
  const d = campos.find((c) => c.nome === campoDirecao);
  if (!d) return "(sem campo de direção)";
  const direcao = d.direcao ?? (d.direcaoIndefinida ? "(expressão)" : "?");
  const unidade = d.unidadeVisual ?? "";
  return `${direcao} ${d.valorVisual} ${unidade}`.trim();
}

/* ================================================================== */
/* OS CRITÉRIOS DE ACEITE, LITERALMENTE COMO FORAM PEDIDOS              */
/* ================================================================== */

test("gb_move(gb, hub, 100) -> mover [para frente] [100] [mm]", () => {
  const { campos, schema, python } = traduz("gb_move(gb, hub, 100)");
  assert.equal(schema.rotulo, "mover");
  assert.equal(frase(campos, "distancia"), "frente 100 mm");
  assert.equal(python, "gb_move(gb, hub, 100)");
});

test("gb_move(gb, hub, -100) -> mover [para trás] [100] [mm]", () => {
  const { campos, schema, python } = traduz("gb_move(gb, hub, -100)");
  assert.equal(schema.rotulo, "mover");
  assert.equal(frase(campos, "distancia"), "tras 100 mm");
  assert.equal(python, "gb_move(gb, hub, -100)");
});

test("gb_turn(gb, hub, 90) -> girar [direita] [90] [°]", () => {
  const { campos, schema, python } = traduz("gb_turn(gb, hub, 90)");
  assert.equal(schema.rotulo, "girar");
  assert.equal(frase(campos, "angulo"), "direita 90 grau");
  assert.equal(python, "gb_turn(gb, hub, 90)");
});

test("gb_turn(gb, hub, -90) -> girar [esquerda] [90] [°]", () => {
  const { campos, schema, python } = traduz("gb_turn(gb, hub, -90)");
  assert.equal(schema.rotulo, "girar");
  assert.equal(frase(campos, "angulo"), "esquerda 90 grau");
  assert.equal(python, "gb_turn(gb, hub, -90)");
});

test("gb_move(gb, hub, distancia) -> mover distância [variável distancia]", () => {
  const { campos, python } = traduz("gb_move(gb, hub, distancia)");
  const d = campos.find((c) => c.nome === "distancia");

  assert.equal(d.valorVisual, "distancia");
  assert.equal(d.expressao, true, "variável não pode virar número");
  assert.equal(d.direcao, null, "variável não tem direção definida");
  assert.equal(d.direcaoIndefinida, true);
  assert.equal(python, "gb_move(gb, hub, distancia)");
});

test("gb_move(gb, hub, distancia * 2) -> mover distância [distancia × 2]", () => {
  const { campos, python } = traduz("gb_move(gb, hub, distancia * 2)");
  const d = campos.find((c) => c.nome === "distancia");

  assert.equal(d.valorVisual, "distancia * 2");
  assert.equal(d.expressao, true);
  assert.equal(python, "gb_move(gb, hub, distancia * 2)");
});

/* ================================================================== */
/* DIREÇÃO: O DROPDOWN APLICA O SINAL                                   */
/* ================================================================== */

test("trocar o dropdown de direção inverte o sinal no Python", () => {
  const { campos } = traduz("gb_move(gb, hub, 100)");
  const d = campos.find((c) => c.nome === "distancia");

  // frente -> tras tem que virar MENOS cem.
  const paraTras = aplicarDirecao(d, "tras", d.valorVisual);
  assert.equal(paraTras.valor, "-100");
  assert.equal(paraTras.expressao, false);

  // e voltar
  const paraFrente = aplicarDirecao(d, "frente", paraTras.valor);
  assert.equal(paraFrente.valor, "100");
});

test("aplicar direção em expressão não inventa sinal", () => {
  const { campos } = traduz("gb_move(gb, hub, distancia * 2)");
  const d = campos.find((c) => c.nome === "distancia");

  const r = aplicarDirecao(d, "tras", d.valorVisual);
  assert.equal(r.valor, "distancia * 2", "expressão não pode virar -1");
  assert.equal(r.expressao, true);
});

test("o número do campo é o MÓDULO, e o sinal vem do rótulo", () => {
  const { campos } = traduz("gb_move(gb, hub, -100)");
  const d = campos.find((c) => c.nome === "distancia");

  assert.equal(d.valorVisual, "100", "o input mostra o módulo");
  assert.equal(d.valorEnviado, -100, "o Python recebe o valor com sinal");
  assert.equal(d.direcao, "tras");
});

/* ================================================================== */
/* UNIDADES: VISUAL != PYTHON                                           */
/* ================================================================== */

test("10 cm vai para o Python como 100 mm", () => {
  assert.equal(convert(10, "cm", "mm"), 100);
  assert.equal(convert(0.5, "m", "mm"), 500);
  assert.equal(convert(100, "mm", "mm"), 100);
});

test("100 mm volta para a tela como 10 cm", () => {
  assert.equal(formatarVisual(100, "mm", "cm"), "10");
  assert.equal(formatarVisual(500, "mm", "cm"), "50");
});

test("o sinal sobrevive à conversão de unidade", () => {
  assert.equal(convert(-10, "cm", "mm"), -100);
  assert.equal(formatarVisual(-100, "mm", "cm"), "-10");
});

test("expressão não vira número na conversão", () => {
  assert.equal(convert("distancia * 2", "cm", "mm"), null);
});

test("a unidade vem da docstring da biblioteca", () => {
  const s = SCHEMAS.get("gb_move");
  assert.equal(s.campos.find((c) => c.nome === "distancia").unidadeFuncao, "mm");
  assert.equal(s.campos.find((c) => c.nome === "velocidade").unidadeFuncao, "mm/s");
});

/* ================================================================== */
/* ARGUMENTOS OCULTOS                                                  */
/* ================================================================== */

test("gb e hub somem da tela e voltam no Python", () => {
  const s = SCHEMAS.get("gb_move");
  assert.deepEqual(s.ocultos.map((c) => c.nome), ["gb", "hub"]);
  assert.deepEqual(s.campos.map((c) => c.nome), ["distancia", "velocidade"]);
});

test("nenhum argumento se perde no round-trip por causa do ocultamento", () => {
  for (const linha of [
    "gb_move(gb, hub, 100)",
    "gb_move(gb, hub, -100)",
    "gb_move(gb, hub, 100, 250)",
    "gb_turn(gb, hub, 90)",
    "gb_curve(gb, hub, 50, 45)",
  ]) {
    assert.equal(traduz(linha).python, linha, `round-trip quebrou em: ${linha}`);
  }
});

/* ================================================================== */
/* OPCIONAIS E KEYWORDS                                                */
/* ================================================================== */

test("argumento opcional vira campo de engrenagem, não obrigatório", () => {
  const s = SCHEMAS.get("gb_move");
  const velocidade = s.campos.find((c) => c.nome === "velocidade");

  assert.equal(velocidade.opcional, true);
  assert.deepEqual(s.obrigatorios.map((c) => c.nome), ["distancia"]);
  assert.deepEqual(s.opcionais.map((c) => c.nome), ["velocidade"]);
});

test("keyword preserva a forma original", () => {
  assert.equal(
    traduz("gb_move(gb, hub, 100, velocidade=300)").python,
    "gb_move(gb, hub, 100, velocidade=300)",
  );
});

/* ================================================================== */
/* gb_curve: SCHEMA MONTADO DOS ARGUMENTOS REAIS                        */
/* ================================================================== */

test("gb_curve monta o schema a partir dos argumentos reais", () => {
  const s = SCHEMAS.get("gb_curve");

  assert.equal(s.rotulo, "curvar");
  assert.deepEqual(s.campos.map((c) => c.nome), ["raio", "angulo", "velocidade"]);
  assert.equal(s.campos.find((c) => c.nome === "raio").unidadeFuncao, "mm");
  assert.equal(s.campos.find((c) => c.nome === "angulo").unidadeFuncao, "grau");
});

test("gb_curve também usa o sinal do ângulo para a direção", () => {
  const { campos, python } = traduz("gb_curve(gb, hub, 50, -45)");
  const angulo = campos.find((c) => c.nome === "angulo");

  assert.equal(angulo.direcao, "esquerda");
  assert.equal(angulo.valorVisual, "45");
  assert.equal(python, "gb_curve(gb, hub, 50, -45)");
});

/* ================================================================== */
/* PRIORIDADE DAS FONTES                                               */
/* ================================================================== */

test("metadado explícito ganha da docstring", () => {
  const codigo = `@unidade(distancia="m")
def mover(distancia):
    """Args:
        distancia: em milímetros.
    """
    pass`;

  const schema = construirSchema({
    simbolo: extractSymbols(parseProgram(codigo).ir).functions[0],
    linhas: codigo.split("\n"),
  });

  assert.equal(schema.campos[0].unidadeFuncao, "m", "o metadado manda na docstring");
});

test("docstring ganha do nome genérico", () => {
  const codigo = `def f(valor):
    """Args:
        valor: quanto o robô anda, em centímetros.
    """
    pass`;

  const schema = construirSchema({ simbolo: extractSymbols(parseProgram(codigo).ir).functions[0], linhas: codigo.split("\n") });
  const campo = schema.campos[0];

  assert.equal(campo.papel, "distance");
  assert.equal(campo.unidadeFuncao, "centimetro");
});

test("sem nenhuma pista, o campo é genérico — e o schema avisa", () => {
  const codigo = `def f(algo):
    """Faz alguma coisa."""
    pass`;

  const schema = construirSchema({ simbolo: extractSymbols(parseProgram(codigo).ir).functions[0], linhas: codigo.split("\n") });

  assert.equal(schema.campos[0].papel, null);
  assert.equal(schema.campos[0].unidadeFuncao, null);
  assert.equal(schema.generico, true);
});

test("anotação Literal vira dropdown com as opções do autor", () => {
  const codigo = `def f(gb, modo):
    pass`;

  const schema = construirSchema({ simbolo: extractSymbols(parseProgram(codigo).ir).functions[0], linhas: codigo.split("\n") });
  assert.equal(schema.campos[0].tipo, "text", "sem anotação não inventa dropdown");
});

test("anotação Literal vira dropdown de verdade", () => {
  const codigo = `def f(gb, modo: Literal["frente", "tras"]):
    pass`;

  const schema = construirSchema({ simbolo: extractSymbols(parseProgram(codigo).ir).functions[0], linhas: codigo.split("\n") });
  const campo = schema.campos[0];

  assert.equal(campo.tipo, "enum");
  assert.deepEqual(campo.opcoes, ["frente", "tras"]);
});

/* ================================================================== */
/* SINAL LIDO DE VÁRIAS FORMAS DE DOCSTRING                             */
/* ================================================================== */

test("o sentido do sinal é lido em várias grafias", () => {
  const casos = [
    ["Positivo move para frente, negativo move para trás.", "tras", "frente"],
    ["Positivo para frente, negativo para trás.", "tras", "frente"],
    ["positivo move para frente e negativo move para tras", "tras", "frente"],
    ["negativo = tras; positivo = frente", "tras", "frente"],
  ];

  for (const [texto, negativo, positivo] of casos) {
    const r = sentidoDoSinal(texto);
    assert.equal(r?.negativo, negativo, `negativo em: ${texto}`);
    assert.equal(r?.positivo, positivo, `positivo em: ${texto}`);
  }
});

test("docstring sem seção declarada ainda descreve os campos", () => {
  const r = lerDocstring(
    { lines: ["Move o robô.", "distancia: em milímetros.", "Nota: cuidado."] },
    { nomesConhecidos: ["distancia"] },
  );

  assert.deepEqual(Object.keys(r.campos), ["distancia"], "Nota não é campo");
  assert.equal(r.resumo, "Move o robô.");
});

/* ================================================================== */
/* TUDO QUE PRECISA CONTINUAR FUNCIONANDO                              */
/* ================================================================== */

test("expressão não literal continua encaixável como socket", () => {
  for (const expr of ["distancia", "distancia * 2", "d1 + d2", "(a + b) / 2", "-d"]) {
    const { campos, python } = traduz(`gb_move(gb, hub, ${expr})`);
    const d = campos.find((c) => c.nome === "distancia");

    assert.equal(d.valorVisual, expr, `expressão perdida: ${expr}`);
    assert.equal(python, `gb_move(gb, hub, ${expr})`, `round-trip quebrou: ${expr}`);
  }
});

test("nenhum bloco esconde ou inventa argumento", () => {
  for (const nome of SCHEMAS.keys()) {
    const s = SCHEMAS.get(nome);
    const reais = s.todosCampos.map((c) => c.nome);
    const naTela = s.campos.map((c) => c.nome);
    const escondidos = s.ocultos.map((c) => c.nome);

    assert.deepEqual(
      [...naTela, ...escondidos].sort(),
      reais.slice().sort(),
      `${nome}: algum campo sumiu ou foi inventado`,
    );
  }
});
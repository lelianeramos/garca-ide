"use strict";

const assert = require("node:assert/strict");
const registry = require("../pybricks-api.json");

global.window = {};
require("../block-engine.js");

const engine = window.CodeBlocks;
engine.registerCatalog(registry.visualBlocks);

function prepare(schema, label, params) {
  const block = { schema, label, params };
  const view = engine.render(block);
  assert.ok(view, `Renderização ausente para ${schema}`);
  assert.ok(view.html, `HTML ausente para ${schema}`);
  assert.ok(block.code, `Código ausente para ${schema}`);
  assert.doesNotMatch(block.code, /undefined|null/, `Código inválido para ${schema}`);
  return { block, view };
}

function testMotorGeometryAndGeneration() {
  const { block, view } = prepare(
    "motor_run_angle",
    "A executar ↻ por 2 rotações a 500 graus/s",
  );
  assert.equal(view.shape, "stack");
  assert.equal(block.params.port, "A");
  assert.equal(block.params.rotations, 2);
  assert.equal(block.params.speed, 500);
  assert.equal(block.code, "motor_a.run_angle(500, 720)");
  assert.match(view.html, /data-field="port"/);
  assert.match(view.html, /data-field="direction"/);
  assert.match(view.html, /data-field="rotations"/);
  assert.match(view.html, /data-field="speed"/);
}

function testDecimalNormalization() {
  assert.equal(engine.asNumber("75,5"), 75.5);
  assert.equal(engine.asNumber("75.5"), 75.5);
  assert.equal(engine.asNumber("75, 5"), 0, "vírgula seguida de espaço não é decimal");

  const block = {
    schema: "wait",
    label: "espere 1 segundo",
    params: { seconds: 1 },
  };
  engine.render(block);
  engine.update(block, "seconds", "0,25");
  assert.equal(block.params.seconds, 0.25);
  assert.equal(block.code, "wait(250)");
}

function testComparisonControls() {
  const { block, view } = prepare("comparison", "10 >= 5");
  assert.equal(view.shape, "boolean");
  assert.equal(block.params.left, 10);
  assert.equal(block.params.operator, ">=");
  assert.equal(block.params.right, 5);
  assert.equal(block.code, "10 >= 5");
  assert.match(view.html, /data-field="operator"/);
}

function testExpressionControls() {
  const { block, view } = prepare("math_expression", "10 + 5");
  assert.equal(view.shape, "reporter");
  assert.equal(block.code, "10 + 5");
  engine.update(block, "operator", "*");
  assert.equal(block.code, "10 * 5");
}

function testSensorPorts() {
  const distance = prepare("sensor_distance", "distância (D)").block;
  assert.equal(distance.params.port, "D");
  assert.equal(distance.code, "distance_D.distance()");
  engine.update(distance, "port", "F");
  assert.equal(distance.code, "distance_F.distance()");

  const force = prepare("sensor_force", "força (F) > 5 N").block;
  assert.equal(force.params.port, "F");
  assert.equal(force.params.operator, ">");
  assert.equal(force.params.force, 5);
}

function testControlCavity() {
  const { block, view } = prepare("if_distance", "se distância < 20 mm então");
  assert.equal(view.shape, "c-block");
  assert.match(view.html, /gb-cavity/);
  assert.match(block.code, /^if distance_D\.distance\(\) < 20:/);
}

function testBooleanControls() {
  const logic = prepare("logic_operation", "verdadeiro e falso").block;
  assert.equal(logic.params.left, true);
  assert.equal(logic.params.operator, "and");
  assert.equal(logic.params.right, false);
  assert.equal(logic.code, "True and False");

  const button = prepare("button_pressed", "botão central pressionado").block;
  assert.equal(button.params.button, "CENTER");
  assert.equal(button.code, "Button.CENTER in hub.buttons.pressed()");
}

function testDynamicLibraryArguments() {
  const { block, view } = prepare("library_call", "biblioteca", {
    module: "controle",
    function: "girar",
    arguments: { velocidade: 75.5, sentido: "horario" },
  });
  assert.equal(block.code, 'from controle import girar\ngirar(velocidade=75.5, sentido="horario")');
  assert.match(view.html, /arguments\.velocidade/);
  assert.match(view.html, /arguments\.sentido/);
}

function testConfiguredWheelGeometry() {
  window.CODE_STUDIO_ROBOT_SETTINGS = { wheelDiameter: 62.4 };
  const block = prepare("movement_straight", "mover ↑ por 1 rotações").block;
  assert.equal(block.params.rotations, 1);
  assert.equal(block.code, "robot.straight(196.035382)");
}

function testEveryRegistryBlockIsEditable() {
  for (const definition of registry.visualBlocks) {
    const block = { schema: definition.id, label: definition.label };
    const view = engine.render(block);
    assert.ok(view?.html, `Bloco do registry sem renderização: ${definition.id}`);
    assert.ok(block.code, `Bloco do registry sem Python: ${definition.id}`);
    assert.doesNotMatch(block.code, /undefined|null/, `Python inválido: ${definition.id}`);
    const editable = definition.fields?.[0];
    if (editable) assert.equal(engine.update(block, editable.name, editable.default), true);
  }
}

const tests = [
  testMotorGeometryAndGeneration,
  testDecimalNormalization,
  testComparisonControls,
  testExpressionControls,
  testSensorPorts,
  testControlCavity,
  testBooleanControls,
  testDynamicLibraryArguments,
  testConfiguredWheelGeometry,
  testEveryRegistryBlockIsEditable,
];

for (const test of tests) {
  test();
  process.stdout.write(`✓ ${test.name}\n`);
}

process.stdout.write(`${tests.length} testes do motor visual passaram.\n`);

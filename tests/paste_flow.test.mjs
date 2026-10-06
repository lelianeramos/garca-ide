/**
 * O FLUXO DA CRIANÇA: cola o código, mexe nos blocos, insere mais.
 *
 * Cada teste aqui reproduz uma queixa real e verificável:
 *
 *   1. "os blocos duplicam quando coloco um input"
 *   2. "quando eu colo código do Pybricks não aparece bloco"
 *   3. "os blocos têm que aparecer em ordem lógica"
 *
 * Estes testes atravessam o pipeline INTEIRO (parser -> fábrica -> gerador,
 * e também a reconciliação), porque foi no caminho completo que os bugs
 * apareceram — cada etapa sozinha parecia certa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncManager } from "../src/editor/syncManager.js";
import { reconcileBlocks } from "../src/blocks/blockFactory.js";
import { parseProgram } from "../src/parser/pythonParser.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";
import { generateProgram, insertBlock } from "../src/python/codeGenerator.js";
import { BLOCK_BY_ID, blockDefaults } from "../src/blocks/blockCatalog.js";

const lista = (blocks) => (blocks ?? []).map((b) => b.blockId);

const achatar = (blocks, d = 0, out = []) => {
  for (const b of blocks ?? []) {
    out.push({ id: b.blockId, depth: d, bloco: b });
    achatar(b.children, d + 1, out);
    achatar(b.elseChildren, d + 1, out);
  }
  return out;
};

/* ================= 1. duplicação ================= */

test("dois motores em portas diferentes viram blocos diferentes", () => {
  // Regressão: `Port` não estava em ENUMS, então enumValue devolvia sempre
  // null e AMBOS os motores caíam no "A" de reserva. O nome também era
  // reescrito pelo py(), e o resultado eram dois blocos idênticos.
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n",
  );
  assert.equal(sm.blocks.length, 2, "dois motores, dois blocos");
  assert.deepEqual(sm.blocks.map((b) => b.params.port).sort(), ["A", "B"]);
  assert.deepEqual(sm.blocks.map((b) => b.params.var).sort(), ["dir_", "esq"]);
});

test("round-trip preserva o nome que a equipe escolheu", () => {
  const src = "from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n";
  const sm = new SyncManager();
  sm.runPipeline(src);
  const py = generateProgram(sm.blocks, { userFunctions: [], libraryFunctions: [] });
  assert.match(py, /esq = Motor\(Port\.B/, `nome esq perdido:\n${py}`);
  assert.match(py, /dir_ = Motor\(Port\.A/, `nome dir_ perdido:\n${py}`);
});

test("quatro motores em quatro portas continuam quatro", () => {
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "a = Motor(Port.A)\nb = Motor(Port.B)\nc = Motor(Port.C)\nd = Motor(Port.D)\n",
  );
  assert.equal(sm.blocks.length, 4);
  assert.equal(new Set(sm.blocks.map((b) => b.params.port)).size, 4, "as portas não podem se repetir");
  assert.equal(new Set(sm.blocks.map((b) => b.params.var)).size, 4, "os nomes não podem se repetir");
});

test("apagar um irmão NÃO passa a identidade para o outro", () => {
  /*
   * Este é o bug de "duplicar sem motivo". A chave de reconciliação era
   * só `tipo|ocorrência|profundidade`: `esq` e `dir_` são os dois
   * `motor_setup`, então o que sobrou depois de apagar o primeiro herdava
   * o id, a posição e o estado de expansão do que foi apagado. Na tela,
   * era um bloco que "não saía" e outro que sumia sozinho.
   */
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n",
  );
  const idEsq = sm.blocks[0].id;
  const idDir = sm.blocks[1].id;
  assert.notEqual(idEsq, idDir);

  sm.runPipeline("from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\ndir_ = Motor(Port.A)\n");
  assert.equal(sm.blocks.length, 1);
  assert.equal(sm.blocks[0].id, idDir, "o bloco que continua precisa ser ELE MESMO");
  assert.notEqual(sm.blocks[0].id, idEsq, "não pode herdar o id do que foi apagado");
});

test("editar um irmão não move o outro", () => {
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n",
  );
  const antes = sm.blocks.map((b) => ({ id: b.id, port: b.params.port }));
  sm.blocks[0].params.port = "C";
  sm.applyBlockEdit(sm.blocks[0]);
  assert.equal(sm.blocks.length, 2, "editar não pode criar nem apagar blocos");
  assert.equal(sm.blocks.find((b) => b.params.var === "dir_").params.port, "A",
    "o irmão não pode mudar de porta junto");
  assert.equal(antes.length, 2);
});

test("reconciliação distingue irmãos com o mesmo tipo e conteúdos diferentes", () => {
  const opts = { userFunctions: [], libraryFunctions: [] };
  const ir = (code) => irToBlocks(parseProgram(code).ir, opts).blocks;
  const a = ir("from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n");
  const b = ir("from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n");
  const out = reconcileBlocks(a, b);
  assert.equal(out[0].id, a[0].id, "o de cima continua sendo o de cima");
  assert.equal(out[1].id, a[1].id, "o de baixo continua sendo o de baixo");
});

/* ================= 2. colar código precisa gerar blocos ================= */

test("código colado do Pybricks vira blocos, sem sobras", () => {
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.hubs import InnovationHub\nfrom pybricks.motor import Motor\n" +
    "from pybricks.robotics import DriveBase\nfrom pybricks.parameters import Port\n\n" +
    "hub = InnovationHub()\nesq = Motor(Port.B)\nrobo = DriveBase(esq, Motor(Port.A), 62.4, 48)\nrobo.straight(200)\n",
  );
  assert.equal(sm.diagnostics.length, 0, "o código colado precisa parsear limpo");
  assert.ok(sm.blocks.length >= 4, `esperava vários blocos, veio ${sm.blocks.length}`);
  assert.deepEqual(
    sm.blocks.map((b) => b.blockId),
    ["var_set", "motor_setup", "movement_setup", "movement_straight"],
  );
});

test("não sobra nenhuma linha sem bloco", () => {
  const codigo =
    "from pybricks.hubs import PrimeHub\nfrom pybricks.motor import Motor\n" +
    "from pybricks.robotics import DriveBase\nfrom pybricks.parameters import Port\n\n" +
    "K = 1.8\n\n" +
    "def girar(graus):\n    hub.rotation_angle = 0\n    return hub.rotation_angle\n\n" +
    "def main():\n    hub = PrimeHub()\n    esq = Motor(Port.B)\n" +
    "    robo = DriveBase(esq, Motor(Port.A), 62.4, 48)\n" +
    "    if K > 1:\n        robo.straight(100)\n    else:\n        robo.straight(50)\n" +
    "    while robo.distance() < 10:\n        robo.drive(50, 0)\n" +
    "    for i in range(3):\n        hub.speaker.beep(1000)\n\nmain()\n";
  const { blocks, pythonOnly, representedLines } = irToBlocks(parseProgram(codigo).ir,
    { userFunctions: [], libraryFunctions: [] });
  const comCodigo = codigo.split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.trim() && !/^\s*(from|import)\s/.test(l));
  for (const [linha] of comCodigo) {
    assert.ok(representedLines.has(linha), `a linha ${linha} não virou bloco`);
  }
  assert.equal(pythonOnly.length, 0, `sobraram ${pythonOnly.length} linhas sem representação`);
  assert.ok(blocks.length > 0);
});

test("o programa dentro do chapéu aparece na ordem em que roda", () => {
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.hubs import PrimeHub\nfrom pybricks.motor import Motor\n" +
    "from pybricks.robotics import DriveBase\nfrom pybricks.parameters import Port\n\n" +
    "def main():\n    hub = PrimeHub()\n    esq = Motor(Port.B)\n" +
    "    robo = DriveBase(esq, Motor(Port.A), 62.4, 48)\n" +
    "    if K > 1:\n        robo.straight(100)\n    else:\n        robo.straight(50)\n" +
    "    while robo.distance() < 10:\n        robo.drive(50, 0)\n" +
    "    for i in range(3):\n        hub.speaker.beep(1000)\n\nmain()\n",
  );
  /*
   * A ordem é a do ARQUIVO, e é a ordem em que o robô executa:
   * configuração, depois decisão, depois laço, depois repetição.
   * `if` e `senão` são o MESMO bloco com dois corpos — não são dois blocos
   * na sequência, senão a criança leria "andou 100, andou 50" em vez de
   * "ou um, ou o outro".
   */
  const plano = achatar(sm.blocks);
  const ordem = plano.map((n) => `${n.depth}:${n.id}`);
  assert.deepEqual(ordem, [
    "0:event_program_start", // o chapéu
    "1:hub_setup",           // configurar
    "1:motor_setup",
    "1:movement_setup",
    "1:control_if_else",     // decidir
    "2:movement_straight",   // caminho 1
    "2:movement_straight",   // caminho 2 (o "senão")
    "1:control_while",       // repetir enquanto
    "2:movement_drive",
    "1:control_repeat",      // repetir N vezes
    "2:sound_beep",
  ]);

  // e o código é o mesmo quando volta para o Python
  const py = generateProgram(sm.blocks, { userFunctions: [], libraryFunctions: [] });
  const linhas = py.split("\n").map((l) => l.trim()).filter(Boolean);
  const posIf = linhas.findIndex((l) => l.startsWith("if "));
  const posWhile = linhas.findIndex((l) => l.startsWith("while "));
  const posFor = linhas.findIndex((l) => l.startsWith("for "));
  assert.ok(posIf >= 0 && posWhile > posIf && posFor > posWhile,
    `a ordem do Python também tem que ser if -> while -> for:\n${py}`);
});

test("condicional mantém o `senão` no lugar certo", () => {
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    if a > b:\n        x = 1\n    else:\n        x = 2\n\nmain()\n");
  const bloco = achatar(sm.blocks).find((n) => n.id === "control_if_else").bloco;
  assert.equal(bloco.children.length, 1);
  assert.equal(bloco.elseChildren.length, 1, "o `senão` não pode sumir");
});

/* ================= 3. round-trip do que a criança fez ================= */

test("editar a porta escreve no Python certo, sem tocar no irmão", () => {
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n",
  );
  sm.blocks[0].params.port = "C";
  sm.applyBlockEdit(sm.blocks[0]);
  assert.match(sm.code, /esq = Motor\(Port\.C/);
  assert.match(sm.code, /dir_ = Motor\(Port\.A/, "o irmão não pode ser reescrito");
  assert.equal(sm.code.split("Motor(Port.").length - 1, 2, "exatamente dois motores, nenhum a mais");
});

/* ================= 4. inserir da paleta ================= */

test("inserir da paleta escreve no arquivo, mesmo sem `def main()`", () => {
  /*
   * Regressão grave: sem `def main()` no arquivo, `insertBlock` devolvia
   * `changed: false` e o bloco clicado era DESCARTADO. O único efeito na
   * tela era um `main()` órfão no fim — para a criança, "inserir bloco não
   * funciona".
   */
  const spec = BLOCK_BY_ID.get("sound_beep");
  const block = { id: "b1", blockId: spec.id, schema: spec.id, category: spec.category,
    shape: spec.shape, params: blockDefaults(spec), children: [], elseChildren: [], source: null };
  const antes = "from pybricks.hubs import PrimeHub\n\nx = 1\n";
  const r = insertBlock(antes, block, "bottom");
  assert.equal(r.changed, true, "a inserção tem que alterar o arquivo");
  assert.match(r.code, /beep|1000|speaker/, `o bloco não foi escrito:\n${r.code}`);
});

test("motor novo da paleta pega a próxima porta livre", () => {
  /*
   * Sem isto, dois cliques criavam DUAS linhas `motor_a = Motor(Port.A)`:
   * a segunda sobrescreve a primeira quando o robô roda. A duplicata vinha
   * daqui, e não de um defeito na reconciliação.
   */
  const spec = BLOCK_BY_ID.get("motor_setup");
  const mk = (params) => ({ id: `b_${Math.random()}`, blockId: spec.id, schema: spec.id,
    category: spec.category, shape: spec.shape, params, children: [], elseChildren: [], source: null });
  const sm = new SyncManager();
  let code = "from pybricks.motor import Motor\nfrom pybricks.parameters import Port\n\n" +
    "esq = Motor(Port.B)\ndir_ = Motor(Port.A)\n";
  sm.runPipeline(code);
  for (const [n, esperado] of ["C", "D"].entries()) {
    const d = blockDefaults(spec);
    const emUso = new Set(sm.blocks.map((b) => b.params?.port).filter(Boolean));
    const livre = ["A", "B", "C", "D", "E", "F"].find((p) => !emUso.has(p));
    if (livre) d.port = livre;
    code = insertBlock(code, mk(d), "bottom").code;
    sm.runPipeline(code);
    // O arquivo começou com 2 motores; cada inserção acrescenta exatamente 1.
    const linhas = sm.code.split("\n").filter((l) => l.includes("= Motor("));
    assert.equal(linhas.length, 2 + n + 1,
      `cada inserção acrescenta UM motor, não uma cópia:\n${sm.code}`);
    assert.ok(linhas.some((l) => l.includes(`Port.${esperado}`)), `faltou a porta ${esperado}:\n${sm.code}`);
  }
  // nenhuma porta repetida
  const portas = sm.blocks.map((b) => b.params.port);
  assert.equal(new Set(portas).size, portas.length, `portas repetidas: ${portas.join(",")}`);
});

/* ================= 5. import automático ================= */

test("colar código sem import acrescenta a linha sozinho", () => {
  /*
   * Sem isto, colar `hub = PrimeHub()` deixava o arquivo quebrado: o bloco
   * aparecia, o Python não rodava e o `NameError` só apareceria no robô.
   */
  const sm = new SyncManager();
  sm.runPipeline("def main():\n    hub = PrimeHub()\n\nmain()\n");
  assert.match(sm.code, /from pybricks\.hubs import PrimeHub/,
    `o import deveria ter sido escrito:\n${sm.code}`);
  assert.equal(sm.state, "synced");
});

test("o import escrito é o que os blocos realmente usam", () => {
  const sm = new SyncManager();
  sm.runPipeline(
    "def main():\n    hub = PrimeHub()\n    esq = Motor(Port.B)\n" +
    "    robo = DriveBase(esq, Motor(Port.A), 62.4, 48)\n\nmain()\n",
  );
  assert.match(sm.code, /from pybricks\.hubs import PrimeHub/);
  assert.match(sm.code, /from pybricks\.pupdevices import Motor/);
  assert.match(sm.code, /from pybricks\.parameters import Port/);
  assert.match(sm.code, /from pybricks\.robotics import DriveBase/);
  // E o resultado tem que continuar parseando.
  assert.equal(sm.diagnostics.length, 0, `o arquivo gerado não é válido:\n${sm.code}`);
});

test("import que já existe não é duplicado", () => {
  const sm = new SyncManager();
  sm.runPipeline(
    "from pybricks.hubs import PrimeHub\n\ndef main():\n    hub = PrimeHub()\n\nmain()\n",
  );
  const quantas = sm.code.split("from pybricks.hubs import").length - 1;
  assert.equal(quantas, 1, `import repetido:\n${sm.code}`);
});

test("rodar o pipeline de novo não acumula import", () => {
  const sm = new SyncManager();
  const codigo = "def main():\n    hub = PrimeHub()\n\nmain()\n";
  sm.runPipeline(codigo);
  const umaVez = sm.code;
  for (let i = 0; i < 5; i += 1) sm.runPipeline(umaVez);
  assert.equal(sm.code, umaVez, "o pipeline passou escrevendo import de novo");
});

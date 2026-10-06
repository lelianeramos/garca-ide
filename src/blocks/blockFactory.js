/**
 * BLOCK FACTORY — IR -> BLOCOS
 * ----------------------------
 * Implementa a REGRA ARQUITETURAL CENTRAL (Parte 3.2):
 *
 *   PROIBIDO:    Python -> procurar string -> escolher bloco fixo
 *   OBRIGATÓRIO: Python -> entender estrutura -> entender significado
 *                -> resolver API no registry -> criar IR -> renderizar bloco
 *
 * O reconhecimento abaixo é feito sobre a IR (nós tipados: callExpression,
 * assignment, loop, condition...). Nenhum `includes("Motor")`. Nenhum
 * if/else encadeado por texto (N05, N06).
 *
 * Quando nada casa, o nó vira `pythonExpression`: o código PERMANECE no
 * editor, intacto, e o indicador mostra "Parcial" (Parte 14.4). Nunca vira
 * bloco cinza (N01) e nunca é apagado (N04).
 */

import { BLOCK_BY_ID, blockDefaults, sign, units, MM_PER_ROTATION, WHEEL_DIAMETER_MM, AXLE_TRACK_MM } from "./blockCatalog.js";
import { ROBOT_CONFIG } from "../config/robot.js";
import { unparse, describeCallee, parseProgram } from "../parser/pythonParser.js";
import { resolve as resolveApi, ENUMS, PYBRICKS_API } from "../pybricks/apiRegistry.js";
import { isBlockValue } from "./socket.js";
import { chamadaParaIR } from "../semantic/semanticCall.js";
import { blocoParaChamada } from "../semantic/blockAdapter.js";

/* ------------------------------------------------------------------ */
/* Leitura de argumentos da IR                                         */
/* ------------------------------------------------------------------ */

const num = (node) => {
  if (!node) return null;
  if (node.type === "literal" && node.literalKind === "number") return Number(node.value);
  if (node.type === "unaryOperation" && node.operator === "-") {
    const inner = num(node.operand);
    return inner === null ? null : -inner;
  }
  if (node.type === "variableReference") return { identifier: node.name };
  return { source: unparse(node) };
};

const isNum = (value) => typeof value === "number" && Number.isFinite(value);

const str = (node) => {
  if (!node) return null;
  if (node.type === "literal" && node.literalKind === "string") return String(node.value);
  return { source: unparse(node) };
};

const plainStr = (node) => {
  const value = str(node);
  return typeof value === "string" ? value : null;
};

/** Color.RED -> "RED" ; Port.A -> "A" ; Stop.HOLD -> "hold" */
const enumValue = (node, kind) => {
  if (!node) return null;
  if (node.type === "attribute" && node.object?.type === "variableReference" && node.object.name === kind) {
    return ENUMS[kind]?.includes(node.attribute) ? node.attribute : null;
  }
  if (node.type === "variableReference" && ENUMS[kind]?.includes(node.value)) return node.value;
  return null;
};

/**
 * TEXTO DE UMA ATRIBUIÇÃO, reconstruído a partir do IR.
 *
 * `unparse` não cobre `assignment`: ele sabe escrever expressões, não
 *Statements. Sem isto, o bloco de fallback recebia `code: ""` e gerava uma
 * linha em branco — a linha deixava de sumir, mas voltava vazia.
 *
 * A reconstrução usa a IR (alvo + operador + valor), não o texto original,
 * porque é a IR que sobrevive a qualquer mudança no arquivo.
 */
const assignmentText = (node) => {
  const alvo = (t) => (t?.type === "variableReference" ? t.name : unparse(t) ?? "");
  if (node.type === "augmentedAssignment") {
    /*
     * `node.operator` JÁ vem com o sinal (`"+"`, `"+="`, `"//="`).
     * Acrescentar outro `=` produzia `x.total +== 1` — Python inválido, que
     * quebrava o programa inteiro por causa de uma linha.
     */
    const op = String(node.operator ?? "+");
    const sep = op.endsWith("=") ? "" : "=";
    return `${alvo(node.target)} ${op}${sep} ${unparse(node.value) ?? ""}`;
  }
  if (node.type !== "assignment") return unparse(node) ?? "";
  // Todos os alvos: `a, b = 1, 2` precisa devolver os DOIS, senão o `b`
  // desaparece do programa na ida e na volta.
  const alvos = (node.targets ?? []).map(alvo).join(", ");
  const elementoDeTupla = (v) => unparse(v) ?? "";
  const valor = (node.targets?.length ?? 0) > 1
    // Vários alvos exigem uma tupla à direita: `a, b = 1, 2`, nunca
    // `a, b = 1` (que desempacota um int e estoura em tempo de execução).
    ? `(${Array.from({ length: node.targets.length }, (_, i) =>
        elementoDeTupla(node.value?.elements?.[i] ?? { type: "literal", literalKind: "number", value: 0 })).join(", ")})`
    : node.value?.type === "tuple" || Array.isArray(node.value?.elements)
      ? `[${(node.value.elements ?? []).map(elementoDeTupla).join(", ")}]`
      : unparse(node.value) ?? "";
  return `${alvos} = ${valor}`;
};

const boolValue = (node) => {
  if (!node) return null;
  if (node.type === "literal" && node.literalKind === "boolean") return Boolean(node.value);
  return null;
};

/** motor_a -> "A" */
const portFromVariable = (name) => {
  const match = /^motor_([a-f])$/i.exec(String(name || ""));
  return match ? match[1].toUpperCase() : null;
};

/**
 * CLASSES DE HUB DO PYBRICKS, lidas do registro.
 *
 * Derivado de propósito: a lista escrita à mão já divergiu do catálogo uma
 * vez, e a falha foi silenciosa.
 */
const HUB_CLASSES = new Set(
  PYBRICKS_API
    .filter((api) => api.module === "pybricks.hubs" && api.kind === "constructor")
    .map((api) => String(api.name).split(".").pop()),
);

/** Portas padrão de tração, vindas da configuração do robô. */
const DEFAULT_DRIVE_PORTS = { left: ROBOT_CONFIG.left_port, right: ROBOT_CONFIG.right_port };

const STOP_FROM_PY = { HOLD: "hold", BRAKE: "brake", COAST: "coast", NONE: "coast" };

/* ------------------------------------------------------------------ */
/* Desmontagem de unidades (inverso de Parte 13.3)                     */
/* ------------------------------------------------------------------ */

/** graus -> { amount, unit, direction } */
function motorAngleToUi(angle) {
  const direction = angle < 0 ? "ccw" : "cw";
  const magnitude = Math.abs(angle);
  if (magnitude % 360 === 0) return { amount: magnitude / 360, unit: "rotations", direction };
  return { amount: magnitude, unit: "degrees", direction };
}

/** ms -> { amount, unit } */
function msToUi(ms) {
  if (Math.abs(ms) % 1000 === 0) return { amount: ms / 1000, unit: "seconds" };
  return { amount: ms, unit: "ms" };
}

/** mm do DriveBase -> { amount, unit, direction } */
function driveDistanceToUi(mm) {
  const direction = mm < 0 ? "backward" : "forward";
  const magnitude = Math.abs(mm);
  const rotations = magnitude / MM_PER_ROTATION;
  if (Math.abs(rotations - Math.round(rotations)) < 0.02 && Math.round(rotations) > 0) {
    return { amount: Math.round(rotations), unit: "rotations", direction };
  }
  if (magnitude % 10 === 0) return { amount: magnitude / 10, unit: "cm", direction };
  return { amount: Math.round(magnitude), unit: "mm", direction };
}

/** graus/s -> % (750 -> 75) */
const percentFromSpeed = (speed) => Math.round((Math.abs(Number(speed) || 0) / 10) * 10) / 10;

/* ------------------------------------------------------------------ */
/* Regras de reconhecimento                                            */
/*                                                                     */
/* Cada regra: { test(ctx) -> bool, build(ctx) -> {blockId, params} }  */
/* ctx = { node, callee, objectVar, method, args, kwargs, argNum,      */
/*         argStr, argEnum, kw }                                       */
/* ------------------------------------------------------------------ */

const callRule = (methodPattern, build) => ({
  kind: "call",
  methodPattern,
  build,
});

const CALL_RULES = [
  /* ---------- Motores ---------- */
  callRule(/^([a-f])\.run_angle$/, (ctx) => {
    const angle = ctx.argNum(1);
    if (!isNum(angle)) return null;
    const ui = motorAngleToUi(angle);
    const then = ctx.argEnum(2, "Stop") ?? ctx.kwEnum("then", "Stop");
    return {
      blockId: "motor_run_angle",
      params: {
        port: ctx.objectVar.port, direction: ui.direction, amount: ui.amount, unit: ui.unit,
        speed: Math.abs(ctx.argNum(0) ?? 500), then: then ? STOP_FROM_PY[then] : "hold",
      },
    };
  }),

  callRule(/^([a-f])\.run_target$/, (ctx) => {
    const then = ctx.argEnum(2, "Stop") ?? ctx.kwEnum("then", "Stop");
    return {
      blockId: "motor_run_target",
      params: {
        port: ctx.objectVar.port, direction: (ctx.argNum(1) ?? 0) < 0 ? "ccw" : "cw",
        target: Math.abs(ctx.argNum(1) ?? 0), speed: Math.abs(ctx.argNum(0) ?? 500),
        then: then ? STOP_FROM_PY[then] : "hold",
      },
    };
  }),

  callRule(/^([a-f])\.run_time$/, (ctx) => {
    const ms = ctx.argNum(1);
    if (!isNum(ms)) return null;
    const ui = msToUi(ms);
    return {
      blockId: "motor_run_time",
      params: { port: ctx.objectVar.port, direction: (ctx.argNum(0) ?? 0) < 0 ? "ccw" : "cw", amount: ui.amount, unit: ui.unit, speed: Math.abs(ctx.argNum(0) ?? 500) },
    };
  }),

  callRule(/^([a-f])\.run$/, (ctx) => ({
    blockId: "motor_run",
    params: { port: ctx.objectVar.port, direction: (ctx.argNum(0) ?? 0) < 0 ? "ccw" : "cw", speed: Math.abs(ctx.argNum(0) ?? 500) },
  })),

  callRule(/^([a-f])\.(stop|brake|hold)$/, (ctx) => ({
    blockId: "motor_stop",
    params: { port: ctx.objectVar.port, mode: ctx.method },
  })),

  callRule(/^([a-f])\.dc$/, (ctx) => ({
    blockId: "motor_dc", params: { port: ctx.objectVar.port, duty: ctx.argNum(0) ?? 50 },
  })),

  callRule(/^([a-f])\.angle$/, (ctx) => ({ blockId: "motor_position", params: { port: ctx.objectVar.port } })),
  callRule(/^([a-f])\.speed$/, (ctx) => ({ blockId: "motor_speed", params: { port: ctx.objectVar.port } })),
  callRule(/^([a-f])\.stalled$/, (ctx) => ({ blockId: "motor_stalled", params: { port: ctx.objectVar.port } })),
  callRule(/^([a-f])\.reset_angle$/, (ctx) => ({ blockId: "motor_reset_angle", params: { port: ctx.objectVar.port } })),

  callRule(/^([a-f])\.control\.pid$/, (ctx) => ({
    blockId: "motor_pid",
    params: {
      port: ctx.objectVar.port,
      kp: ctx.kwNum("kp") ?? ctx.argNum(0) ?? 45,
      ki: ctx.kwNum("ki") ?? ctx.argNum(1) ?? 0,
      kd: ctx.kwNum("kd") ?? ctx.argNum(2) ?? 0,
    },
  })),

  callRule(/^([a-f])\.settings$/, (ctx) => {
    const acceleration = ctx.kwNum("acceleration");
    if (isNum(acceleration)) return { blockId: "motor_acceleration", params: { port: ctx.objectVar.port, value: acceleration } };
    return null;
  }),

  /* ---------- Movimento (DriveBase) ---------- */
  callRule(/^robot\.straight$/, (ctx) => {
    const mm = ctx.argNum(0);
    if (!isNum(mm)) return null;
    const ui = driveDistanceToUi(mm);
    return { blockId: "movement_straight", params: { direction: ui.direction, amount: ui.amount, unit: ui.unit } };
  }),

  callRule(/^robot\.turn$/, (ctx) => {
    const angle = ctx.argNum(0);
    if (!isNum(angle)) return null;
    return { blockId: "movement_turn", params: { direction: angle < 0 ? "ccw" : "cw", angle: Math.abs(angle) } };
  }),

  callRule(/^robot\.curve$/, (ctx) => ({
    blockId: "movement_curve", params: { radius: ctx.argNum(0) ?? 200, angle: ctx.argNum(1) ?? 90 },
  })),

  /*
    `robot.drive(v, t)` / `gb.drive(v, t)`

    O caminho ideal continua sendo o `movement_drive` — ele traduz o Pybricks
    para o vocabulário "iniciar movimento", que é o que a criança aprende.

    Só que esse bloco tem campos NUMÉRICOS, e o programa de stress calcula
    a velocidade (`velocidade_atual * direcao`) antes de chamar. Antes, a
    regra aceitava a chamada e devolvia `speed: NaN` — o Python saía com
    `robot.drive(NaN, NaN)`. Um NaN silencioso é pior que pythonOnly.

    Agora: se os dois argumentos são números literais, o bloco didático; se
    algum é expressão, o bloco honesto `pybricks_call`, que preserva objeto,
    método e argumentos e regenera o Python idêntico.
  */
  callRule(/^(?:robot|gb)\.drive$/, (ctx) => {
    const speed = ctx.argNum(0);
    const turn = ctx.argNum(1);
    if (isNum(speed) && isNum(turn)) {
      return {
        blockId: "movement_drive",
        params: {
          direction: speed < 0 ? "backward" : "forward",
          speed: Math.abs(speed), turn_rate: turn,
          object: ctx.calleeObject || "robot",
        },
      };
    }
    const args = (ctx.args ?? []).map((arg) => expressionToBlock(arg)).filter(Boolean);
    return {
      blockId: "pybricks_call",
      params: { object: "gb", method: "drive", args: args.length ? args : "" },
    };
  }),

  callRule(/^robot\.stop$/, (ctx) => ({ blockId: "movement_stop", params: { object: ctx.calleeObject || "robot" } })),
  callRule(/^robot\.distance$/, (ctx) => ({ blockId: "movement_distance", params: { object: ctx.calleeObject || "robot" } })),
  callRule(/^robot\.angle$/, (ctx) => ({ blockId: "movement_angle", params: { object: ctx.calleeObject || "robot" } })),
  callRule(/^robot\.reset$/, (ctx) => ({ blockId: "movement_reset", params: { object: ctx.calleeObject || "robot" } })),
  callRule(/^robot\.stalled$/, (ctx) => ({ blockId: "movement_stalled", params: { object: ctx.calleeObject || "robot" } })),

  callRule(/^robot\.settings$/, (ctx) => {
    const straightSpeed = ctx.kwNum("straight_speed");
    if (isNum(straightSpeed)) return { blockId: "movement_speed", params: { percent: percentFromSpeed(straightSpeed) } };
    const turnRate = ctx.kwNum("turn_rate");
    if (isNum(turnRate)) return { blockId: "movement_turn_rate", params: { rate: turnRate } };
    return null;
  }),

  /* ---------- HUB: display / light ---------- */
  callRule(/^hub\.display\.icon$/, (ctx) => ({
    blockId: "light_icon", params: { icon: ctx.argEnum(0, "Icon") ?? "HEART" },
  })),
  callRule(/^hub\.display\.char$/, (ctx) => ({ blockId: "light_char", params: { character: plainStr(ctx.args[0]) ?? "A" } })),
  callRule(/^hub\.display\.text$/, (ctx) => ({ blockId: "light_text", params: { text: plainStr(ctx.args[0]) ?? "" } })),
  callRule(/^hub\.display\.number$/, (ctx) => ({ blockId: "light_number", params: { value: ctx.argNum(0) ?? 0 } })),
  callRule(/^hub\.display\.off$/, () => ({ blockId: "light_off", params: {} })),
  callRule(/^hub\.display\.pixel$/, (ctx) => ({
    blockId: "light_pixel",
    // Pybricks 0..4 -> interface 1..5
    params: { row: (ctx.argNum(0) ?? 0) + 1, column: (ctx.argNum(1) ?? 0) + 1, brightness: ctx.argNum(2) ?? 100 },
  })),
  callRule(/^hub\.display\.orientation$/, (ctx) => ({ blockId: "light_orientation", params: { angle: ctx.argNum(0) ?? 0 } })),
  callRule(/^hub\.light\.on$/, (ctx) => ({ blockId: "light_center", params: { color: ctx.argEnum(0, "Color") ?? "GREEN" } })),
  callRule(/^hub\.light\.off$/, () => ({ blockId: "light_center_off", params: {} })),

  /* ---------- HUB: som ---------- */
  callRule(/^hub\.speaker\.beep$/, (ctx) => {
    const duration = ctx.argNum(1);
    const frequency = ctx.argNum(0) ?? 500;
    if (duration === -1) return { blockId: "sound_beep_start", params: { frequency } };
    const ui = isNum(duration) ? msToUi(duration) : { amount: 0.5, unit: "seconds" };
    return { blockId: "sound_beep", params: { seconds: ui.unit === "seconds" ? ui.amount : ui.amount / 1000, frequency } };
  }),
  callRule(/^hub\.speaker\.play_notes$/, (ctx) => {
    const list = ctx.args[0];
    const notes = list?.type === "list"
      ? list.items.map((item) => plainStr(item)).filter((v) => v !== null).join(" ")
      : null;
    const waitFlag = ctx.kwBool("wait");
    if (waitFlag === false) return { blockId: "sound_notes_start", params: { notes: notes ?? "" } };
    if (notes !== null && /^R\//.test(notes)) return { blockId: "sound_rest", params: { beats: Number(notes.slice(2)) || 0.5 } };
    if (notes !== null && /^[A-G]#\d\//.test(notes)) {
      const [note, beats] = notes.split("/");
      return { blockId: "sound_note", params: { note, beats: Number(beats) || 0.5 } };
    }
    return { blockId: "sound_notes", params: { notes: notes ?? "" } };
  }),
  callRule(/^hub\.speaker\.stop$/, () => ({ blockId: "sound_stop", params: {} })),
  callRule(/^hub\.speaker\.set_volume$/, (ctx) => ({ blockId: "sound_volume", params: { percent: ctx.argNum(0) ?? 75 } })),
  callRule(/^hub\.speaker\.volume$/, () => ({ blockId: "sound_volume_read", params: {} })),

  /* ---------- HUB: IMU / botões / bateria ---------- */
  callRule(/^hub\.imu\.heading$/, () => ({ blockId: "sensor_heading", params: {} })),
  callRule(/^hub\.imu\.reset_heading$/, () => ({ blockId: "sensor_reset_heading", params: {} })),
  callRule(/^hub\.imu\.up$/, () => null), // usado como comparação -> ver COMPARISON_RULES
  callRule(/^hub\.imu\.acceleration$/, () => null),
  callRule(/^hub\.imu\.angular_velocity$/, () => null),
  callRule(/^hub\.buttons\.pressed$/, (ctx) => ({
    blockId: "sensor_button_pressed", params: { button: ctx.argEnum(0, "Button") ?? "LEFT" },
  })),
  callRule(/^hub\.battery\.voltage$/, () => ({ blockId: "sensor_battery", params: {} })),
  callRule(/^hub\.system\.shutdown$/, () => ({ blockId: "hub_shutdown", params: {} })),

  /* ---------- Sensores ---------- */
  callRule(/^color\.color$/, () => ({ blockId: "sensor_color", params: {} })),
  callRule(/^color\.reflection$/, () => ({ blockId: "sensor_reflection", params: {} })),
  callRule(/^color\.ambient$/, () => ({ blockId: "sensor_reflection", params: {} })),
  callRule(/^distance\.distance$/, () => ({ blockId: "sensor_distance_mm", params: {} })),
  callRule(/^force\.force$/, () => ({ blockId: "sensor_force", params: {} })),
  callRule(/^force\.pressed$/, () => ({ blockId: "sensor_pressed", params: {} })),
  callRule(/^timer\.time$/, () => ({ blockId: "sensor_timer", params: {} })),
  callRule(/^timer\.reset$/, () => ({ blockId: "sensor_timer_reset", params: {} })),

  /* ---------- Ferramentas ---------- */
  callRule(/^wait$/, (ctx) => {
    const ms = ctx.argNum(0);
    if (!isNum(ms)) return null;
    const ui = msToUi(ms);
    return { blockId: "control_wait", params: { amount: ui.amount, unit: ui.unit } };
  }),
  callRule(/^multitask$/, (ctx) => ({
    blockId: "control_multitask", params: { tasks: ctx.args.map(unparse).join(", ") },
  })),
  callRule(/^mailbox\.send$/, (ctx) => ({ blockId: "event_broadcast", params: { message: plainStr(ctx.args[0]) ?? "mensagem1" } })),

  /* ---------- Operadores / built-ins ---------- */
  callRule(/^randint$/, (ctx) => ({ blockId: "op_random", params: { min: ctx.argNum(0) ?? 1, max: ctx.argNum(1) ?? 10 } })),
  callRule(/^round$/, (ctx) => ({ blockId: "op_round", params: { value: ctx.argNum(0) ?? 0 } })),
  /*
    BUILTINS com socket de expressão.

    `abs(gb.distance())` usava `ctx.argNum(0)`, que só sabe extrair
    NÚMERO LITERAL. Para um argumento que não é número, o resultado era um
    objeto intermediário quebrado — o bloco aparecia mas o Python saía
    `abs({"source":"gb.distance()"})`. O mesmo acontecia com
    `max(1, int(velocidade / 5))`, um dos exemplos do programa de stress.

    Agora o argumento passa por `expressionToBlock`, que devolve um bloco
    encaixado. `int` e `float` entraram porque `int(velocidade / 5)`
    aparecia no programa real e não tinha representação alguma.
  */
  callRule(/^abs$/, (ctx) => ({ blockId: "op_abs", params: { value: ctx.argExpr(0) ?? 0 } })),
  callRule(/^min$/, (ctx) => ({ blockId: "op_min", params: { a: ctx.argExpr(0) ?? 0, b: ctx.argExpr(1) ?? 0 } })),
  callRule(/^max$/, (ctx) => ({ blockId: "op_max", params: { a: ctx.argExpr(0) ?? 0, b: ctx.argExpr(1) ?? 0 } })),
  callRule(/^int$/, (ctx) => ({ blockId: "op_int", params: { value: ctx.argExpr(0) ?? 0 } })),
  callRule(/^float$/, (ctx) => ({ blockId: "op_float", params: { value: ctx.argExpr(0) ?? 0 } })),
  callRule(/^str$/, (ctx) => ({ blockId: "op_str", params: { value: ctx.argExpr(0) ?? 0 } })),
  callRule(/^round$/, (ctx) => ({ blockId: "op_round", params: { value: ctx.argExpr(0) ?? 0 } })),
  callRule(/^len$/, (ctx) => ({ blockId: "op_length", params: { text: ctx.argText(0) ?? "" } })),
  callRule(/^len$/, (ctx) => {
    const arg = ctx.args[0];
    if (arg?.type === "variableReference") return { blockId: "list_length", params: { name: arg.name } };
    if (arg?.type === "literal" && arg.literalKind === "string") return { blockId: "op_length", params: { text: arg.value } };
    return null;
  }),
  callRule(/^print$/, (ctx) => {
    /*
     * `print` com MAIS DE UM argumento, ou com `sep=`/`end=`, NÃO pode virar
     * "mostrar variável" nem "falar no hub". A regra antiga olhava só
     * `ctx.args[0]` e jogava o resto fora: `print('a', 'b')` virava
     * `print("a")` — código diferente, e a criança perdia informação sem
     * nenhum aviso.
     *
     * A forma simples (um argumento só, sem palavra-chave) continua virando
     * o bloco amigável; o resto cai no bloco genérico, que preserva a
     * chamada inteira.
     */
    const args = ctx.args ?? [];
    const temPalavraChave = (ctx.node?.keywords ?? []).length > 0;
    if (args.length === 1 && !temPalavraChave) {
      const arg = args[0];
      if (arg?.type === "variableReference") return { blockId: "var_show", params: { name: arg.name } };
      if (arg?.type === "literal" && arg.literalKind === "string") return { blockId: "hub_print", params: { text: arg.value } };
      return { blockId: "hub_print", params: { text: unparse(arg) } };
    }
    return null;
  }),
];

/* ---------- Atribuições (construtores / variáveis / listas) ---------- */

const ASSIGN_RULES = [
  // motor_a = Motor(Port.B, Direction.COUNTERCLOCKWISE)
  (ctx) => {
    const call = ctx.valueNode;
    if (call?.type !== "callExpression") return null;
    const callee = describeCallee(call.callee);
    if (callee !== "Motor" || !ctx.targetName) return null;
    /*
     * A PORTA vem do ARGUMENTO, não do nome da variável.
     *
     * Antes a ordem era invertida: primeiro tentava adivinhar a porta pelo
     * nome (`esq` -> `motor_?` -> nada) e só depois olhava `Port.B`. Como o
     * nome da equipe nunca segue o padrão, o palpite falhava e o `?? "A"`
     * final fazia TODO motor virar porta A. Era daí que vinha a duplicata
     * que a criança via: `esq = Motor(Port.B)` e `dir_ = Motor(Port.A)`
     * produziam dois blocos idênticos "motor na porta A".
     *
     * O argumento é a informação que existe de fato no arquivo. O nome só
     * serve de reserva, e só quando casa com o padrão `motor_x`.
     */
    const portaDoArgumento = enumValue(call.arguments[0], "Port") ?? enumValue(call.keywords?.find((k) => k.name === "port")?.value, "Port");
    const porta = portaDoArgumento ?? portFromVariable(ctx.targetName) ?? "A";
    // A direção pode vir posicional — Motor(Port.A, Direction.COUNTERCLOCKWISE) —
    // ou nomeada — Motor(Port.A, positive_direction=Direction.COUNTERCLOCKWISE).
    //
    // Não se pode misturar ?? com && sem parênteses: é SyntaxError em JS e
    // derrubava o módulo inteiro (e, em cascata, o bootstrap).
    const keywordDirection = call.keywords?.find((k) => k.name === "positive_direction")?.value ?? null;
    const direction = enumValue(call.arguments[1], "Direction") ?? enumValue(keywordDirection, "Direction");
    return {
      blockId: "motor_setup",
      params: {
        port: porta,
        positive_direction: direction === "COUNTERCLOCKWISE" ? "ccw" : "cw",
        // O nome que a equipe escolheu, para o round-trip devolver igual.
        var: ctx.targetName,
        original: ctx.targetName,
      },
    };
  },

  // robot = DriveBase(motor_a, motor_b, 62.4, 48)
  (ctx) => {
    const call = ctx.valueNode;
    if (call?.type !== "callExpression" || describeCallee(call.callee) !== "DriveBase") return null;
    const leftPort = call.arguments[0]?.type === "variableReference" ? portFromVariable(call.arguments[0].name) : null;
    const rightPort = call.arguments[1]?.type === "variableReference" ? portFromVariable(call.arguments[1].name) : null;
    const wheel = num(call.arguments[2]) ?? num(call.keywords?.find((k) => k.name === "wheel_diameter")?.value);
    const axle = num(call.arguments[3]) ?? num(call.keywords?.find((k) => k.name === "axle_track")?.value);
    return {
      blockId: "movement_setup",
      params: {
        left: leftPort ?? DEFAULT_DRIVE_PORTS.left, right: rightPort ?? DEFAULT_DRIVE_PORTS.right,
        // A geometria padrão NÃO é fixa aqui: vem do arquivo de configuração.
        wheel_diameter: isNum(wheel) ? wheel : WHEEL_DIAMETER_MM,
        axle_track: isNum(axle) ? axle : AXLE_TRACK_MM,
      },
    };
  },

  // hub = PrimeHub()
  (ctx) => {
    const call = ctx.valueNode;
    if (call?.type !== "callExpression") return null;
    const callee = describeCallee(call.callee);
    /*
     * Os nomes vêm do REGISTRO Pybricks, não de uma lista escrita à mão aqui.
     *
     * A lista fixa ficava desatualizada em relação ao catálogo, e o efeito
     * era silencioso: um hub novo colado no arquivo caía em `var_set` — o
     * bloco genérico — e a criança perdia o bloco "inicializar o HUB" sem
     * diagnóstico. `InnovationHub`, por exemplo, é o nome do aplicativo e
     * não existe no Pybricks; agora ele gera diagnóstico em vez de virar
     * uma atribuição qualquer.
     */
    if (!HUB_CLASSES.has(callee)) return null;
    return { blockId: "hub_setup", params: { model: callee, var: ctx.targetName, original: ctx.targetName } };
  },

  // timer = StopWatch()
  (ctx) => {
    const call = ctx.valueNode;
    if (call?.type !== "callExpression" || describeCallee(call.callee) !== "StopWatch") return null;
    return { blockId: "hub_timer_setup", params: {} };
  },

  // color/distance/force = Sensor(Port.X)
  (ctx) => {
    const call = ctx.valueNode;
    if (call?.type !== "callExpression") return null;
    const callee = describeCallee(call.callee);
    const map = {
      ColorSensor: { blockId: "sensor_setup_color", target: "color" },
      UltrasonicSensor: { blockId: "sensor_setup_distance", target: "distance" },
      ForceSensor: { blockId: "sensor_setup_force", target: "force" },
    };
    const spec = map[callee];
    if (!spec || ctx.targetName !== spec.target) return null;
    const port = enumValue(call.arguments[0], "Port") ?? "C";
    return { blockId: spec.blockId, params: { port } };
  },

  // motor_a_speed = 750
  (ctx) => {
    const match = /^motor_([a-f])_speed$/.exec(ctx.targetName || "");
    if (!match) return null;
    const value = num(ctx.valueNode);
    if (!isNum(value)) return null;
    return { blockId: "motor_speed_set", params: { port: match[1].toUpperCase(), percent: percentFromSpeed(value) } };
  },

  // lista = [1, 2, 3]
  (ctx) => {
    if (ctx.valueNode?.type !== "list") return null;
    return {
      blockId: "list_create",
      params: { name: ctx.targetName, items: ctx.valueNode.items.map(unparse).join(", ") },
    };
  },

  /*
    x = <qualquer coisa>

    Este era o ÚLTIMO lugar onde a árvore era achatada: a regra aceitava
    apenas cinco tipos de nó e, mesmo nesses, guardava `unparse(valueNode)`
    — texto. `correcao = erro * KP_STRAIGHT` virava literalmente
    `value: "(erro * KP_STRAIGHT)"`.

    Agora NÃO há mais lista de tipos aceitos: qualquer nó que a IR produz e
    que `expressionToBlock` saiba desenhar entra no socket. Uma atribuição
    que não saiba virar bloco continua sem representação — mas agora
    existem três fallbacks (operador, chamada, subscrito) antes de chegar
    nisso, então o `pythonOnly` ficou para o truly excepcional.
  */
  (ctx) => {
    if (!ctx.targetName) return null;
    const value = expressionToBlock(ctx.valueNode);
    if (!value) return null;
    return { blockId: "var_set", params: { name: ctx.targetName, value } };
  },
];

/* ---------- Augmented assignment ---------- */

/*
 * ATRIBUIÇÃO COMPOSTA — `erro -= 360`
 *
 * Antes só `+=` com LITERAL numérico virava bloco. `erro -= 360`, que
 * aparece duas vezes no `_angle_error` do programa de stress, caía inteiro
 * em `pythonOnly`. Um `while` cuja condição depende dessa linha ficava
 * sem nenhuma representação visual.
 *
 * Agora qualquer operador composto (`+= -= *= /= //= %= **=`) vira o mesmo
 * bloco `var_change`, com o valor como socket — `erro += passo` funciona
 * tanto quanto `erro += 360`.
 */
const AUGMENTED_OPERATORS = {
  "+=": "+", "-=": "-", "*=": "*", "/=": "/",
  "//=": "//", "%=": "%", "**=": "**",
};

const AUGMENTED_RULES = [
  (ctx) => {
    if (!ctx.targetName) return null;
    const operator = AUGMENTED_OPERATORS[ctx.operator];
    if (!operator) return null;

    const delta = ctx.valueNode?.type === "literal" && ctx.valueNode.literalKind === "number"
      ? Number(ctx.valueNode.value)
      : (expressionToBlock(ctx.valueNode) ?? 1);

    if (operator === "+") return { blockId: "var_change", params: { name: ctx.targetName, delta } };

    /*
      Os demais operadores não têm bloco de catálogo próprio, e criar sete
      blocos "subtrair da variável" só poluiria a paleta. O bloco genérico
      de operador com `augmented` resolve o caso sem inventar forma nova:
      o Python gerado é idêntico ao original.
    */
    return {
      blockId: "var_change_op",
      params: { name: ctx.targetName, operator, delta },
    };
  },
  // lista.append(x)  -> tratado como call
];

/* ---------- Chamadas que são assignment-like (lista.append) ---------- */

const METHOD_STATEMENT_RULES = [
  (ctx) => {
    if (ctx.calleeMethod !== "append") return null;
    return { blockId: "list_append", params: { name: ctx.calleeObject, value: unparse(ctx.node.arguments[0]) } };
  },
];

/* ---------- Comparações / expressões booleanas (repórteres) ---------- */

const COMPARISON_RULES = [
  // color.color() == Color.RED
  (ctx) => {
    const { left, right, operator } = ctx;
    if (operator !== "==") return null;
    const call = left?.type === "callExpression" ? left : right?.type === "callExpression" ? right : null;
    const other = call === left ? right : left;
    if (!call) return null;
    const callee = describeCallee(call.callee);
    if (callee === "color.color") {
      const color = enumValue(other, "Color");
      return color ? { blockId: "sensor_color_is", params: { color } } : null;
    }
    if (callee === "hub.imu.up") {
      const side = enumValue(other, "Side");
      return side ? { blockId: "sensor_tilt_is", params: { side } } : null;
    }
    return null;
  },

  // distance.distance() < 200
  (ctx) => {
    const { left, right, operator } = ctx;
    if (!["<", ">"].includes(operator)) return null;
    const call = left?.type === "callExpression" ? left : null;
    if (!call) return null;
    const callee = describeCallee(call.callee);
    const value = num(right);
    if (callee === "distance.distance" && isNum(value)) {
      return { blockId: "sensor_distance_compare", params: { op: operator, distance: value / 10 } };
    }
    return null;
  },
];

/* ---------- Divisões que são repórteres de unidade ---------- */

const BINARY_RULES = [
  // distance.distance() / 10 -> distância em cm
  (ctx) => {
    if (ctx.operator !== "/") return null;
    const left = describeCallee(ctx.left?.callee) ?? "";
    if (ctx.left?.type === "callExpression" && left === "distance.distance" && num(ctx.right) === 10) {
      return { blockId: "sensor_distance_cm", params: {} };
    }
    if (ctx.left?.type === "callExpression" && left === "timer.time" && num(ctx.right) === 1000) {
      return { blockId: "sensor_timer", params: {} };
    }
    return null;
  },
  // a % b -> o resto de
  (ctx) => {
    if (ctx.operator !== "%") return null;
    const a = num(ctx.left); const b = num(ctx.right);
    if (isNum(a) && isNum(b)) return { blockId: "op_mod", params: { left: a, right: b } };
    return null;
  },
  // a op b -> operador genérico
  (ctx) => {
    if (!["+", "-", "*", "/", "//", "**"].includes(ctx.operator)) return null;
    const a = num(ctx.left); const b = num(ctx.right);
    if (isNum(a) && isNum(b)) {
      return { blockId: "op_math", params: { left: a, right: b, operator: ctx.operator === "**" ? "**" : ctx.operator } };
    }
    return null;
  },
];

/* ---------- Subscript de IMU ---------- */

const SUBSCRIPT_RULES = [
  (ctx) => {
    const callee = describeCallee(ctx.object?.callee);
    const index = num(ctx.index);
    if (!isNum(index)) return null;
    if (ctx.object?.type !== "callExpression") return null;
    if (callee === "hub.imu.acceleration") return { blockId: "sensor_acceleration", params: { axis: String(index) } };
    if (callee === "hub.imu.angular_velocity") return { blockId: "sensor_angular_velocity", params: { axis: String(index) } };
    return null;
  },
];

/**
 * Um `elif` chega na IR como `condition` com `kind: "elif"` — o parser já
 * guardava isso, mas o conversor ignorava e tratava todo `condition` como
 * um `if` independente. Reconhecer pelo `kind` estrutural (e não por texto
 * da linha, que quebraria com indentação colada de fora) é o que fecha a
 * cadeia `if / elif / else` corretamente.
 */
function isElifNode(node) {
  return node?.type === "condition" && node.kind === "elif";
}

/* Operador Python -> bloco de catálogo. Um bloco por operador, como no
   LEGO Education: "multiplicar" é um bloco, não uma opção de um seletor. */
const BINARY_BLOCK_IDS = {
  "+": "op_add",
  "-": "op_subtract",
  "*": "op_multiply",
  "/": "op_divide",
  "//": "op_floordiv",
  "**": "op_pow",
};

/* ---------- Laços e condições ---------- */

const LOOP_RULES = [
  // for i in range(N):
  (ctx) => {
    if (ctx.node.kind !== "for") return null;
    const iterable = ctx.node.iterable;
    if (iterable?.type !== "callExpression" || describeCallee(iterable.callee) !== "range") return null;
    /*
      `range` com 1, 2 ou 3 argumentos.

      Antes: `iterable.arguments.map(num)` e `args.every(isNum)`. Exigia
      que TODOS os argumentos fossem números LITERAL. O programa de stress
      tem `for velocidade_atual in range(int(velocidade), 0, -passo)`:
      o primeiro é uma chamada, o terceiro é uma variável com sinal. Não
      passava no `every(isNum)` e o laço inteiro ficava sem representação.

      Agora cada argumento vira socket, e um `range` de argumento único
      continua virando o bloco "repita N vezes" — que é o que a criança
      espera e o que o Python mais simples pede.
    */
    const rawArgs = iterable.arguments ?? [];
    const args = rawArgs.map((node) =>
      node?.type === "literal" && node.literalKind === "number" ? Number(node.value) : expressionToBlock(node));

    if (args.some((arg) => arg === null || arg === undefined)) return null;

    if (args.length === 1) {
      return { blockId: "control_repeat", params: { times: args[0] } };
    }
    return {
      blockId: "control_for_range",
      params: {
        variable: ctx.node.targets?.[0] ?? "i",
        start: args[0],
        stop: args[1],
        // step só entra quando existe: `range(a, b)` deve continuar
        // gerando dois argumentos, não três com vazio no meio.
        step: args.length >= 3 ? args[2] : "",
      },
    };
  },

  // while True:
  (ctx) => {
    if (ctx.node.kind !== "while") return null;
    const test = ctx.node.test;
    if (boolValue(test) === true) return { blockId: "control_forever", params: {} };

    // while not (cond):  -> repita até que
    if (test?.type === "unaryOperation" && test.operator === "not") {
      return { blockId: "control_repeat_until", params: { condition: expressionToCondition(test.operand, ctx) } };
    }

    // Padrão de evento: while <teste de sensor>: wait(10)
    const eventBlock = matchEventLoop(ctx);
    if (eventBlock) return eventBlock;

    return { blockId: "control_while", params: { condition: expressionToCondition(test, ctx) } };
  },
];

const CONDITION_RULES = [
  (ctx) => {
    const hasElse = ctx.siblingsAfter?.some((sibling) => sibling.type === "elseBranch");
    return {
      blockId: hasElse ? "control_if_else" : "control_if",
      params: { condition: expressionToCondition(ctx.node.test, ctx) },
    };
  },
];

/**
 * while <sensor test>: wait(10)  ->  bloco-chapéu de evento
 * Reconhecimento estrutural: o corpo é exatamente `wait(10)` e o teste
 * é uma comparação com um sensor conhecido.
 */
function matchEventLoop(ctx) {
  const body = ctx.node.body || [];
  const isWaitGuard = body.length === 1 &&
    body[0].type === "expressionStatement" &&
    body[0].expression?.type === "callExpression" &&
    describeCallee(body[0].expression.callee) === "wait";
  if (!isWaitGuard) return null;

  let test = ctx.node.test;
  let negated = false;
  if (test?.type === "unaryOperation" && test.operator === "not") {
    test = test.operand;
    negated = true;
  }
  if (test?.type === "booleanOperation") return null;

  if (test?.type !== "comparison") return null;
  const { left, right, operator } = test;
  const call = left?.type === "callExpression" ? left : right?.type === "callExpression" ? right : null;
  if (!call) return null;
  const callee = describeCallee(call.callee);

  if (callee === "color.color" && operator === "!=") {
    const color = enumValue(left === call ? right : left, "Color");
    return color ? { blockId: "event_when_color", params: { port: "C", color } } : null;
  }
  if (callee === "distance.distance" && ["<", ">"].includes(operator)) {
    const value = num(left === call ? right : left);
    return isNum(value)
      ? { blockId: "event_when_distance", params: { port: "D", op: negated ? (operator === "<" ? ">" : "<") : operator, distance: value / 10 } }
      : null;
  }
  if (callee === "force.pressed" && operator === "==" ) {
    return { blockId: "event_when_force", params: { port: "E" } };
  }
  if (callee === "hub.imu.up" && operator === "!=") {
    const side = enumValue(left === call ? right : left, "Side");
    return side ? { blockId: "event_when_tilted", params: { side } } : null;
  }
  if (callee === "hub.imu.heading" && [">", "<", "=="].includes(operator)) {
    const angle = num(left === call ? right : left);
    return isNum(angle) ? { blockId: "event_when_heading", params: { op: operator, angle } } : null;
  }
  if (callee === "hub.buttons.pressed") {
    const button = enumValue(call.arguments[0], "Button");
    return button ? { blockId: "event_when_button", params: { button } } : null;
  }
  if (callee === "timer.time" && operator === "<") {
    const ms = num(left === call ? right : left);
    return isNum(ms) ? { blockId: "event_when_timer", params: { seconds: ms / 1000 } } : null;
  }
  if (callee === "mailbox.read" && operator === "!=") {
    const message = plainStr(left === call ? right : left);
    return message ? { blockId: "event_message_received", params: { message } } : null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Expressão -> texto de condição para o campo de encaixe booleano     */
/* ------------------------------------------------------------------ */

/**
 * Condição de `if` / `while` / `espere até`.
 *
 * Este era o ponto mais fundo do problema: TODO `if` e TODO `while` do
 * projeto passavam por aqui e recebiam `unparse(node)` — o texto Python
 * cru. Era por isso que nenhuma condição do programa de stress — que tem
 * `abs(gb.distance()) < distancia_alvo` — nunca teve representação visual.
 *
 * Agora devolve o BLOCO. O `unparse` continua como último recurso, e só
 * quando não existerepresentação alguma: perder a condição inteira
 * seria pior do que exibi-la crua.
 */
function expressionToCondition(node, ctx) {
  if (!node) return "True";
  return expressionToBlock(node) ?? unparse(node) ?? "True";
}

/* ------------------------------------------------------------------ */
/* Variáveis que são um DriveBase                                      */
/* ------------------------------------------------------------------ */
/*
 * As regras de chamada são escritas contra o nome canônico `robot`
 * (`robot.drive`, `robot.stop`, `robot.distance`...). O programa de stress
 * — e metade dos programas de FLL — chama a base de `gb`:
 *
 *     gb = DriveBase(motor_a, motor_b, 62.4, 48)
 *     gb.drive(velocidade, correcao)
 *     gb.stop()
 *
 * Sem reconhecer que `gb` É a base, todas essas linhas caíam em
 * `pythonOnly` e as funções `gb_move`/`gb_turn` apareciam sem corpo útil.
 *
 * A reconhecimento é SEMÂNTICO: varremos a IR atrás de
 * `nome = DriveBase(...)`. Não é `if (nome.includes("gb"))` — é o que o
 * usuário pediu ao proibir casamento por string. Um `gb` que NÃO for
 * DriveBase continua sendo uma variável comum.
 */
/*
 * Nomes convencionais de base de movimento.
 *
 * Mesmo padrão que o projeto já usa para portas (`motor_a` -> porta A em
 * `portFromVariable`): o nome da variável carrega o papel, e a IDE honra a
 * convenção. `gb` é tão padronizado em FLL quanto `robot` — `gb = DriveBase(...)`
 * está em metade dos programas de equipe.
 *
 * A convenção é um COMPLEMENTO, não o mecanismo: `collectDriveBaseNames`
 * abaixo descobre a base pelo TIPO (`x = DriveBase(...)`) mesmo quando a
 * criança chamou de `meu_robo`. As duas fontes juntas cobrem o caso comum
 * sem depender de casamento por texto do código.
 */
const DRIVE_BASE_CONVENTIONS = ["robot", "gb", "robo", "drive", "base"];
const driveBaseNames = new Set(DRIVE_BASE_CONVENTIONS);

function collectDriveBaseNames(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const item of node) collectDriveBaseNames(item); return; }
  if (node.type === "assignment") {
    const value = node.value;
    if (value?.type === "callExpression" && describeCallee(value.callee) === "DriveBase") {
      for (const target of node.targets ?? []) {
        if (target?.type === "variableReference") driveBaseNames.add(target.name);
      }
    }
  }
  for (const value of Object.values(node)) collectDriveBaseNames(value);
}

/* ------------------------------------------------------------------ */
/* Contexto de reconhecimento                                          */
/* ------------------------------------------------------------------ */

function buildCallContext(node, parentInfo) {
  const calleeText = describeCallee(node.callee);
  const args = node.arguments || [];
  const keywords = node.keywords || [];
  const kw = (name) => keywords.find((entry) => entry.name === name)?.value ?? null;

  // motor_a.run_angle -> objectVar = { name:'motor_a', port:'A' }, method='run_angle'
  let objectName = null;
  let method = calleeText;
  if (node.callee?.type === "attribute") {
    objectName = describeCallee(node.callee.object);
    method = node.callee.attribute;
  }

  /*
    Normaliza a base de movimento para o nome canônico `robot`.

    `gb.drive(...)` e `robot.drive(...)` são a MESMA chamada para as
    regras; só muda o nome que a criança escolheu para a variável. Sem esta
    normalização, trocar o nome da base no código apagava a representação
    visual de todas as linhas de movimento.
  */
  const canonicalObject = driveBaseNames.has(objectName) ? "robot" : objectName;
  const port = portFromVariable(objectName);
  const matchKey = port
    ? `${port.toLowerCase()}.${method}`
    : (canonicalObject ? `${canonicalObject}.${method}` : calleeText);

  return {
    node,
    callee: calleeText,
    matchKey,
    method,
    calleeObject: objectName,
    calleeMethod: method,
    objectVar: { name: objectName, port },
    args,
    keywords,
    argNum: (index) => num(args[index]),
    /*
      argExpr devolve o BLOCO do argumento, ou o número cru quando o
      argumento é literal. É o que permite `abs(gb.distance())` e
      `max(1, int(velocidade / 5))` virarem encaixes de verdade: o
      argumento aninhado vira bloco dentro do socket, e não texto.
    */
    argExpr: (index) => {
      const node = args[index];
      if (!node) return null;
      if (node.type === "literal" && node.literalKind === "number") return Number(node.value);
      return expressionToBlock(node);
    },
    argText: (index) => plainStr(args[index]) ?? (args[index] ? unparse(args[index]) : ""),
    argStr: (index) => str(args[index]),
    argEnum: (index, kind) => enumValue(args[index], kind),
    kwNum: (name) => num(kw(name)),
    kwBool: (name) => boolValue(kw(name)),
    kwEnum: (name, kind) => enumValue(kw(name), kind),
    ...parentInfo,
  };
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

let blockCounter = 0;
const newId = () => `block_${String(++blockCounter).padStart(4, "0")}`;

/** Cria um bloco a partir do schema do catálogo + params parciais. */
export function makeBlock(blockId, params, source, extra = {}) {
  const spec = BLOCK_BY_ID.get(blockId);
  if (!spec) return null;
  const defaults = blockDefaults(spec);
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined) continue; // B01/N02: nunca null
    merged[key] = value;
  }
  return {
    id: extra.id ?? newId(),
    blockId,
    schema: blockId,
    category: spec.category,
    shape: spec.shape,
    params: merged,
    children: extra.children ?? [],
    elseChildren: extra.elseChildren ?? [],
    /*
      `branches` guarda a cadeia completa do `if`/`elif`/`else`: cada ramo
      com sua condição e seu corpo. É o que permite ao `codeGenerator`
      reemitir `elif` no lugar certo, em vez de achatar tudo em `if`s
      separados (que é um programa diferente).
    */
    ...(Array.isArray(extra.branches) && extra.branches.length > 1 ? { branches: extra.branches } : {}),
    source,
    line: source?.startLine ?? 0,
    represented: true,
    disabled: false,
    expanded: extra.expanded ?? false,
  };
}

/**
 * Converte um nó de expressão em bloco repórter/booleano, ou null.
 */
/*
 * EXPRESSÃO -> BLOCO (recursivo)
 * ==============================
 *
 * ESTA É A FUNÇÃO QUE IMPORTA. Ela traduz um nó da IR no bloco
 * CORRESPONDENTE e, quando o operando é outra expressão, devolve um
 * BLOCO aninhado — nunca um texto.
 *
 * Antes, `conditionText()` chamava esta função e jogava o resultado fora
 * com `spec.py(params)`, voltando a uma string. Era ali que a IDE perdia
 * a estrutura do Python. Agora a árvore sobrevive até o DOM.
 *
 * A ordem das regras é: literal -> variável -> operador -> comparação ->
 * chamada específica -> chamada genérica. A genérica é o fallback que
 * evita `pythonOnly` (itens 47 e 48).
 */
export function expressionToBlock(node) {
  if (!node) return null;

  /* ---------- literais ---------- */
  if (node.type === "literal") {
    const kind = node.literalKind;
    if (kind === "number") return makeBlock("literal_number", { value: Number(node.value) }, node.source);
    if (kind === "string") return makeBlock("literal_text", { value: plainStr(node) ?? "" }, node.source);
    if (kind === "boolean") return makeBlock("literal_bool", { value: node.value ? "True" : "False" }, node.source);
    if (kind === "none") return makeBlock("literal_none", {}, node.source);
    return null;
  }

  /* ---------- variável ---------- */
  if (node.type === "variableReference") {
    return makeBlock("var_report", { name: node.name }, node.source);
  }

  /* ---------- variável Python None / True / False em posição de expr ---------- */
  if (node.type === "pythonExpression") {
    const text = String(node.text ?? "").trim();
    if (text === "None") return makeBlock("literal_none", {}, node.source);
    if (text === "True") return makeBlock("literal_bool", { value: "True" }, node.source);
    if (text === "False") return makeBlock("literal_bool", { value: "False" }, node.source);
    const inner = parseTextExpression(text);
    if (inner) return inner;
    return null;
  }

  /* ---------- operadores aritméticos e bitwise ---------- */
  if (node.type === "binaryOperation") {
    for (const rule of BINARY_RULES) {
      const result = rule({ left: node.left, right: node.right, operator: node.operator, node });
      if (result) {
        // regra especializada: devolve bloco pronto
        return makeBlock(result.blockId, result.params, node.source);
      }
    }
    /*
      Operador com sockets aninhados.

      Os operadores COMUNS ganham bloco próprio (`op_multiply`, `op_divide`…)
      porque é assim que a criança pensa: existe um bloco "multiplicar", não
      um bloco "escolher a operação". O `generic_operator` fica reservado
      para bitwise e para o resto — que é raro e não merece um bloco na
      paleta, mas também não pode sumir.
    */
    const left = expressionToBlock(node.left);
    const right = expressionToBlock(node.right);
    if (!left || !right) return null;

    const blockId = BINARY_BLOCK_IDS[node.operator];
    if (blockId) return makeBlock(blockId, { left, right }, node.source);
    return makeBlock("generic_operator", { left, right, operator: node.operator }, node.source);
  }

  /* ---------- comparações ---------- */
  if (node.type === "comparison") {
    for (const rule of COMPARISON_RULES) {
      const result = rule({ left: node.left, right: node.right, operator: node.operator, node });
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }
    const left = expressionToBlock(node.left);
    const right = expressionToBlock(node.right);
    if (!left || !right) return null;
    const blockId = {
      "<": "op_lt", ">": "op_gt", "<=": "op_le", ">=": "op_ge",
      "==": "op_eq", "!=": "op_ne", "in": "op_in", "not in": "op_not_in",
      "is": "op_is", "is not": "op_is_not",
    }[node.operator];
    if (!blockId) return null;
    return makeBlock(blockId, { left, right }, node.source);
  }

  /* ---------- e / ou ---------- */
  if (node.type === "booleanOperation") {
    const left = expressionToBlock(node.left);
    const right = expressionToBlock(node.right);
    if (!left || !right) return null;
    return makeBlock(node.operator === "or" ? "op_or" : "op_and", { left, right }, node.source);
  }

  /* ---------- não ---------- */
  if (node.type === "unaryOperation") {
    if (node.operator === "not") {
      const value = expressionToBlock(node.operand);
      if (!value) return null;
      return makeBlock("op_not", { value }, node.source);
    }
    if (node.operator === "-" || node.operator === "+") {
      const value = expressionToBlock(node.operand);
      if (!value) return null;
      return makeBlock("generic_unary", { operator: node.operator, value }, node.source);
    }
    return null;
  }

  /* ---------- condicional (ternário) ---------- */
  if (node.type === "conditionalExpression") {
    const condition = expressionToBlock(node.test);
    const then = expressionToBlock(node.consequent);
    const otherwise = expressionToBlock(node.alternate);
    if (!condition || !then || !otherwise) return null;
    return makeBlock("op_ternary", { condition, then, otherwise }, node.source);
  }

  /* ---------- chamadas ---------- */
  if (node.type === "callExpression") {
    const ctx = buildCallContext(node);
    for (const rule of CALL_RULES) {
      if (!rule.methodPattern.test(ctx.matchKey)) continue;
      const result = rule.build(ctx);
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }
    /*
      FALLBACK GENÉRICO (itens 47 e 48).

      `foo(a, b)` vira um bloco de chamada com `a` e `b` encaixados, em vez
      de cair em `pythonOnly`. É o que garante que virtually nenhuma linha
      do programa de stress fique sem representação.

      O nome vem de `ctx.callee`, que é o campo que `buildCallContext`
      realmente publica — usar `calleeText` aqui dava `undefined` e produzia
      `função()`, um nome falso no Python.
    */
    const args = (node.arguments ?? []).map((arg) => expressionToBlock(arg)).filter(Boolean);
    const keywords = (node.keywords ?? [])
      .map((kw) => {
        const value = expressionToBlock(kw.value);
        return value ? { name: kw.name, value } : null;
      })
      .filter(Boolean);
    const callee = String(ctx.callee || "").trim();
    if (!callee) return null;
    return makeBlock("generic_call", {
      name: callee,
      args: args.length ? args : "",
      keywords: keywords.length ? keywords : "",
    }, node.source);
  }

  /* ---------- subscrito: lista[i] ---------- */
  if (node.type === "subscript") {
    for (const rule of SUBSCRIPT_RULES) {
      const result = rule({ object: node.object, index: node.index, node });
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }
    const object = expressionToBlock(node.object);
    const index = expressionToBlock(node.index);
    if (!object || !index) return null;
    return makeBlock("generic_subscript", { object, index }, node.source);
  }

  /* ---------- listas ---------- */
  if (node.type === "list" || node.type === "tuple") {
    const items = (node.items ?? []).map((item) => expressionToBlock(item)).filter(Boolean);
    return makeBlock("list_literal", { items }, node.source);
  }

  /* ---------- atributo: hub.imu ---------- */
  if (node.type === "attribute") {
    const object = expressionToBlock(node.object);
    if (!object) return null;
    return makeBlock("generic_attribute", { object, attribute: node.attribute }, node.source);
  }

  return null;
}

/**
 * Converte TEXTO em árvore de blocos. Usado (a) quando a criança digita uma
 * expressão no socket e sai do campo — a decisão "texto vira bloco".
 *
 * Não é um atalho por `String.includes`: o texto passa pelo mesmo parser
 * da IR, e quem decide o que fazer é `expressionToBlock`, a mesma função
 * usada na conversão do arquivo inteiro. Um único caminho, um único lugar
 * para Bugs aparecerem.
 */
export function parseTextExpression(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = parseProgram(`_valor = ${raw}\n`);

    /*
      O parser é tolerante por desenho (para não derrubar um arquivo inteiro
      por causa de uma linha), e é isso que torna perigoso aceitar qualquer
      texto: `nao sei o que` voltava como se fosse a variável `nao`, e o
      resto da frase era descartado em silêncio.

      Então a promoção só acontece quando o texto foi CONSUMIDO INTEIRO:
      sem diagnósticos, exatamente um statement, e ele é a atribuição que
      construímos. Fora disso, devolve null e o texto continua texto — que é
      o comportamento honesto quando não há expressão ali.
    */
    if (parsed.diagnostics?.length) return null;
    const body = parsed.ir?.body ?? [];
    if (body.length !== 1) return null;
    const statement = body[0];
    if (statement?.type !== "assignment") return null;
    if (statement.value?.type === "pythonExpression") return null;

    /*
      O SPAN prova que o texto foi consumido INTEIRO.

      Sem esta checagem, `nao sei o que` era aceito como a variável `nao` e
      o resto da frase sumia em silêncio — a criança acharia que escrever
      besteira virou código. Comparar o fim do valor com o fim do statement
      é o que separa "isto é uma expressão" de "isto é lixo que o parser
      engoliu":

        _valor = nao sei o que   stmt 0-22   valor 9-12   <- valor para antes
        _valor = erro * 2        stmt 0-17   valor 9-17   <- valor chega ao fim
    */
    const statementEnd = statement.source?.endColumn ?? 0;
    const valueEnd = statement.value?.source?.endColumn ?? 0;
    if (valueEnd < statementEnd) return null;

    return expressionToBlock(statement.value);
  } catch {
    return null;
  }
}

/**
 * Condição para os sockets booleanos.
 *
 * Antes esta função era o ponto onde a IDE perdia a estrutura: montava o
 * bloco e devolvia `spec.py(params)`, ou seja, TEXTO. Uma condição como
 * `abs(gb.distance()) < distancia_alvo` chegava ao bloco como uma string
 * e a criança via `abs(gb.distance()) < distancia_alvo` digitado — Python
 * escondido dentro de uma caixa, exatamente o que não pode acontecer.
 *
 * Agora devolve o BLOCO. Quem quiser o texto chama `blockToPython`.
 * O fallback textual continua existindo para expressões que não tenham
 * representação, porque perder a condição é pior que exibi-la crua.
 */
export function conditionText(node) {
  if (!node) return "True";
  return expressionToBlock(node) ?? unparse(node) ?? "True";
}

/**
 * Converte a IR de um programa em lista de blocos (com filhos para C-blocks).
 * @returns {{ blocks: Array, pythonOnly: Array, lines: Set<number> }}
 */
export function irToBlocks(ir, options = {}) {
  const blocks = [];
  const pythonOnly = [];
  const representedLines = new Set();
  const userFunctions = new Set((options.userFunctions || []).map((fn) => fn.name));
  const libraryFunctions = new Set((options.libraryFunctions || []).map((fn) => fn.name));

  /*
   * SCHEMAS por nome de função.
   *
   * É o mapa que habilita o bloco semântico. Ele é montado aqui, a partir
   * da mesma lista que já alimentava `libraryFunctions`, e indexado por
   * NOME — que é como a chamada chega, já resolvidos os aliases.
   *
   * Só entram funções com schema válido: um schema ausente é informação
   * ("não sei"), e o conversor precisa distinguish isso de "não existe".
   */
  const schemas = new Map();
  for (const fn of options.libraryFunctions || []) {
    if (fn?.schema) schemas.set(fn.name, fn.schema);
  }
  /*
   * O TEXTO ORIGINAL entra no conversor.
   *
   * Sem ele, um construtor sem bloco próprio (`try`, `with`, `match`…) só
   * tinha a IR para se reconstituir, e a IR não guarda a formatação nem os
   * comentários. Com o texto, o bloco de fallback devolve as linhas
   * exatamente como a criança as escreveu.
   */
  const sourceText = options.sourceText ?? ir?.source ?? null;

  const markLines = (node) => {
    if (!node?.source) return;
    for (let line = node.source.startLine; line <= (node.source.endLine ?? node.source.startLine); line += 1) {
      representedLines.add(line);
    }
  };

  // Reconhece a base de movimento ANTES de converter qualquer linha.
  collectDriveBaseNames(ir);

  const convertBody = (body, siblings = []) => {
    const out = [];
    body.forEach((node, index) => {
      // `elif` e `else` absorvidos pelo `if` da cadeia não viram bloco.
      if (node.absorbedByChain) return;

      const block = convertNode(node, {
        siblingsAfter: siblings.slice(index + 1),
        userFunctions, libraryFunctions, schemas, aliases: options.aliases ?? {},
        markLines, sourceText,
      });
      if (block) {
        out.push(block);
        markLines(node);
        return;
      }
      /*
       * `null` pode significar três coisas diferentes, e tratá-las como uma
       * só era o que produzia os avisos fantasma e as linhas perdidas:
       *
       *   a) o conversor JÁ marcou a linha (import, `main()`, `elif`
       *      absorvido) — está tudo bem, não é aviso nem órfã;
       *   b) a linha não é conteúdo: comentário, `pass`, linha vazia;
       *   c) nenhuma receita casou — aí sim é código órfão e precisa do
       *      bloco "Código Python" E do aviso.
       *
       * A ordem importa: só falta o aviso quando a linha NÃO foi marcada
       * e NÃO está na lista do que não vira bloco.
       */
      if (representedLines.has(node.source?.startLine ?? -1)) return;
      if (["comment", "pass", "import", "importFrom"].includes(node.type)) return;

      /*
       * REGRA CRÍTICA (nunca perder código do usuário): em vez de descartar,
       * o trecho vira um bloco "Código Python" que devolve as linhas originais
       * na posição original. A régua lateral continua sinalizando.
       */
      const raw = node.rawText ?? unparse(node) ?? "";
      if (raw.trim()) {
        out.push(makeBlock("python_code", { code: raw }, node.source));
        markLines(node);
      }
      pythonOnly.push({
        line: node.source?.startLine ?? 0,
        text: raw,
        reason: "sem representação visual — preservado no bloco Código Python",
      });
    });
    return out;
  };

  blocks.push(...convertBody(ir.body || [], ir.body || []));
  return { blocks, pythonOnly, representedLines };
}

/** Converte um único nó de statement. */
/**
 * Converte o CORPO de um bloco (laço, função, `if`), repassando a lista de
 * irmãos do próprio corpo.
 *
 * Este é um bug de CORREÇÃO que existia antes dos sockets, e é do tipo que
 * só aparece em programa de verdade:
 *
 *     while c < n:
 *         if suavizacao:
 *             a = 1
 *         else:
 *             a = 2        <- este `else` sumia
 *
 * Os corpos eram convertidos com `convertNode(child, ctx)`, e o `ctx` era o
 * do BLOCO PAI. O `if` interno recebia como "irmãos a seguir" os irmãos do
 * `while` — não os do próprio corpo dele. O `else`, que é irmão do `if`
 * DENTRO do while, nunca era encontrado, e o bloco saía como `control_if`
 * sem ramo `else`. O Python regerado perdia um caminho inteiro da lógica
 * do robô, sem nenhum aviso na tela.
 *
 * A regra é simples e agora vale para todo mundo: o corpo de um bloco é
 * uma lista de irmãos nova, e é ela que se repassa.
 */
function convertStatementBody(body, ctx) {
  const statements = body || [];
  const out = [];
  statements.forEach((child, index) => {
    /*
      `elif` e `else` já foram absorvidos pelo `if` da cadeia. Converter de
      novo os transformaria em blocos independentes e o `elif` apareceria
      DUPLICADO no canvas e no Python — foi exatamente o que aconteceu na
      primeira versão deste conserto.
    */
    if (child?.absorbedByChain) return;
    const block = convertNode(child, { ...ctx, siblingsAfter: statements.slice(index + 1) });
    if (block) out.push(block);
  });
  return out;
}

/*
 * `convertNode` é a FUNÇÃO REAL; `convertNodeMarked` é o ponto de entrada.
 *
 * Antes, `markLines` era chamado em dois lugares: no `convertBody` do topo
 * e em alguns `markLines?.(node)` manuais. Linhas dentro de um `def` — que
 * é onde mora quase todo o código de um programa real — NUNCA eram
 * marcadas, mesmo com o bloco gerado. O后果ado no produto: a régua
 * lateral anunciava "sem representação visual" em cima de linhas que
 * estavam perfeitamente desenhadas, e o round-trip seemed falhar.
 *
 * Marcar dentro do conversor é o único lugar que acerta: qualquer nó que
 * vira bloco, em qualquer profundidade, marca suas próprias linhas.
 */
export function convertNode(node, ctx = {}) {
  const result = convertNodeRaw(node, ctx);
  if (result) ctx.markLines?.(node);
  return result;
}

function convertNodeRaw(node, ctx = {}) {
  if (!node) return null;

  switch (node.type) {
    case "comment":
    case "pass":
      return null;

    case "import":
    case "importFrom":
      // B08: imports são conteúdo editável do arquivo — NÃO viram bloco.
      ctx.markLines?.(node);
      return null;

    case "expressionStatement":
      return convertExpressionStatement(node.expression, node, ctx);

    case "assignment": {
      const target = node.targets?.[0];
      /*
       * DESEMPACOTAMENTO (`a, b = 1, 2`).
       *
       * Há um bloco só para o primeiro alvo, e usá-lo aqui descartava o
       * segundo: `a, b = 1, 2` virava `a = 1` e o `b` sumia do programa
       * sem aviso. Enquanto não existir bloco de desempacotamento, a linha
       * inteira vai para o bloco de código — que preserva os dois nomes e
       * avisa que ali ainda não há representation visual própria.
       */
      if ((node.targets?.length ?? 0) > 1) {
        return pythonTextBlock(node, ctx);
      }
      const targetName = target?.type === "variableReference" ? target.name : null;
      const ruleCtx = { targetName, valueNode: node.value, node, target };
      for (const rule of ASSIGN_RULES) {
        const result = rule(ruleCtx);
        if (result) return makeBlock(result.blockId, result.params, node.source);
      }
      /*
       * NENHUMA RECEITA CASOU — mas a linha EXISTE no arquivo.
       *
       * Antes daqui era `return null`, e `null` significa "isto não é um
       * bloco". O conversor do corpo tratava isso como "nada a fazer" e
       * simplesmente pulava a linha: o Python sumia da tela sem virar bloco
       * e sem ir para o aviso de "só em Python". Era a pior das saídas —
       * a criança achava que o bloco nunca existiu, e o código original
       * também não estava mais em lugar nenhum.
       *
       * A atribuição genérica é o bloco de fallback: guarda o texto do
       * alvo e o valor da direita, e o gerador devolve a linha.
       */
      return makeBlock("python_code", { code: assignmentText(node) }, node.source);
    }

    case "augmentedAssignment": {
      const targetName = node.target?.type === "variableReference" ? node.target.name : null;
      const ruleCtx = { targetName, valueNode: node.value, operator: node.operator, node };
      for (const rule of AUGMENTED_RULES) {
        const result = rule(ruleCtx);
        if (result) return makeBlock(result.blockId, result.params, node.source);
      }
      return makeBlock("python_code", { code: assignmentText(node) }, node.source);
    }

    case "loop": {
      for (const rule of LOOP_RULES) {
        const result = rule({ node, ...ctx });
        if (result) {
          const block = makeBlock(result.blockId, result.params, node.source, {
            children: convertStatementBody(node.body, ctx),
          });
          return block;
        }
      }
      return null;
    }

    case "condition": {
      /*
        `if` / `elif` / `else` — item 16, e um bug de CORREÇÃO.

        O código procurava o `elseBranch` mais próximo entre os irmãos
        seguintes, sem se importar com quantos `elif` houvesse no meio.
        Em `if a / elif b / else x` ele pegava o `else` do MEU if e ainda
        processava o `elif` como um `if` independente, produzindo:

            if a:      if b:
              x = 1      x = 2
            else:      else:
              x = 3      x = 3     <- else duplicado, elif sem guarda

        O Python regerado não era só feio: estava ERRADO. Um `elif` é parte
        da cadeia do `if`, não um `if` ao lado dele.

        A cadeia é percorrida inteira de uma vez. Cada ramo guarda sua
        própria condição e seu próprio corpo, e o bloco ganha `branches`;
        o `codeGenerator` emite `if` / `elif` / `else` na ordem.
      */
      const convertBody = (body) => convertStatementBody(body, ctx);

      const branches = [{
        condition: expressionToCondition(node.test, ctx),
        children: convertBody(node.body),
      }];

      const siblings = ctx.siblingsAfter || [];
      let cursor = 0;
      let elseNode = null;

      while (cursor < siblings.length) {
        const sibling = siblings[cursor];
        if (isElifNode(sibling)) {
          branches.push({ condition: expressionToCondition(sibling.test, ctx), children: convertBody(sibling.body) });
          // Marca como absorvido: sem isso, o `elif` também seria
          // convertido como bloco solto e apareceria DUPLICADO no canvas.
          // `markLines` é chamado porque as linhas do `elif` SÃO
          // representadas — só não por um bloco próprio.
          ctx.markLines?.(sibling);
          sibling.absorbedByChain = true;
          cursor += 1;
          continue;
        }
        if (sibling.type === "elseBranch") {
          elseNode = sibling;
          ctx.markLines?.(sibling);
          elseNode.absorbedByChain = true;
          cursor += 1;
        }
        break;
      }

      const hasElse = Boolean(elseNode);
      const hasElif = branches.length > 1;
      const blockId = hasElif || hasElse ? "control_if_else" : "control_if";

      return makeBlock(blockId, { condition: branches[0].condition }, node.source, {
        children: branches[0].children,
        elseChildren: hasElse ? convertBody(elseNode.body) : [],
        branches,
      });
    }

    case "elseBranch":
    case "exceptBranch":
    case "finallyBranch":
      // já foram absorvidos pelo if/try pai
      return null;

    case "function": {
      /*
        PARÂMETROS ESTRUTURADOS (item 12).

        Antes: `params: (node.params || []).map(p => p.name).join(", ")` — uma
        STRING. `def gb_move(gb, hub, distancia, velocidade=300)` virava
        `"gb, hub, distancia, velocidade"` e o `=300` sumia. O Python
        regerado tinha uma assinatura diferente da original, e a função
        deixava de ter valor padrão.

        Agora cada parâmetro é um objeto com nome, default (como BLOCO, para
        `velocidade=max(1, 5)` ter estrutura) e anotação. A string `args`
        continua existindo, mas apenas como rótulo para a paleta — o Python
        sai sempre dos parâmetros estruturados.
      */
      const parameters = (node.params || []).map((param) => ({
        name: param.name,
        annotation: param.annotation ? unparse(param.annotation) : null,
        default: param.default ? expressionToBlock(param.default) : null,
      }));
      const params = (node.params || []).map((p) => p.name).join(", ");
      // `def main():` é o chapéu "quando o programa iniciar", não um bloco de
      // "Meus blocos". Sem esta distinção o evento sumia da paleta ao
      // carregar um arquivo que usa o padrão do Pybricks.
      const blockId = node.name === "main" ? "event_program_start" : "myblock_define";
      return makeBlock(blockId, { name: node.name, args: params, parameters }, node.source, {
        children: convertStatementBody(node.body, ctx),
      });
    }

    case "break":
      return makeBlock("control_break", {}, node.source);

    case "raise":
      return makeBlock("control_stop_all", {}, node.source);

    case "return": {
      /*
        `return` com representação visual (item 15).

        Era `return null` — TODA função definida pelo usuário aparecia
        inteira como Python. `_smoothstep` do programa de stress tem
        `return progress * progress * (3 - 2 * progress)`, e essa linha
        ficava invisível mesmo com toda a recursão de expressões pronta.

        O cap `control_return` recebe a expressão como socket, então o
        round-trip da composição volta inteiro.
      */
      if (!node.value) return makeBlock("control_return", { value: "" }, node.source);
      const value = expressionToBlock(node.value);
      if (!value) return null;
      return makeBlock("control_return", { value }, node.source);
    }

    /*
     * PYTHON VÁLIDO QUE AINDA NÃO TEM BLOCO PRÓPRIO.
     *
     * Estes construtores (`try`, `with`, `class`, `del`, `global`, `match`…)
     * antes retornavam `null` com o comentário "fica no editor". Isso
     * mentia: o editor é REGERADO a partir dos blocos, então "ficar no
     * editor" significava SUMIR. A criança colava um programa com `try` e o
     * `except` desaparecia — sem aviso, sem resíduo, sem volta.
     *
     * Agora cada um vira um bloco "Código Python" com o texto EXATO das
     * linhas originais, na posição original. A linha fica visível na
     * sequência, o Python continua igual, e a régua lateral avisa que ali
     * ainda não há bloco próprio — que é a verdade.
     */
    case "yield":
    case "tryStatement":
    case "withStatement":
    case "classDefinition":
    case "delete":
    case "global":
    case "nonlocal":
    case "matchStatement":
    case "caseBranch":
    case "exceptBranch":
    case "finallyBranch":
    case "forStatement":
    case "ifStatement":
    case "whileStatement":
    case "expressionStatement":
      return pythonTextBlock(node, ctx);

    default:
      /*
       * QUALQUER OUTRO NÓ. Um tipo desconhecido do parser — uma versão
       * nova da linguagem, um plugin — não pode ser a razão de o código
       * da criança desaparecer. O texto das linhas é sempre melhor que
       * nada, e o aviso diz que aquele trecho não tem bloco próprio ainda.
       */
      return pythonTextBlock(node, ctx);
  }
}

/**
 * Bloco "Código Python" com o texto exato das linhas de origem.
 *
 * Usa o SPAN do nó para recortar o código, o que preserva a formatação
 * original (indentação, comentários, as várias linhas de um `try`). Se o
 * trecho não estiver disponível, cai na reconstrução a partir da IR.
 */
function pythonTextBlock(node, ctx) {
  const original = ctx?.sourceText;
  const code = original && node.source ? sliceConstruct(original, node) : "";
  const final = code || unparse(node) || "";
  if (!final.trim()) return null;
  /*
   * As linhas do recorte contam como representadas.
   *
   * O bloco de código preserva o texto, mas o bloco só marcava o span do
   * cabeçalho. O corpo do `try` e o `except` ficavam de fora da régua e a
   * cobertura acusava linhas sem representação que estavam desenhadas — e,
   * pior, o inverso: um trecho que ainda NÃO virou bloco podia passar por
   * coberto.
   *
   * A contagem vem do próprio texto preservado, com o deslocamento da
   * linha inicial: um bloco que começa na linha 2 e tem 4 linhas cobre de 2
   * a 5.
   */
  if (original && node.source) {
    const quantas = final.split("\n").length;
    for (let i = 0; i < quantas; i += 1) {
      ctx?.markLines?.({ source: {
        startLine: node.source.startLine + i,
        endLine: node.source.startLine + i,
        startColumn: 0, endColumn: 0,
      } });
    }
  }
  return makeBlock("python_code", { code: final }, node.source);
}

/**
 * RECORTE DE UM CONSTRUTO INTEIRO, do cabeçalho à última linha do corpo.
 *
 * Por que não basta o `span` do nó: o span de `try` cobre só a palavra
 * `try:`. O corpo vem DEPOIS, e depois dele vêm as cláusulas irmãs na mesma
 * indentação (`except`, `finally`, `else`, `elif`, `case`). Recortar pelo
 * span devolvia metade do construto, e metade de `try` não compila.
 *
 * A regra é a indentação do próprio arquivo, que é a fonte da verdade:
 *
 *   - começa na linha do cabeçalho;
 *   - consome as linhas MAIS INDENTADAS (o corpo);
 *   - enquanto a linha seguinte voltar ao nível do cabeçalho e COMEÇAR por
 *     uma palavra-chave de cláusula, consome a cláusula e o corpo dela;
 *   - para na primeira linha no mesmo nível que não seja cláusula.
 */
const CLAUSE_KEYWORD = /^(except|finally|else|elif|case)\b/;

function sliceConstruct(text, node) {
  const linhas = String(text).split("\n");
  const inicio = node.source.startLine - 1;
  if (inicio < 0 || inicio >= linhas.length) return "";
  const cabecalho = linhas[inicio];
  const base = /^\s*/.exec(cabecalho)?.[0]?.length ?? 0;
  const partes = [cabecalho];
  let i = inicio + 1;
  let dentroDeClausula = false;

  while (i < linhas.length) {
    const linha = linhas[i];
    if (linha.trim() === "") { i += 1; continue; }
    const recuo = /^\s*/.exec(linha)?.[0]?.length ?? 0;
    const eClausula = recuo === base && CLAUSE_KEYWORD.test(linha.trim());
    if (eClausula) {
      partes.push(linha);
      dentroDeClausula = true;
      i += 1;
      continue;
    }
    if (recuo > base) {
      partes.push(linha);
      dentroDeClausula = false;
      i += 1;
      continue;
    }
    if (!dentroDeClausula && partes.length > 1) break;
    break;
  }
  return partes.join("\n");
}

/**
 * Recorta o texto original do arquivo pelas coordenadas de origem do nó.
 *
 * Dois acréscimos sobre "pegar as linhas do span":
 *
 *   1. O span de um `try` cobre só a palavra `try:`. O resto do construto
 *      é o bloco INDENTADO que vem abaixo, então o recorte segue para baixo
 *      até a linha que sai da indentação. Sem isto, `try:` sobrevivia e o
 *      `except` sumia.
 *   2. Uma linha que termina em `:` (e não em `\`) abre um bloco, mesmo
 *      quando o span do nó é curto.
 *
 * A indentação do próprio arquivo é a referência — nunca uma contagem
 * guardada em lugar nenhum.
 */
function sliceSource(text, source) {
  const linhas = String(text).split("\n");
  if (!source?.startLine || source.startLine < 1 || source.startLine > linhas.length) return "";

  const inicio = linhas[source.startLine - 1];
  const colStart = source.startColumn ?? 0;
  const fimDeclarado = Math.min(source.endLine ?? source.startLine, linhas.length);
  const colEnd = source.endColumn ?? (linhas[fimDeclarado - 1] ?? "").length;

  const abreBloco = /:\s*$/.test(inicio.slice(colStart));
  const base = /^\s*/.exec(inicio)?.[0]?.length ?? 0;

  let end = fimDeclarado;
  if (abreBloco) {
    end = fimDeclarado;
    for (let i = fimDeclarado; i < linhas.length; i += 1) {
      const linha = linhas[i];
      if (linha.trim() === "") { continue; }
      const recuo = /^\s*/.exec(linha)?.[0]?.length ?? 0;
      if (recuo > base) { end = i + 1; continue; }
      break;
    }
  }

  if (end === source.startLine && fimDeclarado === source.startLine) {
    return inicio.slice(colStart, colEnd);
  }
  const meio = linhas.slice(source.startLine, end - 1);
  const ultima = end === fimDeclarado
    ? (linhas[end - 1] ?? "").slice(0, colEnd)
    : (linhas[end - 1] ?? "");
  return [inicio.slice(colStart), ...meio, ultima].join("\n");
}


/**
 * Monta o bloco semântico de uma chamada, se o schema permitir.
 *
 * Devolve `null` — e nunca um bloco pela metade — quando não dá para
 * representar a chamada com segurança. O chamador cai no bloco genérico
 * nesse caso, que é sempre um resultado correto, mesmo que menos bonito.
 */
function blocoSemanticoDeChamada(expression, schema, ctx) {
  let ir;
  try {
    ir = chamadaParaIR(expression, schema, { aliases: ctx.aliases ?? {} });
  } catch {
    return null;
  }
  if (!ir) return null;

  let bloco;
  try {
    bloco = blocoParaChamada(ir, schema);
  } catch {
    return null;
  }

  /*
   * Os valores dos argumentos OCULTOS são guardados no bloco.
   *
   * Eles não aparecem na tela — `gb` e `hub` são a "parafusaria" da chamada
   * — mas precisam sair no Python, na posição original. Guardar o que foi
   * LIDO é o que garante o round-trip; inventar um valor aqui mudaria o
   * programa da criança.
   */
  const ocultos = {};
  for (const campo of schema.ocultos ?? []) {
    const argumento = (ir.argumentos ?? []).find((a) => a.nome === campo.nome);
    if (argumento?.texto) ocultos[campo.nome] = argumento.texto;
  }

  bloco.params.ocultosValores = ocultos;
  bloco.params.function = ir.nomeNoArquivo ?? schema.nome;

  /*
   * `makeBlock` recebe os PARÂMETROS, não o bloco. Passar o objeto inteiro
   * fazia o bloco nascer com os padrões do catálogo — `funcao()` vazio — e
   * a informação semântica se perdia silenciosamente.
   */
  return bloco.params;
}

function convertExpressionStatement(expression, node, ctx) {
  if (!expression) return null;

  if (expression.type === "callExpression") {
    const callCtx = buildCallContext(expression);

    // lista.append(x)
    for (const rule of METHOD_STATEMENT_RULES) {
      const result = rule(callCtx);
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }

    for (const rule of CALL_RULES) {
      if (!rule.methodPattern.test(callCtx.matchKey)) continue;
      const result = rule.build(callCtx);
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }

    /*
     * A chamada `main()` no fim do arquivo é o que FAZ o programa rodar, mas
     * não é uma instrução que a criança escreveu. Desenhá-la como bloco
     * mostraria "main" no meio da sequência visual e sugeriria que ela pode
     * ser movida, apagada ou receber comandos — item #10 do pedido.
     *
     * A estrutura Python continua idêntica: o gerador (`ensureMainCall`)
     * devolve a chamada quando os blocos são reescritos, e enquanto o código
     * não for regerado ela simplesmente continua lá, intocada.
     */
    if (describeCallee(expression.callee) === "main" && !(expression.arguments || []).length) {
      /*
       * A linha é marcada como REPRESENTADA, mesmo sem virar bloco.
       *
       * Sem isto, `return null` a deixava de fora de `representedLines` e o
       * conversor do corpo a contava como "só em Python" — um aviso
       * fantasma sobre uma linha que está exatamente onde deveria estar.
       * É o mesmo caso do import: conteúdo que o sistema trata sozinho não
       * é código órfão.
       */
      ctx.markLines?.(node);
      return null;
    }

    /*
      CHAMADA DE FUNÇÃO DO USUÁRIO / BIBLIOTECA.

      Antes: os argumentos viravam `expression.arguments.map(unparse).join(", ")`
      — uma STRING. `gb_turn(gb, hub, 90, velocidade_giro=v)` perdia o `=v` e
      virava `gb_turn(gb, hub, 90)`: uma chamada diferente, com assinatura
      diferente. Era o mesmo achatamento que o resto do projeto tinha, agora
      neste canto. O bloco montava até um objeto `args` com `arg0`, `arg1`…
      que ninguém lia — código morto que só servia para confundir.

      Os argumentos são blocos encaixados, e os nomeados guardam o nome.
    */
    const name = describeCallee(expression.callee);
    const args = (expression.arguments || []).map((arg) => expressionToBlock(arg)).filter(Boolean);
    const keywords = (expression.keywords || [])
      .map((kw) => {
        const value = expressionToBlock(kw.value);
        return value ? { name: kw.name, value } : null;
      })
      .filter(Boolean);
    const callArgs = args.length ? args : "";
    const callKeywords = keywords.length ? keywords : "";

    /*
     * BLOCO SEMÂNTICO — quando existe SCHEMA da função.
     *
     * É este caminho que faz `gb_move(gb, hub, -100)` virar
     * "mover [para trás] [100] [mm]" em vez de uma chamada genérica.
     *
     * A condição NÃO é `name === "gb_move"`: é ter um schema, e o schema
     * vale para qualquer função de qualquer biblioteca. É a exigência do
     * projeto — a inteligência vem da análise, não de um caso especial por
     * nome. `gyro_move`, `ler_cor` e qualquer outra função futura seguem o
     * mesmo caminho sem uma linha nova.
     *
     * Sem schema (função do próprio arquivo, biblioteca não analisada, ou
     * biblioteca que falhou ao ser lida), o bloco genérico abaixo continua
     * valendo: nunca há queda de representação.
     */
    const schema = ctx.schemas?.get(name);
    if (schema) {
      const semantico = blocoSemanticoDeChamada(expression, schema, ctx);
      if (semantico) return makeBlock("custom_call", semantico, node.source);
    }

    if (ctx.userFunctions?.has(name) || ctx.libraryFunctions?.has(name)) {
      return makeBlock("user_call", { name, args: callArgs, keywords: callKeywords }, node.source);
    }

    /*
      QUALQUER outra chamada vira bloco de comando genérico (item 47).

      Antes era `return null`, e a linha ia inteira para `pythonOnly`. O
      programa de stress tem `gb_turn(...)` definido no próprio arquivo, mas
      ele só é reconhecido como função do usuário quando o analisador
      semântico já rodou. Sem o fallback, uma chamada isolada sumia do
      visual mesmo tendo representação disponível.
    */
    if (name) {
      return makeBlock("generic_call_stmt", { name, args: callArgs, keywords: callKeywords }, node.source);
    }

    return null;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Reconciliação (Parte 14.3 / B06)                                    */
/* ------------------------------------------------------------------ */

/**
 * Chave de casamento: (schema, callee/params-assinatura, ordem de ocorrência,
 * profundidade). Preserva id, seleção, posição e expansão — atualiza só params.
 */
/**
 * ASSINATURA DE CONTEÚDO DO BLOCO.
 *
 * Dois blocos do mesmo tipo não são o mesmo bloco. `motor_setup` na porta A
 * e `motor_setup` na porta B são irmãos distintos, e a chave que ignorava
 * isso fazia um deles "vestir" a identidade, a posição e o estado de
 * expansão do outro.
 *
 * O sintoma era a duplicata que a criança relatava: ela apagava ou editava
 * um motor, o outro sumia do lugar e reaparecia com a identidade do
 * primeiro — dois blocos que se sobrescreviam sem que ela tivesse feito
 * nada de errado.
 *
 * A assinatura é o CONTEÚDO, nunca a posição: quando o código muda de
 * lugar, o bloco é outro de fato, e herdar a posição antiga só produz
 * sobreposição.
 */
function blockContentSignature(block) {
  const parts = [];
  const value = (node) => {
    if (node === null || node === undefined) return "";
    if (typeof node !== "object") return String(node);
    if (Array.isArray(node)) return `[${node.map(value).join("|")}]`;
    if (node.blockId) return `${node.blockId}(${Object.keys(node.params ?? {}).sort().map((k) => `${k}=${value(node.params[k])}`).join(",")})`;
    return Object.keys(node).sort().filter((k) => k !== "id" && k !== "source" && k !== "schema" && k !== "category" && k !== "shape" && k !== "children" && k !== "elseChildren" && k !== "x" && k !== "y" && k !== "expanded" && k !== "selected" && k !== "reused")
      .map((k) => `${k}=${value(node[k])}`).join(",");
  };
  parts.push(String(block.blockId));
  for (const [key, raw] of Object.entries(block.params ?? {})) parts.push(`${key}=${value(raw)}`);
  /*
   * OS FILHOS NÃO ENTRAM NA ASSINATURA — e esta é a diferença entre
   * "bloco estável" e "bloco que multiplica a cada tecla".
   *
   * Incluir os filhos amarra a identidade do pai ao conteúdo deles: apagar
   * um caractere de um bloco dentro do "quando o programa iniciar" mudava a
   * assinatura do chapéu, o chapéu deixava de casar com ele mesmo, ganhava
   * id novo — e com ele TODO o DOM da subtree. Na tela, o corpo do programa
   * era desenhado de novo por cima do anterior: a duplicata que a criança
   * viu ao apagar um caractere, e o bloco que "não apaga" quando ela tenta
   * remover a cópia, porque as duas versões disputam o mesmo lugar.
   *
   * Os filhos têm identidade PRÓPRIA e são reconciliados recursivamente,
   * um a um. O pai só precisa saber que é o mesmo pai, na mesma posição.
   */
  return parts.join(";");
}

export function reconciliationKey(block, occurrenceIndex, depth) {
  return `${block.blockId}|${blockContentSignature(block)}|${depth}`;
}

/**
 * Índice dos blocos anteriores, por CONTEÚDO.
 *
 * A chave não tem número de ocorrência de propósito. Com ocorrência, apagar
 * o primeiro de dois irmãos fazia o segundo virar "ocorrência 1" e perder a
 * identidade — que é exatamente a duplicata que a criança via. Sem
 * ocorrência, a identidade vem do conteúdo, que é o que realmente não muda
 * quando a criança apaga o irmão.
 *
 * Quando dois blocos são realmente idênticos, eles entram numa FILA: o
 * primeiro que chega fica com o primeiro que estava. Não há nada a
 * distinguir entre eles, então qualquer ordem serve — e nenhum dos dois
 * herda a posição do outro.
 */
function indexBlocks(blocks, depth = 0, map = new Map()) {
  for (const block of blocks) {
    const key = reconciliationKey(block, 0, depth);
    if (map.has(key)) map.get(key).push(block);
    else map.set(key, [block]);
    if (block.children?.length) indexBlocks(block.children, depth + 1, map);
    if (block.elseChildren?.length) indexBlocks(block.elseChildren, depth + 1, map);
  }
  return map;
}

/**
 * Atualiza os blocos existentes em vez de recriá-los do zero.
 * Mantém id, posição no canvas, seleção e estado de expansão.
 *
 * @param {Array} previous blocos renderizados atualmente
 * @param {Array} next blocos recém-gerados da IR
 */
/**
 * Reconciliação em DUAS PASSAGENS.
 *
 * O problema que uma chave única não resolve:
 *
 *   - só conteúdo → apagar um caractere muda a assinatura, o bloco não casa
 *     com ele mesmo, ganha id novo, e o DOM inteiro é reconstruído por
 *     cima do anterior. É a duplicata ao digitar, e a perda de foco;
 *   - só tipo+ordem → apagar o primeiro de dois irmãos faz o segundo virar
 *     "primeiro" e herdar o id do que foi apagado. É o bloco que não sai
 *     de lugar.
 *
 * Ordem, conteúdo, posição. A primeira passagem casa o que é igual — um
 * bloco que não mudou mantém tudo. A segunda casa o que mudou de valor pelo
 * tipo e pela ordem, que é a posição dele na sequência, não a ordem de um
 * tipo só. Um `var_set` que continua sendo o único `var_set` da sequência
 * continua sendo o MESMO bloco, mesmo com o nome mudando a cada tecla.
 */
export function reconcileBlocks(previous, next) {
  const exatos = new Map();
  const porTipo = new Map();
  for (const bloco of previous || []) indexar(bloco, exatos, porTipo);

  /*
   * Um bloco anterior é usado NO MÁXIMO UMA VEZ, pelas DUAS passagens.
   *
   * Cada bloco novo guardava uma referência ao mesmo bloco anterior: a
   * segunda passagem da busca por conteúdo não o removeva da fila por tipo,
   * então o `hub` e a variável digitada acabavam com O MESMO id. Dois
   * blocos com id igual é colisão de identidade: selecionar um seleciona o
   * outro, editar um edita o outro, e a pilha de remoção apaga o linha errada.
   *
   * `tomados` é o registro único. Quem casa um bloco o marca, e nenhuma
   * outra passagem pode oferecê-lo de novo.
   */
  const tomados = new Set();

  const applyLevel = (list, depth) => {
    for (const bloco of list) {
      const chave = reconciliationKey(bloco, 0, depth);
      const candidatosExatos = exatos.get(chave);
      const candidatosTipo = porTipo.get(`${bloco.blockId}|${depth}`);
      const combinacao = consumir(candidatosExatos, bloco.id, tomados)
        ?? consumir(candidatosTipo, bloco.id, tomados);
      if (combinacao) {
        bloco.id = combinacao.id;
        bloco.x = combinacao.x;
        bloco.y = combinacao.y;
        bloco.expanded = combinacao.expanded;
        bloco.selected = false;
        bloco.reused = true;
      }
      if (bloco.children?.length) applyLevel(bloco.children, depth + 1);
      if (bloco.elseChildren?.length) applyLevel(bloco.elseChildren, depth + 1);
    }
    return list;
  };

  return applyLevel(next, 0);
}

/**
 * Pega o primeiro bloco da fila que ainda não foi usado.
 *
 * Três filtros, nesta ordem: não pode ser o próprio bloco (o caso em que o
 * renderizador já reaproveitou o id), não pode ter sido tomado por outra
 * passagem, e só então sai da fila.
 */
function consumir(fila, idAtual, tomados) {
  if (!fila || !fila.length) return null;
  const ix = fila.findIndex((b) => b.id !== idAtual && !tomados?.has(b));
  if (ix === -1) return null;
  const escolhido = fila.splice(ix, 1)[0];
  tomados?.add(escolhido);
  return escolhido;
}

function indexar(bloco, exatos, porTipo, depth = 0) {
  const chave = reconciliationKey(bloco, 0, depth);
  if (exatos.has(chave)) exatos.get(chave).push(bloco);
  else exatos.set(chave, [bloco]);
  const tipo = `${bloco.blockId}|${depth}`;
  if (porTipo.has(tipo)) porTipo.get(tipo).push(bloco);
  else porTipo.set(tipo, [bloco]);
  for (const filho of bloco.children ?? []) indexar(filho, exatos, porTipo, depth + 1);
  for (const filho of bloco.elseChildren ?? []) indexar(filho, exatos, porTipo, depth + 1);
}

export { describeCallee, unparse, num, isNum, portFromVariable };
export default irToBlocks;

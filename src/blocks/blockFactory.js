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

import { BLOCK_BY_ID, blockDefaults, sign, units, MM_PER_ROTATION } from "./blockCatalog.js";
import { unparse, describeCallee } from "../parser/pythonParser.js";
import { resolve as resolveApi, ENUMS } from "../pybricks/apiRegistry.js";

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

  callRule(/^robot\.drive$/, (ctx) => ({
    blockId: "movement_drive",
    params: {
      direction: (ctx.argNum(0) ?? 0) < 0 ? "backward" : "forward",
      speed: Math.abs(ctx.argNum(0) ?? 200), turn_rate: ctx.argNum(1) ?? 0,
    },
  })),

  callRule(/^robot\.stop$/, () => ({ blockId: "movement_stop", params: {} })),
  callRule(/^robot\.distance$/, () => ({ blockId: "movement_distance", params: {} })),
  callRule(/^robot\.angle$/, () => ({ blockId: "movement_angle", params: {} })),
  callRule(/^robot\.reset$/, () => ({ blockId: "movement_reset", params: {} })),
  callRule(/^robot\.stalled$/, () => ({ blockId: "movement_stalled", params: {} })),

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
  callRule(/^abs$/, (ctx) => ({ blockId: "op_abs", params: { value: ctx.argNum(0) ?? 0 } })),
  callRule(/^min$/, (ctx) => ({ blockId: "op_min", params: { a: ctx.argNum(0) ?? 0, b: ctx.argNum(1) ?? 0 } })),
  callRule(/^max$/, (ctx) => ({ blockId: "op_max", params: { a: ctx.argNum(0) ?? 0, b: ctx.argNum(1) ?? 0 } })),
  callRule(/^len$/, (ctx) => {
    const arg = ctx.args[0];
    if (arg?.type === "variableReference") return { blockId: "var_list_length", params: { name: arg.name } };
    if (arg?.type === "literal" && arg.literalKind === "string") return { blockId: "op_length", params: { text: arg.value } };
    return null;
  }),
  callRule(/^print$/, (ctx) => {
    const arg = ctx.args[0];
    if (arg?.type === "variableReference") return { blockId: "var_show", params: { name: arg.name } };
    if (arg?.type === "literal" && arg.literalKind === "string") return { blockId: "hub_print", params: { text: arg.value } };
    return { blockId: "hub_print", params: { text: unparse(arg) } };
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
    const port = portFromVariable(ctx.targetName) ?? enumValue(call.arguments[0], "Port") ?? "A";
    // A direção pode vir posicional — Motor(Port.A, Direction.COUNTERCLOCKWISE) —
    // ou nomeada — Motor(Port.A, positive_direction=Direction.COUNTERCLOCKWISE).
    //
    // Não se pode misturar ?? com && sem parênteses: é SyntaxError em JS e
    // derrubava o módulo inteiro (e, em cascata, o bootstrap).
    const keywordDirection = call.keywords?.find((k) => k.name === "positive_direction")?.value ?? null;
    const direction = enumValue(call.arguments[1], "Direction") ?? enumValue(keywordDirection, "Direction");
    return {
      blockId: "motor_setup",
      params: { port, positive_direction: direction === "COUNTERCLOCKWISE" ? "ccw" : "cw" },
    };
  },

  // robot = DriveBase(motor_a, motor_b, 56, 112)
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
        left: leftPort ?? "A", right: rightPort ?? "B",
        wheel_diameter: isNum(wheel) ? wheel : 56, axle_track: isNum(axle) ? axle : 112,
      },
    };
  },

  // hub = PrimeHub()
  (ctx) => {
    const call = ctx.valueNode;
    if (call?.type !== "callExpression") return null;
    const callee = describeCallee(call.callee);
    if (!["PrimeHub", "InventorHub", "TechnicHub", "CityHub", "MoveHub", "EssentialHub"].includes(callee)) return null;
    if (ctx.targetName !== "hub") return null;
    return { blockId: "hub_setup", params: { model: callee } };
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
      blockId: "var_list_set",
      params: { name: ctx.targetName, items: ctx.valueNode.items.map(unparse).join(", ") },
    };
  },

  // x = <literal ou expressão simples>
  (ctx) => {
    if (!ctx.targetName) return null;
    const valueNode = ctx.valueNode;
    if (!valueNode) return null;
    if (valueNode.type === "literal" || valueNode.type === "variableReference" ||
        ["binaryOperation", "comparison", "booleanOperation", "unaryOperation"].includes(valueNode.type)) {
      return { blockId: "var_set", params: { name: ctx.targetName, value: unparse(valueNode) } };
    }
    return null;
  },
];

/* ---------- Augmented assignment ---------- */

const AUGMENTED_RULES = [
  // x += 1
  (ctx) => {
    if (ctx.operator !== "+=" || !ctx.targetName) return null;
    return { blockId: "var_change", params: { name: ctx.targetName, delta: num(ctx.valueNode) ?? 1 } };
  },
  // lista.append(x)  -> tratado como call
];

/* ---------- Chamadas que são assignment-like (lista.append) ---------- */

const METHOD_STATEMENT_RULES = [
  (ctx) => {
    if (ctx.calleeMethod !== "append") return null;
    return { blockId: "var_list_append", params: { name: ctx.calleeObject, value: unparse(ctx.node.arguments[0]) } };
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

/* ---------- Laços e condições ---------- */

const LOOP_RULES = [
  // for i in range(N):
  (ctx) => {
    if (ctx.node.kind !== "for") return null;
    const iterable = ctx.node.iterable;
    if (iterable?.type !== "callExpression" || describeCallee(iterable.callee) !== "range") return null;
    const args = iterable.arguments.map(num);
    if (args.length === 1 && isNum(args[0])) {
      return { blockId: "control_repeat", params: { times: args[0] } };
    }
    if (args.length >= 2 && args.every(isNum)) {
      return { blockId: "control_for_range", params: { variable: ctx.node.targets?.[0] ?? "i", start: args[0], stop: args[1] } };
    }
    return null;
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

function expressionToCondition(node, ctx) {
  if (!node) return "True";
  return unparse(node) || "True";
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

  const port = portFromVariable(objectName);
  const matchKey = port ? `${port.toLowerCase()}.${method}` : calleeText;

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
export function expressionToBlock(node) {
  if (!node) return null;

  if (node.type === "callExpression") {
    const ctx = buildCallContext(node);
    for (const rule of CALL_RULES) {
      if (!rule.methodPattern.test(ctx.matchKey)) continue;
      const result = rule.build(ctx);
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }
    return null;
  }

  if (node.type === "comparison") {
    const ctx = { left: node.left, right: node.right, operator: node.operator, node };
    for (const rule of COMPARISON_RULES) {
      const result = rule(ctx);
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }
    // fallback genérico: ( ) op ( )
    const a = num(node.left); const b = num(node.right);
    return makeBlock("op_compare", {
      left: isNum(a) ? a : unparse(node.left),
      right: isNum(b) ? b : unparse(node.right),
      operator: node.operator,
    }, node.source);
  }

  if (node.type === "booleanOperation") {
    const blockId = node.operator === "or" ? "op_or" : "op_and";
    return makeBlock(blockId, {
      left: conditionText(node.left), right: conditionText(node.right),
    }, node.source);
  }

  if (node.type === "unaryOperation" && node.operator === "not") {
    return makeBlock("op_not", { value: conditionText(node.operand) }, node.source);
  }

  if (node.type === "binaryOperation") {
    const ctx = { left: node.left, right: node.right, operator: node.operator, node };
    for (const rule of BINARY_RULES) {
      const result = rule(ctx);
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }
    return null;
  }

  if (node.type === "subscript") {
    const ctx = { object: node.object, index: node.index, node };
    for (const rule of SUBSCRIPT_RULES) {
      const result = rule(ctx);
      if (result) return makeBlock(result.blockId, result.params, node.source);
    }
    return null;
  }

  if (node.type === "variableReference") {
    return makeBlock("var_report", { name: node.name }, node.source);
  }

  return null;
}

/** Texto de condição usado nos campos booleanos. */
export function conditionText(node) {
  if (!node) return "True";
  const block = expressionToBlock(node);
  if (block) {
    // repórter/booleano aninhado: mantém o texto Python (encaixe real é Parte 12.4)
    const spec = BLOCK_BY_ID.get(block.blockId);
    return spec?.py ? spec.py(block.params) : unparse(node);
  }
  return unparse(node) || "True";
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

  const markLines = (node) => {
    if (!node?.source) return;
    for (let line = node.source.startLine; line <= (node.source.endLine ?? node.source.startLine); line += 1) {
      representedLines.add(line);
    }
  };

  const convertBody = (body, siblings = []) => {
    const out = [];
    body.forEach((node, index) => {
      const block = convertNode(node, { siblingsAfter: siblings.slice(index + 1), userFunctions, libraryFunctions, markLines });
      if (block) {
        out.push(block);
        markLines(node);
      } else if (!["comment", "pass"].includes(node.type)) {
        pythonOnly.push({
          line: node.source?.startLine ?? 0,
          text: node.rawText ?? unparse(node) ?? "",
          reason: "sem representação visual",
        });
      }
    });
    return out;
  };

  blocks.push(...convertBody(ir.body || [], ir.body || []));
  return { blocks, pythonOnly, representedLines };
}

/** Converte um único nó de statement. */
export function convertNode(node, ctx = {}) {
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
      const targetName = target?.type === "variableReference" ? target.name : null;
      const ruleCtx = { targetName, valueNode: node.value, node, target };
      for (const rule of ASSIGN_RULES) {
        const result = rule(ruleCtx);
        if (result) return makeBlock(result.blockId, result.params, node.source);
      }
      // função de usuário/biblioteca recebendo valor? mantém só no Python
      return null;
    }

    case "augmentedAssignment": {
      const targetName = node.target?.type === "variableReference" ? node.target.name : null;
      const ruleCtx = { targetName, valueNode: node.value, operator: node.operator, node };
      for (const rule of AUGMENTED_RULES) {
        const result = rule(ruleCtx);
        if (result) return makeBlock(result.blockId, result.params, node.source);
      }
      return null;
    }

    case "loop": {
      for (const rule of LOOP_RULES) {
        const result = rule({ node, ...ctx });
        if (result) {
          const block = makeBlock(result.blockId, result.params, node.source, {
            children: (node.body || []).map((child) => convertNode(child, ctx)).filter(Boolean),
          });
          return block;
        }
      }
      return null;
    }

    case "condition": {
      const result = CONDITION_RULES[0]({ node, ...ctx });
      const elseIndex = (ctx.siblingsAfter || []).findIndex((sibling) => sibling.type === "elseBranch");
      const elseNode = elseIndex >= 0 ? ctx.siblingsAfter[elseIndex] : null;
      return makeBlock(result.blockId, result.params, node.source, {
        children: (node.body || []).map((child) => convertNode(child, ctx)).filter(Boolean),
        elseChildren: elseNode ? (elseNode.body || []).map((child) => convertNode(child, ctx)).filter(Boolean) : [],
      });
    }

    case "elseBranch":
    case "exceptBranch":
    case "finallyBranch":
      // já foram absorvidos pelo if/try pai
      return null;

    case "function": {
      const params = (node.params || []).map((p) => p.name).join(", ");
      return makeBlock("myblock_define", { name: node.name, args: params }, node.source, {
        children: (node.body || []).map((child) => convertNode(child, ctx)).filter(Boolean),
      });
    }

    case "break":
      return makeBlock("control_break", {}, node.source);

    case "raise":
      return makeBlock("control_stop_all", {}, node.source);

    case "return":
      return null;

    case "tryStatement":
    case "withStatement":
    case "classDefinition":
    case "delete":
    case "global":
    case "nonlocal":
    case "matchStatement":
    case "caseBranch":
      // Python válido sem representação visual (Parte 14.4) — fica no editor
      return null;

    default:
      return null;
  }
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

    // Chamada de função do usuário ou de biblioteca -> "Meus blocos" / "Bibliotecas"
    const name = describeCallee(expression.callee);
    if (ctx.userFunctions?.has(name) || ctx.libraryFunctions?.has(name)) {
      const args = {};
      expression.arguments.forEach((arg, index) => { args[`arg${index}`] = unparse(arg); });
      expression.keywords.forEach((kw) => { args[kw.name] = unparse(kw.value); });
      return makeBlock("myblock_call", { name, args: expression.arguments.map(unparse).join(", ") }, node.source);
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
export function reconciliationKey(block, occurrenceIndex, depth) {
  return `${block.blockId}|${occurrenceIndex}|${depth}`;
}

function indexBlocks(blocks, depth = 0, map = new Map(), counter = {}) {
  for (const block of blocks) {
    const key = `${block.blockId}|${depth}`;
    counter[key] = (counter[key] ?? 0) + 1;
    map.set(reconciliationKey(block, counter[key], depth), block);
    if (block.children?.length) indexBlocks(block.children, depth + 1, map, counter);
    if (block.elseChildren?.length) indexBlocks(block.elseChildren, depth + 1, map, counter);
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
export function reconcileBlocks(previous, next) {
  const previousIndex = indexBlocks(previous || []);
  const counter = {};

  const applyLevel = (list, depth) => {
    for (const block of list) {
      const key = `${block.blockId}|${depth}`;
      counter[key] = (counter[key] ?? 0) + 1;
      const match = previousIndex.get(reconciliationKey(block, counter[key], depth));
      if (match) {
        // B06: MESMO bloco, valor novo. Preserva identidade e posição.
        block.id = match.id;
        block.x = match.x;
        block.y = match.y;
        block.expanded = match.expanded;
        block.selected = false;
        block.reused = true;
      }
      if (block.children?.length) applyLevel(block.children, depth + 1);
      if (block.elseChildren?.length) applyLevel(block.elseChildren, depth + 1);
    }
    return list;
  };

  return applyLevel(next, 0);
}

export { describeCallee, unparse, num, isNum, portFromVariable };
export default irToBlocks;

/**
 * CATÁLOGO COMPLETO DE BLOCOS — GARÇA DE BOTAS CODE STUDIO
 * --------------------------------------------------------
 * Nomes e divisão de categorias idênticos ao app SPIKE Prime em pt-BR,
 * para que quem já usa o LEGO Education não precise se readaptar (Parte 11).
 *
 * Cada bloco declara:
 *   id        schema estável (chave de reconciliação — Parte 14.3)
 *   category  categoria LEGO
 *   shape     hat | stack | c-block | reporter | boolean | cap  (Parte 12.2)
 *   template  rótulo com marcadores {param}
 *   params    parâmetros tipados -> controle de UI (Parte 13.1)
 *   advanced  parâmetros extras revelados ao expandir o bloco
 *   py        gerador de Python (params) => string
 *   imports   símbolos que precisam ser importados
 *
 * NENHUM bloco tem cadeado (B03). NENHUM bloco é "cinza" por padrão (B05/B06).
 */

import { ENUMS, PT, CATEGORY_COLOR } from "../pybricks/apiRegistry.js";

/* ------------------------------------------------------------------ */
/* Conversões de unidade (Parte 13.3)                                  */
/* ------------------------------------------------------------------ */

export const WHEEL_DIAMETER_MM = 56;      // Pendência P05 — ajustar ao robô real
export const MM_PER_ROTATION = Math.PI * WHEEL_DIAMETER_MM; // ≈ 175,93 mm
export const SPEED_FACTOR = 10;           // 75 % -> 750 graus/s

export const units = {
  /** graus a partir de rotações/graus/segundos */
  motorAngle(rotations, unit, speed = 500) {
    if (unit === "degrees") return Math.round(rotations);
    if (unit === "seconds") return Math.round((rotations * 1000 * speed) / 1000);
    return Math.round(rotations * 360);
  },
  /** mm a partir de rotações/cm/mm do DriveBase */
  driveDistance(value, unit) {
    if (unit === "cm") return Math.round(value * 10);
    if (unit === "mm") return Math.round(value);
    return Math.round(value * MM_PER_ROTATION);
  },
  /** ms a partir de segundos */
  ms(seconds) {
    return Math.round(Number(seconds) * 1000);
  },
  /** graus/s a partir de % */
  speedFromPercent(percent) {
    return Math.round(Number(percent) * SPEED_FACTOR);
  },
};

/** Sinal da direção: ↻/↑ = +1 ; ↺/↓ = −1 */
export const sign = (direction) =>
  direction === "ccw" || direction === "backward" || direction === "down" ? -1 : 1;

const motorVar = (port) => `motor_${String(port || "A").toLowerCase()}`;

/* ------------------------------------------------------------------ */
/* Helpers de definição                                                */
/* ------------------------------------------------------------------ */

const p = {
  port: (def = "A") => ({ type: "port", default: def }),
  number: (def, unit, extra = {}) => ({ type: "number", default: def, ...(unit ? { unit } : {}), ...extra }),
  select: (def, options, extra = {}) => ({ type: "select", default: def, options, ...extra }),
  enum: (kind, def, extra = {}) => ({
    type: "enum", enum: kind, default: def ?? `${kind}.${ENUMS[kind][0]}`, ...extra,
  }),
  boolean: (def = true, extra = {}) => ({ type: "boolean", default: def, ...extra }),
  text: (def = "", extra = {}) => ({ type: "text", default: def, ...extra }),
  variable: (def = "", extra = {}) => ({ type: "variable", default: def, ...extra }),
  condition: (def = "") => ({ type: "condition", default: def }),
  expression: (def = "", extra = {}) => ({ type: "expression", default: def, ...extra }),
};

const DIRECTION_MOTOR = [["cw", "↻"], ["ccw", "↺"]];
const DIRECTION_MOVE = [["forward", "↑"], ["backward", "↓"]];
const STOP_MODES = [["hold", "manter"], ["brake", "frear"], ["coast", "livre"]];
const MOTOR_UNITS = [["rotations", "rotações"], ["degrees", "graus"], ["seconds", "segundos"]];
const DISTANCE_UNITS = [["rotations", "rotações"], ["cm", "cm"], ["mm", "mm"]];
const TIME_UNITS = [["seconds", "segundos"], ["ms", "ms"]];
const COLOR_OPTIONS = ENUMS.Color.map((c) => [c, PT.Color[c]]);
const BUTTON_OPTIONS = ENUMS.Button.map((b) => [b, PT.Button[b] ?? b]);
const SIDE_OPTIONS = ENUMS.Side.map((s) => [s, PT.Side[s]]);
const ICON_OPTIONS = ENUMS.Icon.map((i) => [i, i.replace("_", " ").toLowerCase()]);

/* ------------------------------------------------------------------ */
/* CATÁLOGO                                                            */
/* ------------------------------------------------------------------ */

export const BLOCK_CATALOG = [
  /* ======================= EVENTOS (#FFBE0B) ======================= */
  {
    id: "event_program_start", category: "events", shape: "hat",
    template: "quando o programa iniciar",
    params: {}, // B-fix: bloco hat NÃO pede parâmetro — é o ponto de partida
    py: () => "# Quando o programa iniciar",
    imports: [],
  },
  {
    id: "event_message_received", category: "events", shape: "hat",
    template: "quando eu receber ({message})",
    params: { message: p.text("mensagem1") },
    py: (v) => `# Quando eu receber "${v.message}"\nwhile mailbox.read() != "${v.message}":\n    wait(10)`,
    imports: ["mailbox"], modules: ["pybricks.messaging", "pybricks.tools"],
  },
  {
    id: "event_broadcast", category: "events", shape: "stack",
    template: "transmita ({message})",
    params: { message: p.text("mensagem1") },
    py: (v) => `mailbox.send("${v.message}")`,
    imports: ["mailbox"], modules: ["pybricks.messaging"],
  },
  {
    id: "event_broadcast_wait", category: "events", shape: "stack",
    template: "transmita ({message}) e espere",
    params: { message: p.text("mensagem1") },
    py: (v) => `mailbox.send("${v.message}")\nwait(100)`,
    imports: ["mailbox", "wait"], modules: ["pybricks.messaging", "pybricks.tools"],
  },
  {
    id: "event_when_color", category: "events", shape: "hat",
    template: "{port} quando a cor é {color}",
    params: { port: p.port("C"), color: p.select("RED", COLOR_OPTIONS) },
    py: (v) => `# Quando a cor for ${PT.Color[v.color]}\nwhile color.color() != Color.${v.color}:\n    wait(10)`,
    imports: ["ColorSensor", "Color", "wait"],
    modules: ["pybricks.pupdevices", "pybricks.parameters", "pybricks.tools"],
  },
  {
    id: "event_when_distance", category: "events", shape: "hat",
    template: "{port} quando a distância é {op} ({distance}) cm",
    params: {
      port: p.port("D"), op: p.select("<", [["<", "menor que"], [">", "maior que"]]),
      distance: p.number(20, "cm"),
    },
    py: (v) => `# Quando a distância for ${v.op} ${v.distance} cm\nwhile not (distance.distance() ${v.op} ${Math.round(v.distance * 10)}):\n    wait(10)`,
    imports: ["UltrasonicSensor", "wait"], modules: ["pybricks.pupdevices", "pybricks.tools"],
  },
  {
    id: "event_when_force", category: "events", shape: "hat",
    template: "{port} quando a força é pressionada",
    params: { port: p.port("E") },
    py: () => "# Quando o sensor de força for pressionado\nwhile not force.pressed():\n    wait(10)",
    imports: ["ForceSensor", "wait"], modules: ["pybricks.pupdevices", "pybricks.tools"],
  },
  {
    id: "event_when_tilted", category: "events", shape: "hat",
    template: "quando inclinado para {side}",
    params: { side: p.select("FRONT", SIDE_OPTIONS) },
    py: (v) => `# Quando inclinado para ${PT.Side[v.side]}\nwhile hub.imu.up() != Side.${v.side}:\n    wait(10)`,
    imports: ["Side", "wait"], modules: ["pybricks.parameters", "pybricks.tools"],
  },
  {
    id: "event_when_heading", category: "events", shape: "hat",
    template: "quando guinada {op} ({angle})",
    params: { op: p.select(">", [[">", ">"], ["<", "<"], ["==", "="]]), angle: p.number(45, "graus") },
    py: (v) => `# Quando a guinada for ${v.op} ${v.angle} graus\nwhile not (hub.imu.heading() ${v.op} ${v.angle}):\n    wait(10)`,
    imports: ["wait"], modules: ["pybricks.tools"],
  },
  {
    id: "event_when_button", category: "events", shape: "hat",
    template: "quando o botão {button} pressionado",
    params: { button: p.select("LEFT", BUTTON_OPTIONS) },
    py: (v) => `# Quando o botão ${PT.Button[v.button] ?? v.button} for pressionado\nwhile not hub.buttons.pressed(Button.${v.button}):\n    wait(10)`,
    imports: ["Button", "wait"], modules: ["pybricks.parameters", "pybricks.tools"],
  },
  {
    id: "event_when_timer", category: "events", shape: "hat",
    template: "quando o cronômetro > ({seconds})",
    params: { seconds: p.number(1, "s") },
    py: (v) => `# Quando o cronômetro passar de ${v.seconds} s\nwhile timer.time() < ${Math.round(v.seconds * 1000)}:\n    wait(10)`,
    imports: ["StopWatch", "wait"], modules: ["pybricks.tools"],
  },

  /* ======================= MOVIMENTO (#F72EA8) ======================= */
  {
    id: "movement_straight", category: "movement", shape: "stack",
    template: "mover {direction} por ({amount}) {unit}",
    params: {
      direction: p.select("forward", DIRECTION_MOVE),
      amount: p.number(10),
      unit: p.select("rotations", DISTANCE_UNITS),
    },
    advanced: { speed_percent: p.number(75, "%") },
    py: (v) => {
      const mm = sign(v.direction) * units.driveDistance(v.amount, v.unit);
      return `robot.straight(${mm})`;
    },
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_turn", category: "movement", shape: "stack",
    template: "girar {direction} por ({angle}) graus",
    params: { direction: p.select("cw", [["cw", "↻"], ["ccw", "↺"]]), angle: p.number(90, "graus") },
    py: (v) => `robot.turn(${sign(v.direction) * Math.round(v.angle)})`,
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_curve", category: "movement", shape: "stack",
    template: "fazer curva de ({radius}) mm girando ({angle}) graus",
    params: { radius: p.number(200, "mm"), angle: p.number(90, "graus") },
    py: (v) => `robot.curve(${Math.round(v.radius)}, ${Math.round(v.angle)})`,
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_drive", category: "movement", shape: "stack",
    template: "iniciar movimento {direction}",
    params: { direction: p.select("forward", DIRECTION_MOVE) },
    advanced: { speed: p.number(200, "mm/s"), turn_rate: p.number(0, "graus/s") },
    py: (v) => `robot.drive(${sign(v.direction) * Math.round(v.speed ?? 200)}, ${Math.round(v.turn_rate ?? 0)})`,
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_stop", category: "movement", shape: "stack",
    template: "parar de mover",
    params: {},
    py: () => "robot.stop()",
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_speed", category: "movement", shape: "stack",
    template: "definir velocidade de movimento para ({percent}) %",
    params: { percent: p.number(75, "%", { min: 0, max: 100 }) },
    py: (v) => `robot.settings(straight_speed=${units.speedFromPercent(v.percent)})`,
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_turn_rate", category: "movement", shape: "stack",
    template: "definir velocidade de giro para ({rate}) graus/s",
    params: { rate: p.number(360, "graus/s") },
    py: (v) => `robot.settings(turn_rate=${Math.round(v.rate)})`,
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_steer_target", category: "movement", shape: "stack",
    template: "definir posição do motor de direção para ({angle})",
    params: { angle: p.number(0, "graus") },
    advanced: { port: p.port("A"), speed: p.number(500, "graus/s") },
    py: (v) => `${motorVar(v.port ?? "A")}.run_target(${Math.round(v.speed ?? 500)}, ${Math.round(v.angle)})`,
    imports: ["Motor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "movement_setup", category: "movement", shape: "stack",
    template: "definir motores de movimento para {left}+{right}",
    params: { left: p.port("A"), right: p.port("B") },
    advanced: {
      wheel_diameter: p.number(WHEEL_DIAMETER_MM, "mm"),
      axle_track: p.number(112, "mm"),
    },
    py: (v) =>
      `robot = DriveBase(${motorVar(v.left)}, ${motorVar(v.right)}, ` +
      `${Math.round(v.wheel_diameter ?? WHEEL_DIAMETER_MM)}, ${Math.round(v.axle_track ?? 112)})`,
    imports: ["DriveBase", "Motor", "Port"],
    modules: ["pybricks.robotics", "pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "movement_wheel_distance", category: "movement", shape: "stack",
    template: "definir 1 rotação de movimento igual a ({cm}) cm",
    params: { cm: p.number(17.6, "cm") },
    py: (v) => `# 1 rotação de movimento = ${v.cm} cm\nrobot = DriveBase(motor_a, motor_b, ${((v.cm * 10) / Math.PI).toFixed(2)}, 112)`,
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_distance", category: "movement", shape: "reporter",
    template: "distância percorrida",
    params: {}, py: () => "robot.distance()",
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_angle", category: "movement", shape: "reporter",
    template: "ângulo girado",
    params: {}, py: () => "robot.angle()",
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_reset", category: "movement", shape: "stack",
    template: "zerar distância e ângulo",
    params: {}, py: () => "robot.reset()",
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_stalled", category: "movement", shape: "boolean",
    template: "o movimento foi interrompido?",
    params: {}, py: () => "robot.stalled()",
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },

  /* ======================= MOTORES (#078BFF) ======================= */
  {
    id: "motor_run_angle", category: "motors", shape: "stack",
    template: "{port} executar {direction} por ({amount}) {unit}",
    params: {
      port: p.port("A"), direction: p.select("cw", DIRECTION_MOTOR),
      amount: p.number(1), unit: p.select("rotations", MOTOR_UNITS),
    },
    advanced: { speed: p.number(500, "graus/s"), then: p.select("hold", STOP_MODES) },
    py: (v) => {
      const speed = Math.round(v.speed ?? 500);
      const angle = sign(v.direction) * units.motorAngle(v.amount, v.unit, speed);
      const stop = { hold: "Stop.HOLD", brake: "Stop.BRAKE", coast: "Stop.COAST" }[v.then ?? "hold"];
      return `${motorVar(v.port)}.run_angle(${speed}, ${angle}, ${stop})`;
    },
    imports: ["Motor", "Port", "Stop"],
    modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_run_target", category: "motors", shape: "stack",
    template: "{port} ir {direction} pelo caminho mais curto para a posição ({target})",
    params: { port: p.port("A"), direction: p.select("cw", DIRECTION_MOTOR), target: p.number(0, "graus") },
    advanced: { speed: p.number(500, "graus/s"), then: p.select("hold", STOP_MODES) },
    // B04: existe equivalente REAL na Pybricks — run_target. Nada de bloqueio.
    py: (v) => {
      const stop = { hold: "Stop.HOLD", brake: "Stop.BRAKE", coast: "Stop.COAST" }[v.then ?? "hold"];
      return `${motorVar(v.port)}.run_target(${Math.round(v.speed ?? 500)}, ${Math.round(v.target)}, ${stop})`;
    },
    imports: ["Motor", "Port", "Stop"],
    modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_run_time", category: "motors", shape: "stack",
    template: "{port} executar {direction} por ({amount}) {unit}",
    params: {
      port: p.port("A"), direction: p.select("cw", DIRECTION_MOTOR),
      amount: p.number(1), unit: p.select("seconds", TIME_UNITS),
    },
    advanced: { speed: p.number(500, "graus/s") },
    py: (v) => {
      const time = v.unit === "ms" ? Math.round(v.amount) : units.ms(v.amount);
      return `${motorVar(v.port)}.run_time(${sign(v.direction) * Math.round(v.speed ?? 500)}, ${time})`;
    },
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_run", category: "motors", shape: "stack",
    template: "{port} iniciar motor {direction}",
    params: { port: p.port("A"), direction: p.select("cw", DIRECTION_MOTOR) },
    advanced: { speed: p.number(500, "graus/s") },
    py: (v) => `${motorVar(v.port)}.run(${sign(v.direction) * Math.round(v.speed ?? 500)})`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_stop", category: "motors", shape: "stack",
    template: "{port} parar motor",
    params: { port: p.port("A") },
    advanced: { mode: p.select("stop", [["stop", "livre"], ["brake", "frear"], ["hold", "manter"]]) },
    py: (v) => `${motorVar(v.port)}.${v.mode === "brake" ? "brake" : v.mode === "hold" ? "hold" : "stop"}()`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_speed_set", category: "motors", shape: "stack",
    template: "{port} definir velocidade a ({percent}) %",
    params: { port: p.port("A"), percent: p.number(75, "%", { min: -100, max: 100 }) },
    py: (v) => `${motorVar(v.port)}_speed = ${units.speedFromPercent(v.percent)}`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_dc", category: "motors", shape: "stack",
    template: "{port} definir potência para ({duty}) %",
    params: { port: p.port("A"), duty: p.number(50, "%", { min: -100, max: 100 }) },
    py: (v) => `${motorVar(v.port)}.dc(${Math.round(v.duty)})`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_position", category: "motors", shape: "reporter",
    template: "{port} posição",
    params: { port: p.port("A") },
    py: (v) => `${motorVar(v.port)}.angle()`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_speed", category: "motors", shape: "reporter",
    template: "{port} velocidade",
    params: { port: p.port("A") },
    py: (v) => `${motorVar(v.port)}.speed()`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_stalled", category: "motors", shape: "boolean",
    template: "{port} o motor travou?",
    params: { port: p.port("A") },
    py: (v) => `${motorVar(v.port)}.stalled()`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_reset_angle", category: "motors", shape: "stack",
    template: "{port} zerar posição do motor",
    params: { port: p.port("A") },
    py: (v) => `${motorVar(v.port)}.reset_angle(0)`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_setup", category: "motors", shape: "stack",
    template: "motor na porta {port}",
    params: { port: p.port("A") },
    advanced: { positive_direction: p.select("cw", DIRECTION_MOTOR) },
    py: (v) =>
      `${motorVar(v.port)} = Motor(Port.${v.port}, ` +
      `Direction.${v.positive_direction === "ccw" ? "COUNTERCLOCKWISE" : "CLOCKWISE"})`,
    imports: ["Motor", "Port", "Direction"],
    modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_pid", category: "motors", shape: "stack",
    template: "{port} definir PID para kp ({kp}) ki ({ki}) kd ({kd})",
    params: { port: p.port("A"), kp: p.number(45), ki: p.number(0), kd: p.number(0) },
    py: (v) => `${motorVar(v.port)}.control.pid(kp=${v.kp}, ki=${v.ki}, kd=${v.kd})`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_acceleration", category: "motors", shape: "stack",
    template: "{port} definir aceleração para ({value}) graus/s²",
    params: { port: p.port("A"), value: p.number(2000, "graus/s²") },
    py: (v) => `${motorVar(v.port)}.settings(acceleration=${Math.round(v.value)}, deceleration=${Math.round(v.value)})`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },

  /* ======================= SOM (#B752F4) ======================= */
  {
    id: "sound_beep", category: "sound", shape: "stack",
    template: "tocar bipe por ({seconds}) segundos",
    params: { seconds: p.number(0.5, "s") },
    advanced: { frequency: p.number(500, "Hz", { min: 64, max: 24000 }) },
    py: (v) => `hub.speaker.beep(${Math.round(v.frequency ?? 500)}, ${units.ms(v.seconds)})`,
    imports: [], modules: [],
  },
  {
    id: "sound_beep_start", category: "sound", shape: "stack",
    template: "iniciar bipe",
    params: {},
    advanced: { frequency: p.number(500, "Hz") },
    py: (v) => `hub.speaker.beep(${Math.round(v.frequency ?? 500)}, -1)`,
    imports: [], modules: [],
  },
  {
    id: "sound_notes", category: "sound", shape: "stack",
    template: "tocar som ({notes}) até o fim",
    params: { notes: p.text("C4/4 D4/4 E4/4") },
    py: (v) =>
      `hub.speaker.play_notes([${String(v.notes).trim().split(/\s+/).map((n) => `"${n}"`).join(", ")}])`,
    imports: [], modules: [],
  },
  {
    id: "sound_notes_start", category: "sound", shape: "stack",
    template: "iniciar som ({notes})",
    params: { notes: p.text("C4/4 D4/4") },
    py: (v) =>
      `hub.speaker.play_notes([${String(v.notes).trim().split(/\s+/).map((n) => `"${n}"`).join(", ")}], wait=False)`,
    imports: [], modules: [],
  },
  {
    id: "sound_stop", category: "sound", shape: "stack",
    template: "parar todos os sons",
    params: {}, py: () => "hub.speaker.stop()", imports: [], modules: [],
  },
  {
    id: "sound_volume", category: "sound", shape: "stack",
    template: "definir volume para ({percent}) %",
    params: { percent: p.number(75, "%", { min: 0, max: 100 }) },
    py: (v) => `hub.speaker.set_volume(${Math.round(v.percent)})`, imports: [], modules: [],
  },
  {
    id: "sound_volume_change", category: "sound", shape: "stack",
    template: "adicionar ({delta}) ao volume",
    params: { delta: p.number(-10, "%") },
    py: (v) => `hub.speaker.set_volume(max(0, min(100, hub.speaker.volume() + (${Math.round(v.delta)}))))`,
    imports: [], modules: [],
  },
  {
    id: "sound_volume_read", category: "sound", shape: "reporter",
    template: "volume", params: {}, py: () => "hub.speaker.volume()", imports: [], modules: [],
  },
  {
    id: "sound_note", category: "sound", shape: "stack",
    template: "tocar nota ({note}) por ({beats}) batidas",
    params: { note: p.text("C4"), beats: p.number(0.5, "batidas") },
    advanced: { tempo: p.number(120, "bpm") },
    py: (v) => `hub.speaker.play_notes(["${v.note}/${v.beats}"])`, imports: [], modules: [],
  },
  {
    id: "sound_rest", category: "sound", shape: "stack",
    template: "silêncio por ({beats}) batidas",
    params: { beats: p.number(0.5, "batidas") },
    py: (v) => `hub.speaker.play_notes(["R/${v.beats}"])`, imports: [], modules: [],
  },

  /* ======================= LUZ (#984BF4) ======================= */
  {
    id: "light_icon", category: "light", shape: "stack",
    template: "ligar {icon}",
    params: { icon: p.select("HEART", ICON_OPTIONS) },
    py: (v) => `hub.display.icon(Icon.${v.icon})`,
    imports: ["Icon"], modules: ["pybricks.parameters"],
  },
  {
    id: "light_icon_timed", category: "light", shape: "stack",
    template: "ligar {icon} por ({seconds}) segundos",
    params: { icon: p.select("HEART", ICON_OPTIONS), seconds: p.number(1, "s") },
    py: (v) => `hub.display.icon(Icon.${v.icon})\nwait(${units.ms(v.seconds)})\nhub.display.off()`,
    imports: ["Icon", "wait"], modules: ["pybricks.parameters", "pybricks.tools"],
  },
  {
    id: "light_char", category: "light", shape: "stack",
    template: "escrever ({character})",
    params: { character: p.text("A") },
    py: (v) => `hub.display.char("${String(v.character).slice(0, 1) || "A"}")`,
    imports: [], modules: [],
  },
  {
    id: "light_text", category: "light", shape: "stack",
    template: "escrever texto ({text})",
    params: { text: p.text("OLA") },
    py: (v) => `hub.display.text("${v.text}")`, imports: [], modules: [],
  },
  {
    id: "light_number", category: "light", shape: "stack",
    template: "mostrar número ({value})",
    params: { value: p.number(5) },
    py: (v) => `hub.display.number(${Math.round(v.value)})`, imports: [], modules: [],
  },
  {
    id: "light_off", category: "light", shape: "stack",
    template: "desligar", params: {}, py: () => "hub.display.off()", imports: [], modules: [],
  },
  {
    id: "light_pixel", category: "light", shape: "stack",
    template: "ligar píxel ({row}) ({column})",
    params: { row: p.number(1, "", { min: 1, max: 5 }), column: p.number(1, "", { min: 1, max: 5 }) },
    advanced: { brightness: p.number(100, "%", { min: 0, max: 100 }) },
    // interface 1..5 -> Pybricks 0..4
    py: (v) => `hub.display.pixel(${Math.max(0, Math.round(v.row) - 1)}, ${Math.max(0, Math.round(v.column) - 1)}, ${Math.round(v.brightness ?? 100)})`,
    imports: [], modules: [],
  },
  {
    id: "light_center", category: "light", shape: "stack",
    template: "definir luz central para {color}",
    params: { color: p.select("RED", COLOR_OPTIONS) },
    py: (v) => `hub.light.on(Color.${v.color})`,
    imports: ["Color"], modules: ["pybricks.parameters"],
  },
  {
    id: "light_center_off", category: "light", shape: "stack",
    template: "apagar luz central", params: {}, py: () => "hub.light.off()", imports: [], modules: [],
  },
  {
    id: "light_orientation", category: "light", shape: "stack",
    template: "definir orientação da matriz para ({angle}) graus",
    params: { angle: p.number(0, "graus") },
    py: (v) => `hub.display.orientation(${Math.round(v.angle)})`, imports: [], modules: [],
  },
  {
    id: "light_sensor_lights", category: "light", shape: "stack",
    template: "ligar luzes do sensor {port} por ({seconds}) segundos",
    params: { port: p.port("D"), seconds: p.number(1, "s") },
    advanced: { color: p.select("WHITE", COLOR_OPTIONS) },
    py: (v) => {
      const varName = v.port === "D" ? "distance" : "color";
      return `${varName}.lights.on(Color.${v.color ?? "WHITE"})\nwait(${units.ms(v.seconds)})\n${varName}.lights.off()`;
    },
    imports: ["Color"], modules: ["pybricks.parameters"],
  },

  /* ======================= CONTROLE (#FF9914) ======================= */
  {
    id: "control_wait", category: "control", shape: "stack",
    template: "espere ({amount}) {unit}",
    params: { amount: p.number(1), unit: p.select("seconds", TIME_UNITS) },
    py: (v) => `wait(${v.unit === "ms" ? Math.round(v.amount) : units.ms(v.amount)})`,
    imports: ["wait"], modules: ["pybricks.tools"],
  },
  {
    id: "control_repeat", category: "control", shape: "c-block",
    template: "repita ({times})",
    params: { times: p.number(10) },
    py: (v) => `for i in range(${Math.round(v.times)}):`,
    imports: [], modules: [], block: true,
  },
  {
    id: "control_forever", category: "control", shape: "c-block",
    template: "sempre", params: {}, py: () => "while True:",
    imports: [], modules: [], block: true,
  },
  {
    id: "control_if", category: "control", shape: "c-block",
    template: "se {condition} então",
    params: { condition: p.condition("True") },
    py: (v) => `if ${v.condition || "True"}:`,
    imports: [], modules: [], block: true,
  },
  {
    id: "control_if_else", category: "control", shape: "c-block",
    template: "se {condition} então",
    params: { condition: p.condition("True") },
    py: (v) => `if ${v.condition || "True"}:`,
    imports: [], modules: [], block: true, elseBranch: true,
  },
  {
    id: "control_repeat_until", category: "control", shape: "c-block",
    template: "repita até que {condition}",
    params: { condition: p.condition("False") },
    py: (v) => `while not (${v.condition || "False"}):`,
    imports: [], modules: [], block: true,
  },
  {
    id: "control_wait_until", category: "control", shape: "stack",
    template: "espere até que {condition}",
    params: { condition: p.condition("False") },
    py: (v) => `while not (${v.condition || "False"}):\n    wait(10)`,
    imports: ["wait"], modules: ["pybricks.tools"],
  },
  {
    id: "control_stop_all", category: "control", shape: "cap",
    template: "pare tudo", params: {}, py: () => "raise SystemExit",
    imports: [], modules: [],
  },
  {
    id: "control_break", category: "control", shape: "cap",
    template: "sair do laço", params: {}, py: () => "break", imports: [], modules: [],
  },
  {
    id: "control_for_range", category: "control", shape: "c-block",
    template: "para {variable} de ({start}) até ({stop})",
    params: { variable: p.variable("i"), start: p.number(0), stop: p.number(10) },
    py: (v) => `for ${v.variable || "i"} in range(${Math.round(v.start)}, ${Math.round(v.stop)}):`,
    imports: [], modules: [], block: true,
  },
  {
    id: "control_while", category: "control", shape: "c-block",
    template: "enquanto {condition}",
    params: { condition: p.condition("True") },
    py: (v) => `while ${v.condition || "True"}:`,
    imports: [], modules: [], block: true,
  },
  {
    id: "control_multitask", category: "control", shape: "stack",
    template: "executar ao mesmo tempo ({tasks})",
    params: { tasks: p.text("tarefa_a(), tarefa_b()") },
    py: (v) => `multitask(${v.tasks})`,
    imports: ["multitask"], modules: ["pybricks.tools"],
  },

  /* ======================= SENSORES (#15C3DF) ======================= */
  {
    id: "sensor_setup_color", category: "sensors", shape: "stack",
    template: "sensor de cor na porta {port}",
    params: { port: p.port("C") },
    py: (v) => `color = ColorSensor(Port.${v.port})`,
    imports: ["ColorSensor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "sensor_setup_distance", category: "sensors", shape: "stack",
    template: "sensor de distância na porta {port}",
    params: { port: p.port("D") },
    py: (v) => `distance = UltrasonicSensor(Port.${v.port})`,
    imports: ["UltrasonicSensor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "sensor_setup_force", category: "sensors", shape: "stack",
    template: "sensor de força na porta {port}",
    params: { port: p.port("E") },
    py: (v) => `force = ForceSensor(Port.${v.port})`,
    imports: ["ForceSensor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "sensor_color_is", category: "sensors", shape: "boolean",
    template: "a cor é {color}?",
    params: { color: p.select("RED", COLOR_OPTIONS) },
    py: (v) => `color.color() == Color.${v.color}`,
    imports: ["ColorSensor", "Color"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "sensor_color", category: "sensors", shape: "reporter",
    template: "cor", params: {}, py: () => "color.color()",
    imports: ["ColorSensor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "sensor_reflection", category: "sensors", shape: "reporter",
    template: "luz refletida", params: {}, py: () => "color.reflection()",
    imports: ["ColorSensor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "sensor_distance_compare", category: "sensors", shape: "boolean",
    template: "é mais {op} que ({distance}) cm?",
    params: { op: p.select("<", [["<", "perto"], [">", "longe"]]), distance: p.number(20, "cm") },
    py: (v) => `distance.distance() ${v.op} ${Math.round(v.distance * 10)}`,
    imports: ["UltrasonicSensor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "sensor_distance_cm", category: "sensors", shape: "reporter",
    template: "distância em cm", params: {}, py: () => "distance.distance() / 10",
    imports: ["UltrasonicSensor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "sensor_distance_mm", category: "sensors", shape: "reporter",
    template: "distância em mm", params: {}, py: () => "distance.distance()",
    imports: ["UltrasonicSensor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "sensor_force", category: "sensors", shape: "reporter",
    template: "força", params: {}, py: () => "force.force()",
    imports: ["ForceSensor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "sensor_pressed", category: "sensors", shape: "boolean",
    template: "pressionado?", params: {}, py: () => "force.pressed()",
    imports: ["ForceSensor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "sensor_tilt_is", category: "sensors", shape: "boolean",
    template: "inclinado para {side}?",
    params: { side: p.select("FRONT", SIDE_OPTIONS) },
    py: (v) => `hub.imu.up() == Side.${v.side}`,
    imports: ["Side"], modules: ["pybricks.parameters"],
  },
  {
    id: "sensor_heading", category: "sensors", shape: "reporter",
    template: "ângulo de guinada", params: {}, py: () => "hub.imu.heading()", imports: [], modules: [],
  },
  {
    id: "sensor_reset_heading", category: "sensors", shape: "stack",
    template: "zerar ângulo de guinada", params: {}, py: () => "hub.imu.reset_heading(0)", imports: [], modules: [],
  },
  {
    id: "sensor_button_pressed", category: "sensors", shape: "boolean",
    template: "o botão {button} pressionado?",
    params: { button: p.select("LEFT", BUTTON_OPTIONS) },
    py: (v) => `hub.buttons.pressed(Button.${v.button})`,
    imports: ["Button"], modules: ["pybricks.parameters"],
  },
  {
    id: "sensor_timer", category: "sensors", shape: "reporter",
    template: "cronômetro", params: {}, py: () => "timer.time() / 1000",
    imports: ["StopWatch"], modules: ["pybricks.tools"],
  },
  {
    id: "sensor_timer_reset", category: "sensors", shape: "stack",
    template: "zere o cronômetro", params: {}, py: () => "timer.reset()",
    imports: ["StopWatch"], modules: ["pybricks.tools"],
  },
  {
    id: "sensor_acceleration", category: "sensors", shape: "reporter",
    template: "aceleração {axis}",
    params: { axis: p.select("0", [["0", "x"], ["1", "y"], ["2", "z"]]) },
    py: (v) => `hub.imu.acceleration()[${v.axis}]`, imports: [], modules: [],
  },
  {
    id: "sensor_angular_velocity", category: "sensors", shape: "reporter",
    template: "velocidade angular {axis}",
    params: { axis: p.select("0", [["0", "x"], ["1", "y"], ["2", "z"]]) },
    py: (v) => `hub.imu.angular_velocity()[${v.axis}]`, imports: [], modules: [],
  },
  {
    id: "sensor_battery", category: "sensors", shape: "reporter",
    template: "tensão da bateria", params: {}, py: () => "hub.battery.voltage()", imports: [], modules: [],
  },

  /* ======================= OPERADORES (#0ACB72) ======================= */
  {
    id: "op_math", category: "operators", shape: "reporter",
    template: "({left}) {operator} ({right})",
    params: {
      left: p.number(10), right: p.number(5),
      operator: p.select("+", [["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"], ["//", "//"], ["**", "^"]]),
    },
    py: (v) => `(${v.left} ${v.operator} ${v.right})`, imports: [], modules: [],
  },
  {
    id: "op_random", category: "operators", shape: "reporter",
    template: "número aleatório entre ({min}) e ({max})",
    params: { min: p.number(1), max: p.number(10) },
    py: (v) => `randint(${Math.round(v.min)}, ${Math.round(v.max)})`,
    imports: ["randint"], modules: ["random"], builtin: true,
  },
  {
    id: "op_compare", category: "operators", shape: "boolean",
    template: "({left}) {operator} ({right})",
    params: {
      left: p.expression("x"), right: p.number(50),
      operator: p.select(">", [[">", ">"], ["<", "<"], ["==", "="], ["!=", "≠"], [">=", "≥"], ["<=", "≤"]]),
    },
    py: (v) => `(${v.left || "0"} ${v.operator} ${v.right})`, imports: [], modules: [],
  },
  {
    id: "op_and", category: "operators", shape: "boolean",
    template: "{left} e {right}",
    params: { left: p.condition("True"), right: p.condition("True") },
    py: (v) => `((${v.left || "True"}) and (${v.right || "True"}))`, imports: [], modules: [],
  },
  {
    id: "op_or", category: "operators", shape: "boolean",
    template: "{left} ou {right}",
    params: { left: p.condition("True"), right: p.condition("True") },
    py: (v) => `((${v.left || "True"}) or (${v.right || "True"}))`, imports: [], modules: [],
  },
  {
    id: "op_not", category: "operators", shape: "boolean",
    template: "não {value}",
    params: { value: p.condition("True") },
    py: (v) => `(not (${v.value || "True"}))`, imports: [], modules: [],
  },
  {
    id: "op_join", category: "operators", shape: "reporter",
    template: 'junte ({a}) ({b})',
    params: { a: p.text("maçã"), b: p.text("banana") },
    py: (v) => `(f"{${JSON.stringify(v.a)}}}{${JSON.stringify(v.b)}}")`, imports: [], modules: [],
  },
  {
    id: "op_letter", category: "operators", shape: "reporter",
    template: "letra ({index}) de ({text})",
    params: { index: p.number(1), text: p.text("maçã") },
    py: (v) => `${JSON.stringify(String(v.text))}[${Math.max(0, Math.round(v.index) - 1)}]`,
    imports: [], modules: [],
  },
  {
    id: "op_length", category: "operators", shape: "reporter",
    template: "comprimento de ({text})",
    params: { text: p.text("maçã") },
    py: (v) => `len(${JSON.stringify(String(v.text))})`, imports: [], modules: [],
  },
  {
    id: "op_contains", category: "operators", shape: "boolean",
    template: "({text}) contém ({piece})?",
    params: { text: p.text("maçã"), piece: p.text("a") },
    py: (v) => `(${JSON.stringify(String(v.piece))} in ${JSON.stringify(String(v.text))})`,
    imports: [], modules: [],
  },
  {
    id: "op_mod", category: "operators", shape: "reporter",
    template: "o resto de ({left}) por ({right})",
    params: { left: p.number(11), right: p.number(3) },
    py: (v) => `(${Math.round(v.left)} % ${Math.round(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_round", category: "operators", shape: "reporter",
    template: "arredonde ({value})",
    params: { value: p.number(3.14) },
    py: (v) => `round(${v.value})`, imports: [], modules: [],
  },
  {
    id: "op_abs", category: "operators", shape: "reporter",
    template: "abs de ({value})",
    params: { value: p.number(9) },
    py: (v) => `abs(${v.value})`, imports: [], modules: [],
  },
  {
    id: "op_min", category: "operators", shape: "reporter",
    template: "menor de ({a}) ({b})",
    params: { a: p.number(1), b: p.number(2) },
    py: (v) => `min(${v.a}, ${v.b})`, imports: [], modules: [],
  },
  {
    id: "op_max", category: "operators", shape: "reporter",
    template: "maior de ({a}) ({b})",
    params: { a: p.number(1), b: p.number(2) },
    py: (v) => `max(${v.a}, ${v.b})`, imports: [], modules: [],
  },

  /* ======================= VARIÁVEIS (#F730AB) ======================= */
  {
    id: "var_set", category: "variables", shape: "stack",
    template: "mude ({name}) para ({value})",
    params: { name: p.variable("minha variável"), value: p.expression("0") },
    py: (v) => `${v.name || "minha_variavel"} = ${v.value ?? 0}`, imports: [], modules: [],
  },
  {
    id: "var_change", category: "variables", shape: "stack",
    template: "adicione ({delta}) a ({name})",
    params: { delta: p.number(1), name: p.variable("minha variável") },
    py: (v) => `${v.name || "minha_variavel"} += ${v.delta}`, imports: [], modules: [],
  },
  {
    id: "var_report", category: "variables", shape: "reporter",
    template: "{name}",
    params: { name: p.variable("minha variável") },
    py: (v) => `${v.name || "minha_variavel"}`, imports: [], modules: [],
  },
  {
    id: "var_show", category: "variables", shape: "stack",
    template: "mostre a variável ({name})",
    params: { name: p.variable("minha variável") },
    py: (v) => `print(${v.name || "minha_variavel"})`, imports: [], modules: [],
  },
  {
    id: "var_hide", category: "variables", shape: "stack",
    template: "esconda a variável ({name})",
    params: { name: p.variable("minha variável") },
    py: (v) => `# esconder ${v.name || "minha_variavel"} (sem equivalente no firmware Pybricks)`,
    imports: [], modules: [],
  },
  {
    id: "var_list_set", category: "variables", shape: "stack",
    template: "crie a lista ({name}) com ({items})",
    params: { name: p.variable("lista"), items: p.text("1, 2, 3") },
    py: (v) => `${v.name || "lista"} = [${v.items}]`, imports: [], modules: [],
  },
  {
    id: "var_list_append", category: "variables", shape: "stack",
    template: "adicione ({value}) à lista ({name})",
    params: { value: p.expression("0"), name: p.variable("lista") },
    py: (v) => `${v.name || "lista"}.append(${v.value ?? 0})`, imports: [], modules: [],
  },
  {
    id: "var_list_length", category: "variables", shape: "reporter",
    template: "comprimento da lista ({name})",
    params: { name: p.variable("lista") },
    py: (v) => `len(${v.name || "lista"})`, imports: [], modules: [],
  },

  /* ======================= MEUS BLOCOS (#FF506B) ======================= */
  {
    id: "myblock_define", category: "myblocks", shape: "hat",
    template: "defina ({name})",
    params: { name: p.variable("nome do seu bloco") },
    advanced: { args: p.text("") },
    py: (v) => `def ${v.name || "meu_bloco"}(${v.args || ""}):`,
    imports: [], modules: [], block: true,
  },
  {
    id: "myblock_call", category: "myblocks", shape: "stack",
    template: "{name}",
    params: { name: p.variable("nome do seu bloco") },
    advanced: { args: p.text("") },
    py: (v) => `${v.name || "meu_bloco"}(${v.args || ""})`, imports: [], modules: [],
  },

  /* ==================== BIBLIOTECAS (#00C2A8 — dinâmica) ==================== */
  /*
   * Parte 11.16: gerada a partir dos símbolos do VFS.
   * O bloco chama a função REAL do módulo — nunca possui uma segunda
   * implementação escondida. O import é acrescentado automaticamente (B08).
   *
   * Exemplo: [ gyro_move ]  distance: (500)  speed: (300)
   *   -> from movements import gyro_move
   *      gyro_move(robot=robot, hub=hub, distance=500, speed=300)
   */
  {
    id: "library_call", category: "libraries", shape: "stack",
    template: "{name}",
    params: { name: p.variable("gyro_move"), module: p.text("movements") },
    advanced: { args: p.text("") },
    py: (v) => `${v.name || "funcao"}(${v.args || ""})`,
    imports: [], modules: [],
    /** o import vem do módulo declarado em params.module */
    dynamicModule: true,
  },

  /* ======================= HUB (#3D7EFF) ======================= */
  {
    id: "hub_setup", category: "hub", shape: "stack",
    template: "inicializar o HUB",
    params: {},
    advanced: { model: p.select("PrimeHub", [["PrimeHub", "SPIKE Prime"], ["InventorHub", "SPIKE Essential"], ["TechnicHub", "Technic"]]) },
    py: (v) => `hub = ${v.model || "PrimeHub"}()`,
    imports: ["PrimeHub"], modules: ["pybricks.hubs"],
  },
  {
    id: "hub_timer_setup", category: "hub", shape: "stack",
    template: "inicializar o cronômetro",
    params: {}, py: () => "timer = StopWatch()",
    imports: ["StopWatch"], modules: ["pybricks.tools"],
  },
  {
    id: "hub_shutdown", category: "hub", shape: "cap",
    template: "desligar o HUB", params: {}, py: () => "hub.system.shutdown()", imports: [], modules: [],
  },
  {
    id: "hub_print", category: "hub", shape: "stack",
    template: "escreva no terminal ({text})",
    params: { text: p.text("Olá, mundo!") },
    py: (v) => `print(${JSON.stringify(String(v.text))})`, imports: [], modules: [],
  },
];

/* ------------------------------------------------------------------ */
/* Índices                                                             */
/* ------------------------------------------------------------------ */

export const BLOCK_BY_ID = new Map(BLOCK_CATALOG.map((block) => [block.id, block]));

export function blocksByCategory(category) {
  return BLOCK_CATALOG.filter((block) => block.category === category);
}

export function blockDefaults(block) {
  const out = {};
  for (const [key, spec] of Object.entries(block.params || {})) out[key] = spec.default;
  for (const [key, spec] of Object.entries(block.advanced || {})) out[key] = spec.default;
  return out;
}

/** Nunca devolve null/undefined (B01 / N02). */
export function safeValue(spec, raw) {
  if (raw === null || raw === undefined || raw === "") return spec?.default ?? "";
  if (spec?.type === "number") {
    const parsed = Number(String(raw).trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : spec.default ?? 0;
  }
  if (spec?.type === "boolean") return Boolean(raw);
  return raw;
}

export { CATEGORY_COLOR };
export default BLOCK_CATALOG;

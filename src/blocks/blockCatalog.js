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
import { ROBOT_CONFIG, mmPerRotation, wheelDiameterForCm } from "../config/robot.js";

/* ------------------------------------------------------------------ */
/* Conversões de unidade (Parte 13.3)                                  */
/* ------------------------------------------------------------------ */

/**
 * Geometria do robô: NÃO vem daqui. Vem de src/config/robot.js, que é a
 * fonte única (roda 62,4 mm, eixo 48 mm). Reexportado só por compatibilidade
 * com quem já importava daqui.
 */
export const WHEEL_DIAMETER_MM = ROBOT_CONFIG.wheel_diameter;   // 62,4 mm
export const AXLE_TRACK_MM = ROBOT_CONFIG.axle_track;           // 48 mm
export const MM_PER_ROTATION = mmPerRotation(WHEEL_DIAMETER_MM); // ≈ 196,03 mm
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

/**
 * NOME DA VARIÁVEL QUE O BLOCO CRIA.
 *
 * Este é o conserto de uma classe inteira de bugs de duplicação. Antes,
 * `motor_setup` escrevia o nome DENTRO do `py()`:
 *
 *     py: (v) => `${motorVar(v.port)} = Motor(...)`
 *
 * O bloco só guardava a PORTA, então o nome que a criança escreveu no
 * arquivo sumia no caminho de volta. Com `esq = Motor(Port.B)` e
 * `dir_ = Motor(Port.A)`, os dois viravam `motor_a = Motor(Port.A, ...)`:
 * duas linhas IGUAIS na tela, que a criança lê como duplicata sem
 * motivo — e o motivo existe, é o bloco esquecendo o nome.
 *
 * A regra: quem CRIA uma variável guarda o nome dela. Quando o campo está
 * vazio (bloco arrastado novo da paleta), cai no nome convencional.
 *
 * `original` guarda o identificador tal como estava no Python, para o
 * round-trip devolver exatamente a mesma letra, maiúscula/minúscula.
 */
const CREATED_VAR = (value, fallback) => {
  const typed = String(value?.var ?? "").trim();
  if (typed) return typed;
  return String(value?.original ?? "").trim() || fallback;
};

/** Número para Python: aceita vírgula decimal e nunca imprime "62,4". */
const numberLiteral = (value) => {
  const parsed = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(6))) : "0";
};

/** Identificador Python válido a partir de um rótulo em português. */
const identifier = (value, fallback = "valor") => {
  const text = String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\W+/g, "_")
    .replace(/^\d+/, "");
  return /^[A-Za-z_]\w*$/.test(text) ? text : fallback;
};

/** Texto do usuário como literal Python seguro. */
const pyString = (value) => JSON.stringify(String(value ?? ""));

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

/**
 * Normaliza um valor de parâmetro para o texto que o Python espera.
 *
 * O bloco NENHUM sabe se o valor veio de um socket encaixado ou de um
 * input: `resolveParams()` (src/blocks/socket.js) já recursivamente trocou
 * qualquer bloco aninhado pelo Python dele ANTES de a função `py` rodar.
 * Aqui só falta normalizar escalares — sobretudo booleanos, que em Python
 * são `True`/`False` e em JavaScript `true`/`false`.
 *
 * O ponto de reconhecer `null` como "vazio" é intencional: um socket vazio
 * não pode gerar a string "null" no Python.
 */
/**
 * Nome da base de movimento tal como a criança escreveu.
 *
 * O bloco "parar de mover" gerava `robot.stop()` fixo. Se o arquivo chama
 * a base de `gb` — como meio programa de FLL faz — o round-trip devolvia
 * `robot.stop()` e o Python mudava de nome sozinho. Nomes diferentes de
 * variável são a MESMA coisa para o Pybricks, mas não são o mesmo texto, e
 * uma IDE bidirecional não pode reescrever o nome que a criança escolheu.
 *
 * Por isso o bloco lembra o nome que encontrou na conversão, e usa `robot`
 * só quando não sabe (bloco arrastado da paleta).
 */
const driveObject = (value) => String(value?.object ?? "").trim() || "robot";

/**
 * Assinatura de uma função montada a partir dos parâmetros ESTRUTURADOS.
 *
 * Quando existe `parameters`, a assinatura sai dela — cada nome com sua
 * anotação e seu valor padrão, que é o que o Python exige. O default pode
 * ser um bloco encaixado (`velocidade=max(1, int(v / 5))`), e é por isso
 * que ele entra já resolvido.
 *
 * A string `args` continua sendo o caminho antigo, usado quando o bloco
 * veio da paleta em vez de do Python — assim um "defina meu bloco" criado
 * à mão ainda gera Python válido.
 */
const signature = (value) => {
  const parameters = value?.parameters;
  if (!Array.isArray(parameters) || parameters.length === 0) return String(value?.args ?? "");

  return parameters.map((param) => {
    const name = String(param?.name ?? "").trim();
    if (!name) return "";
    const annotation = param.annotation ? `: ${param.annotation}` : "";
    const hasDefault = param.default !== null && param.default !== undefined;
    const fallback = hasDefault ? resolve(param.default) : "";
    return `${name}${annotation}${hasDefault && fallback ? `=${fallback}` : ""}`;
  }).filter(Boolean).join(", ");
};

const resolve = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
    /*
     * O chapéu do programa NÃO é um comentário: ele é a função `main()` de
     * verdade. Sem `block: true` os blocos dragged para baixo dele eram
     * gerados FORA de qualquer função e o Python saía errado.
     *
     * O bloco de corpo e a chamada `main()` são fechados pelo
     * codeGenerator (fechaMain), que entende a indentação de pybricks.
     */
    py: () => "def main():",
    imports: [], modules: [], block: true,
    isMain: true,
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
    template: "{port} quando a distância é {op} ({distance})",
    shortTemplate: "{port} quando a distância é {op} ({distance}) cm",
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
    /*
     * `unit` é o seletor de medida (voltas / cm / mm) e precisa existir para
     * a matemática — mas é renderizado como um controle COMPACTO colado no
     * campo numérico, não como um `<select>` largo com texto redundante.
     * Antes aparecia "por (50) rotações cm mm", que se lê como três medidas.
     */
    template: "mover {direction} por ({amount}{unit})",
    shortTemplate: "mover {direction} por ({amount}{unit})",
    params: {
      direction: p.select("forward", DIRECTION_MOVE),
      amount: p.number(10),
      unit: p.select("rotations", DISTANCE_UNITS, { compact: true }),
    },
    advanced: { speed_percent: p.number(75, "%") },
    py: (v) => {
      const mm = sign(v.direction) * units.driveDistance(v.amount, v.unit);
      return `${driveObject(v)}.straight(${mm})`;
    },
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_turn", category: "movement", shape: "stack",
    /*
     * `graus` aparecia DUAS vezes ("girar ↻ por (90) graus ) graus"): a
     * unidade estava escrita no texto E o campo numérico já desenhava a
     * unidade ao lado. O texto fica sem a unidade — quem mostra é o campo.
     */
    template: "girar {direction} por ({angle})",
    params: { direction: p.select("cw", [["cw", "↻"], ["ccw", "↺"]]), angle: p.number(90, "graus") },
    py: (v) => `${driveObject(v)}.turn(${sign(v.direction) * Math.round(v.angle)})`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_curve", category: "movement", shape: "stack",
    template: "fazer curva de ({radius}) girando ({angle})",
    params: { radius: p.number(200, "mm"), angle: p.number(90, "graus") },
    py: (v) => `${driveObject(v)}.curve(${Math.round(v.radius)}, ${Math.round(v.angle)})`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_drive", category: "movement", shape: "stack",
    template: "iniciar movimento {direction}",
    params: { direction: p.select("forward", DIRECTION_MOVE) },
    advanced: { speed: p.number(200, "mm/s"), turn_rate: p.number(0, "graus/s") },
    py: (v) => `robot.drive(${sign(v.direction) * Math.round(v.speed ?? 200)}, ${Math.round(v.turn_rate ?? 0)})`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_stop", category: "movement", shape: "stack",
    template: "parar de mover",
    params: {},
    py: (v) => `${driveObject(v)}.stop()`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_speed", category: "movement", shape: "stack",
    template: "definir velocidade de movimento para ({percent})",
    params: { percent: p.number(75, "%", { min: 0, max: 100 }) },
    py: (v) => `${driveObject(v)}.settings(straight_speed=${units.speedFromPercent(v.percent)})`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_turn_rate", category: "movement", shape: "stack",
    template: "definir velocidade de giro para ({rate})",
    params: { rate: p.number(360, "graus/s") },
    py: (v) => `${driveObject(v)}.settings(turn_rate=${Math.round(v.rate)})`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_steer_target", category: "movement", shape: "stack",
    template: "definir posição do motor de direção para ({angle})",
    shortTemplate: "definir posição do motor de direção para ({angle})",
    params: { angle: p.number(0, "graus") },
    advanced: { port: p.port("A"), speed: p.number(500, "graus/s") },
    py: (v) => `${motorVar(v.port ?? "A")}.run_target(${Math.round(v.speed ?? 500)}, ${Math.round(v.angle)})`,
    imports: ["Motor"], modules: ["pybricks.pupdevices"],
  },
  {
    id: "movement_setup", category: "movement", shape: "stack",
    /*
     * Item #9: este bloco era largo demais e pesava na leitura.
     *
     * A frase longa virou a RÓTULO de duas linhas, e a geometria (roda/eixo)
     * virou um painel próprio logo abaixo, com rótulos curtos. O conteúdo
     * útil — as duas portas — fica na primeira linha, onde se lê.
     *
     * O Python gerado é idêntico ao de antes: a organização é visual.
     */
    template: "motores de movimento {left} + {right}",
    params: {
      left: p.port(ROBOT_CONFIG.left_port), right: p.port(ROBOT_CONFIG.right_port),
    },
    /* Campos de geometria: ficam no painel próprio (abaixo), não na frase. */
    geometry: {
      wheel_diameter: p.number(ROBOT_CONFIG.wheel_diameter, "mm", { min: 1 }),
      axle_track: p.number(ROBOT_CONFIG.axle_track, "mm", { min: 1 }),
    },
    /* Mesmo motivo do `motor_setup`: o nome da base precisa sobreviver. */
    advanced: { var: p.variable("", { label: "nome da base" }) },
    doc: "Cria a base de movimento (DriveBase) com as portas e a geometria do robô da equipe. É o primeiro bloco de qualquer programa que anda.",
    py: (v) =>
      `${CREATED_VAR(v, "robot")} = DriveBase(${motorVar(v.left)}, ${motorVar(v.right)}, ` +
      `${numberLiteral(v.wheel_diameter ?? WHEEL_DIAMETER_MM)}, ${numberLiteral(v.axle_track ?? AXLE_TRACK_MM)})`,
    imports: ["DriveBase", "Motor"],
    modules: ["pybricks.robotics", "pybricks.pupdevices"],
  },
  {
    id: "movement_wheel_distance", category: "movement", shape: "stack",
    template: "definir 1 rotação de movimento igual a ({cm})",
    shortTemplate: "1 rotação = ({cm}) cm",
    params: { cm: p.number(Number((mmPerRotation() / 10).toFixed(2)), "cm") },
    doc: "Informa quantos centímetros o robô anda em uma volta completa da roda.",
    py: (v) => `# 1 rotação de movimento = ${v.cm} cm\nrobot = DriveBase(motor_a, motor_b, ${wheelDiameterForCm(v.cm).toFixed(2)}, ${AXLE_TRACK_MM})`,
    imports: ["DriveBase"], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_distance", category: "movement", shape: "reporter",
    template: "distância percorrida",
    params: { object: p.text("robot") }, py: (v) => `${driveObject(v)}.distance()`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_angle", category: "movement", shape: "reporter",
    template: "ângulo girado",
    params: { object: p.text("robot") }, py: (v) => `${driveObject(v)}.angle()`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_reset", category: "movement", shape: "stack",
    template: "zerar distância e ângulo",
    params: { object: p.text("robot") }, py: (v) => `${driveObject(v)}.reset()`,
    imports: [], modules: ["pybricks.robotics"],
  },
  {
    id: "movement_stalled", category: "movement", shape: "boolean",
    template: "o movimento foi interrompido?",
    params: { object: p.text("robot") }, py: (v) => `${driveObject(v)}.stalled()`,
    imports: [], modules: ["pybricks.robotics"],
  },

  /* ======================= MOTORES (#078BFF) ======================= */
  {
    id: "motor_run_angle", category: "motors", shape: "stack",
    template: "{port} executar {direction} por ({amount}) {unit}",
    shortTemplate: "{port} executar {direction} por ({amount}) {unit}",
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
    shortTemplate: "{port} ir até a posição ({target})",
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
    shortTemplate: "{port} executar {direction} por ({amount}) {unit}",
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
    template: "{port} definir velocidade a ({percent})",
    params: { port: p.port("A"), percent: p.number(75, "%", { min: -100, max: 100 }) },
    py: (v) => `${motorVar(v.port)}_speed = ${units.speedFromPercent(v.percent)}`,
    imports: ["Motor", "Port"], modules: ["pybricks.pupdevices", "pybricks.parameters"],
  },
  {
    id: "motor_dc", category: "motors", shape: "stack",
    template: "{port} definir potência para ({duty})",
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
    advanced: {
      positive_direction: p.select("cw", DIRECTION_MOTOR),
      // Nome da variável criada. Vazio = usa `motor_<porta>`, que é o que
      // a maioria dos programas faz e o que a criança espera ver.
      var: p.variable("", { label: "nome do motor" }),
    },
    py: (v) =>
      `${CREATED_VAR(v, motorVar(v.port))} = Motor(Port.${v.port}, ` +
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
    template: "{port} definir aceleração para ({value})",
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
    template: "definir volume para ({percent})",
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
    template: "tocar nota ({note}) por ({beats})",
    shortTemplate: "tocar nota ({note})",
    params: { note: p.text("C4"), beats: p.number(0.5, "batidas") },
    advanced: { tempo: p.number(120, "bpm") },
    py: (v) => `hub.speaker.play_notes(["${v.note}/${v.beats}"])`, imports: [], modules: [],
  },
  {
    id: "sound_rest", category: "sound", shape: "stack",
    template: "silêncio por ({beats})",
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
    shortTemplate: "ligar {icon} por ({seconds}) segundos",
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
    template: "definir orientação da matriz para ({angle})",
    params: { angle: p.number(0, "graus") },
    py: (v) => `hub.display.orientation(${Math.round(v.angle)})`, imports: [], modules: [],
  },
  {
    id: "light_sensor_lights", category: "light", shape: "stack",
    template: "ligar luzes do sensor {port} por ({seconds}) segundos",
    shortTemplate: "ligar luzes do sensor {port}",
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
    /*
      `for` com `range` — 1, 2 ou 3 argumentos.

      O bloco só sabia `range(inicio, fim)`, e os dois campos eram NÚMEROS.
      O programa de stress usa `range(int(velocidade), 0, -passo)`: três
      argumentos, o primeiro sendo uma expressão e o terceiro negativo.
      Não havia como representar aquilo, e caía em `pythonOnly`.

      Agora os três são sockets de expressão e o `step` só aparece no
      Python quando é informado — `range(a, b)` continua saindo com dois
      argumentos, que é o que a criança espera.
    */
    id: "control_for_range", category: "control", shape: "c-block",
    template: "para {variable} de ({start}) até ({stop})",
    // Texto de apoio do rótulo: só aparece quando há `step`.
    labelWhen: { step: " de ({step}) em" },
    params: {
      variable: p.variable("i"),
      start: p.expression(0),
      stop: p.expression(10),
      step: p.expression(""),
    },
    py: (v) => {
      const args = [resolve(v.start) || "0", resolve(v.stop) || "0"];
      const step = String(resolve(v.step) ?? "").trim();
      if (step) args.push(step);
      return `for ${v.variable || "i"} in range(${args.join(", ")}):`;
    },
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
    shortTemplate: "executar ao mesmo tempo ({tasks})",
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
    template: "é mais {op} que ({distance})?",
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
  /*
    OPERADORES ARITMÉTICOS — um bloco por operador.
   *
    Antes havia UM bloco `op_math` com um seletor de operador, cujos dois
    lados eram `p.number()`. Isso é o defeito do item #6: com os lados
    numéricos, era IMPOSSÍVEL encaixar `erro * KP_STRAIGHT` — as duas
    pontas eram campos de número, não sockets.
 *
    Agora cada operador é um bloco próprio, com sockets de expressão nos
    dois lados. É também o que a criança espera: no LEGO Education/Scratch
    existe um bloco "multiplicar", não um bloco "escolher a conta".
   */
  {
    id: "op_add", category: "operators", shape: "reporter",
    template: "({left}) + ({right})",
    params: { left: p.expression("1"), right: p.expression("2") },
    py: (v) => `(${resolve(v.left)} + ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_subtract", category: "operators", shape: "reporter",
    template: "({left}) − ({right})",
    params: { left: p.expression("5"), right: p.expression("2") },
    py: (v) => `(${resolve(v.left)} - ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_multiply", category: "operators", shape: "reporter",
    template: "({left}) × ({right})",
    params: { left: p.expression("2"), right: p.expression("3") },
    py: (v) => `(${resolve(v.left)} * ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_divide", category: "operators", shape: "reporter",
    template: "({left}) ÷ ({right})",
    params: { left: p.expression("10"), right: p.expression("2") },
    py: (v) => `(${resolve(v.left)} / ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_floordiv", category: "operators", shape: "reporter",
    template: "({left}) ÷ inteiro ({right})",
    params: { left: p.expression("10"), right: p.expression("2") },
    py: (v) => `(${resolve(v.left)} // ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_pow", category: "operators", shape: "reporter",
    template: "({left}) elevado a ({right})",
    params: { left: p.expression("2"), right: p.expression("3") },
    py: (v) => `(${resolve(v.left)} ** ${resolve(v.right)})`, imports: [], modules: [],
  },

  /*
    COMPARAÇÕES — um bloco por operador,同样的 raciocínio dos aritméticos.
    Os dois lados são sockets de expressão, então aceitam número, variável,
    reporter do HUB ou outra conta inteira.
  */
  {
    id: "op_lt", category: "operators", shape: "boolean",
    template: "({left}) < ({right})?",
    params: { left: p.expression("0"), right: p.expression("10") },
    py: (v) => `(${resolve(v.left)} < ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_gt", category: "operators", shape: "boolean",
    template: "({left}) > ({right})?",
    params: { left: p.expression("0"), right: p.expression("10") },
    py: (v) => `(${resolve(v.left)} > ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_le", category: "operators", shape: "boolean",
    template: "({left}) ≤ ({right})?",
    params: { left: p.expression("0"), right: p.expression("10") },
    py: (v) => `(${resolve(v.left)} <= ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_ge", category: "operators", shape: "boolean",
    template: "({left}) ≥ ({right})?",
    params: { left: p.expression("0"), right: p.expression("10") },
    py: (v) => `(${resolve(v.left)} >= ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_eq", category: "operators", shape: "boolean",
    template: "({left}) = ({right})?",
    params: { left: p.expression("0"), right: p.expression("0") },
    py: (v) => `(${resolve(v.left)} == ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_ne", category: "operators", shape: "boolean",
    template: "({left}) ≠ ({right})?",
    params: { left: p.expression("0"), right: p.expression("0") },
    py: (v) => `(${resolve(v.left)} != ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_in", category: "operators", shape: "boolean",
    template: "({left}) está em ({right})?",
    params: { left: p.expression(""), right: p.expression("") },
    py: (v) => `(${resolve(v.left)} in ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_not_in", category: "operators", shape: "boolean",
    template: "({left}) não está em ({right})?",
    params: { left: p.expression(""), right: p.expression("") },
    py: (v) => `(${resolve(v.left)} not in ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_is", category: "operators", shape: "boolean",
    template: "({left}) é ({right})?",
    params: { left: p.expression(""), right: p.expression("None") },
    py: (v) => `(${resolve(v.left)} is ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_is_not", category: "operators", shape: "boolean",
    template: "({left}) não é ({right})?",
    params: { left: p.expression(""), right: p.expression("None") },
    py: (v) => `(${resolve(v.left)} is not ${resolve(v.right)})`, imports: [], modules: [],
  },

  {
    id: "op_math", category: "operators", shape: "reporter",
    template: "({left}) {operator} ({right})",
    params: {
      left: p.expression(10), right: p.expression(5),
      operator: p.select("+", [["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"], ["//", "//"], ["**", "^"]]),
    },
    py: (v) => `(${resolve(v.left)} ${v.operator} ${resolve(v.right)})`, imports: [], modules: [],
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
      left: p.expression("x"), right: p.expression(50),
      operator: p.select(">", [[">", ">"], ["<", "<"], ["==", "="], ["!=", "≠"], [">=", "≥"], ["<=", "≤"]]),
    },
    py: (v) => `(${resolve(v.left) || "0"} ${v.operator} ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_and", category: "operators", shape: "boolean",
    template: "{left} e {right}",
    params: { left: p.condition("True"), right: p.condition("True") },
    py: (v) => `((${resolve(v.left) || "True"}) and (${resolve(v.right) || "True"}))`, imports: [], modules: [],
  },
  {
    id: "op_or", category: "operators", shape: "boolean",
    template: "{left} ou {right}",
    params: { left: p.condition("True"), right: p.condition("True") },
    py: (v) => `((${resolve(v.left) || "True"}) or (${resolve(v.right) || "True"}))`, imports: [], modules: [],
  },
  {
    id: "op_not", category: "operators", shape: "boolean",
    template: "não {value}",
    params: { value: p.condition("True") },
    py: (v) => `(not (${resolve(v.value) || "True"}))`, imports: [], modules: [],
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
    py: (v) => `(${resolve(v.left)} % ${resolve(v.right)})`, imports: [], modules: [],
  },
  {
    id: "op_round", category: "operators", shape: "reporter",
    template: "arredonde ({value})",
    params: { value: p.expression("3.14") },
    py: (v) => `round(${resolve(v.value)})`, imports: [], modules: [],
  },
  {
    id: "op_abs", category: "operators", shape: "reporter",
    template: "abs de ({value})",
    params: { value: p.expression("9") },
    py: (v) => `abs(${resolve(v.value)})`, imports: [], modules: [],
  },
  {
    id: "op_int", category: "operators", shape: "reporter",
    template: "arredonda para inteiro ({value})",
    params: { value: p.expression("3.7") },
    py: (v) => `int(${resolve(v.value)})`, imports: [], modules: [],
  },
  {
    id: "op_float", category: "operators", shape: "reporter",
    template: "converta para número ({value})",
    params: { value: p.expression("3") },
    py: (v) => `float(${resolve(v.value)})`, imports: [], modules: [],
  },
  {
    id: "op_str", category: "operators", shape: "reporter",
    template: "texto de ({value})",
    params: { value: p.expression("0") },
    py: (v) => `str(${resolve(v.value)})`, imports: [], modules: [],
  },
  {
    id: "op_min", category: "operators", shape: "reporter",
    template: "menor de ({a}) e ({b})",
    params: { a: p.expression("1"), b: p.expression("2") },
    py: (v) => `min(${resolve(v.a)}, ${resolve(v.b)})`, imports: [], modules: [],
  },
  {
    id: "op_max", category: "operators", shape: "reporter",
    template: "maior de ({a}) e ({b})",
    params: { a: p.expression("1"), b: p.expression("2") },
    py: (v) => `max(${resolve(v.a)}, ${resolve(v.b)})`, imports: [], modules: [],
  },

  /* ======================= LITERAIS ================================ *
   *
   * Um socket precisa de um bloco para o caso simples. `erro * 2` tem
   * `2` no lado direito: esse 2 é um nó `literal` na IR e precisa virar
   * alguma coisa de verdade no visual — não um texto solto dentro de uma
   * caixa que finge ser um bloco.
   *
   * Eles ficam escondidos da paleta (categoria `advanced`, e ainda
   * marcados como `hiddenFromPalette`) porque uma criança nunca vai
   * arrastar "o número 1" da paleta; o número aparece quando ela encaixa
   * uma conta. Mas eles são blocos de primeira classe: serializam,
   * sincronizam e geram Python como qualquer outro.
   * ==================================================================== */
  {
    id: "literal_number", category: "advanced", shape: "reporter", hiddenFromPalette: true,
    template: "({value})",
    params: { value: p.number(0) },
    py: (v) => String(Number(v.value) || 0), imports: [], modules: [],
  },
  {
    id: "literal_text", category: "advanced", shape: "reporter", hiddenFromPalette: true,
    template: "({value})",
    params: { value: p.text("") },
    py: (v) => JSON.stringify(String(v.value ?? "")), imports: [], modules: [],
  },
  {
    id: "literal_bool", category: "advanced", shape: "reporter", hiddenFromPalette: true,
    template: "({value})",
    params: { value: p.select("True", [["True", "sim"], ["False", "não"]]) },
    py: (v) => (v.value === "False" ? "False" : "True"), imports: [], modules: [],
  },
  {
    id: "literal_none", category: "advanced", shape: "reporter", hiddenFromPalette: true,
    template: "nada",
    params: {},
    py: () => "None", imports: [], modules: [],
  },

  /* ======================= AVANÇADO (fallbacks) ======================= *
   *
   * Decisão de produto (usuário): os blocos genéricos existem, mas NÃO
   * ficam na paleta principal —eles ficam numa categoria recolhida no fim.
   * Uma criança de 11 anos nunca precisa escolher "chamar função" para
   * seguir um programa; quando o Python real exige, o bloco aparece pronto.
   * A categoria existe para quando a criança QUISER explorar.
   *
   * São o último recurso antes de `pythonOnly` (itens 47 e 48).
   * ==================================================================== */
  {
    id: "generic_call", category: "advanced", shape: "reporter",
    template: "{name}({args})",
    /*
      `keywords` guarda os argumentos NOMEADOS da chamada, estruturados
      (`{ name, value }`).

      Antes eles não existiam: `gb_turn(gb, hub, angulo, velocidade_giro=v)`
      perdia o `=v` e virava `gb_turn(gb, hub, angulo)`. O programa de stress
      usa exatamente isso na chamada a `gb_turn`, e o round-trip mudava a
      assinatura do programa.
    */
    params: { name: p.text("função"), args: p.expression(""), keywords: p.expression("") },
    py: (v) => {
      const positional = resolve(v.args);
      const named = (Array.isArray(v.keywords) ? v.keywords : [])
        .map((kw) => `${kw.name}=${resolve(kw.value)}`)
        .filter(Boolean)
        .join(", ");
      const todos = [positional, named].filter((part) => String(part).trim()).join(", ");
      return `${String(v.name).trim()}(${todos})`;
    },
    imports: [], modules: [],
  },
  {
    id: "generic_call_stmt", category: "advanced", shape: "stack",
    template: "chame {name}({args})",
    params: { name: p.text("função"), args: p.expression(""), keywords: p.expression("") },
    py: (v) => {
      const positional = resolve(v.args);
      const named = (Array.isArray(v.keywords) ? v.keywords : [])
        .map((kw) => `${kw.name}=${resolve(kw.value)}`).filter(Boolean).join(", ");
      const todos = [positional, named].filter((part) => String(part).trim()).join(", ");
      return `${String(v.name).trim()}(${todos})`;
    },
    imports: [], modules: [],
  },
  {
    id: "generic_attribute", category: "advanced", shape: "reporter",
    template: "{object}.{attribute}",
    params: { object: p.expression(""), attribute: p.text("atributo") },
    py: (v) => `${resolve(v.object)}.${String(v.attribute).trim()}`,
    imports: [], modules: [],
  },
  {
    id: "generic_subscript", category: "advanced", shape: "reporter",
    template: "{object}[{index}]",
    params: { object: p.expression(""), index: p.expression("0") },
    py: (v) => `${resolve(v.object)}[${resolve(v.index)}]`,
    imports: [], modules: [],
  },
  {
    id: "generic_operator", category: "advanced", shape: "reporter",
    template: "{left} {operator} {right}",
    params: {
      left: p.expression("0"), right: p.expression("0"),
      operator: p.select("+", [
        ["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"],
        ["//", "//"], ["%", "resto"], ["**", "^"],
        ["&", "e (bits)"], ["|", "ou (bits)"], ["^", "xor (bits)"],
        ["<<", "mover <<"], [">>", "mover >>"],
      ]),
    },
    py: (v) => `(${resolve(v.left)} ${v.operator} ${resolve(v.right)})`,
    imports: [], modules: [],
  },
  {
    id: "op_ternary", category: "advanced", shape: "reporter",
    template: "se {condition} então {then} senão {otherwise}",
    params: { condition: p.condition("True"), then: p.expression("1"), otherwise: p.expression("-1") },
    py: (v) => `(${resolve(v.then)} if ${resolve(v.condition)} else ${resolve(v.otherwise)})`,
    imports: [], modules: [],
  },
  /*
    CHAMADA PYBRICKS COM EXPRESSÕES — `gb.drive(velocidade * direcao, correcao)`

    O bloco `movement_drive` ("iniciar movimento") é a forma LEGO: direção
    + velocidade + taxa de giro, com NÚMEROS. Ele mapeia o Pybricks para
    um vocabulário didático, e isso é ótimo — mas não cobre o caso real do
    programa de stress, onde a velocidade é uma EXPRESSÃO
    (`velocidade_atual * direcao`) e a correção é uma variável.

    Forçar esses valores em campos numéricos mentiria sobre o código. Este
    bloco é a resposta honesta: mantém o objeto (`gb`), o método
    (`drive`) e os argumentos como sockets, e o Python volta idêntico.

    Fica na categoria Avançado, mas aparece sozinho quando o programa real
    precisa — a criança não precisa procurar na paleta.
  */
  {
    id: "pybricks_call", category: "advanced", shape: "stack",
    template: "{object}.{method}({args})",
    params: {
      object: p.text("gb"), method: p.text("drive"),
      args: p.expression(""),
    },
    py: (v) => `${String(v.object || "gb").trim()}.${String(v.method || "").trim()}(${resolve(v.args)})`,
    imports: [], modules: [],
  },
  {
    id: "pybricks_call_expr", category: "advanced", shape: "reporter",
    template: "{object}.{method}({args})",
    params: {
      object: p.text("hub"), method: p.text("light"),
      args: p.expression(""),
    },
    py: (v) => `${String(v.object || "hub").trim()}.${String(v.method || "").trim()}(${resolve(v.args)})`,
    imports: [], modules: [],
  },
  {
    id: "generic_unary", category: "advanced", shape: "reporter",
    template: "{operator}({value})",
    params: {
      value: p.expression("0"),
      operator: p.select("-", [["-", "−"], ["+", "+"], ["~", "inverto bits"]]),
    },
    py: (v) => `(${v.operator}${resolve(v.value)})`,
    imports: [], modules: [],
  },
  {
    id: "list_literal", category: "advanced", shape: "reporter", hiddenFromPalette: true,
    template: "[{items}]",
    params: { items: p.expression("") },
    py: (v) => {
      const items = Array.isArray(v.items) ? v.items : [];
      if (!items.length) return "[]";
      return `[${items.map((item) => resolve(item)).join(", ")}]`;
    },
    imports: [], modules: [],
  },
  {
    id: "var_change_op", category: "variables", shape: "stack", hiddenFromPalette: true,
    template: "mude ({name}) usando {operator} ({delta})",
    params: {
      name: p.variable("minha variável"), delta: p.expression(1),
      operator: p.select("-", [["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"], ["//", "//"], ["%", "resto"], ["**", "^"]]),
    },
    py: (v) => `${v.name || "minha_variavel"} ${v.operator}= ${resolve(v.delta) || "1"}`,
    imports: [], modules: [],
  },
  {
    id: "user_call", category: "myblocks", shape: "stack",
    template: "chame {name}({args})",
    params: { name: p.text("minha_funcao"), args: p.expression(""), keywords: p.expression("") },
    py: (v) => {
      const positional = resolve(v.args);
      const named = (Array.isArray(v.keywords) ? v.keywords : [])
        .map((kw) => `${kw.name}=${resolve(kw.value)}`).filter(Boolean).join(", ");
      const todos = [positional, named].filter((part) => String(part).trim()).join(", ");
      return `${String(v.name).trim()}(${todos})`;
    },
    imports: [], modules: [],
  },
  {
    id: "user_call_expr", category: "myblocks", shape: "reporter",
    template: "{name}({args})",
    params: { name: p.text("minha_funcao"), args: p.expression("") },
    py: (v) => `${String(v.name).trim()}(${resolve(v.args)})`,
    imports: [], modules: [],
  },
  {
    id: "control_return", category: "control", shape: "cap",
    template: "retorne ({value})",
    params: { value: p.expression("") },
    py: (v) => {
      const value = String(v.value ?? "").trim();
      return value ? `return ${value}` : "return";
    },
    imports: [], modules: [],
  },

  /* ======================= VARIÁVEIS (#F730AB) ======================= */
  {
    id: "var_set", category: "variables", shape: "stack",
    template: "mude ({name}) para ({value})",
    params: { name: p.variable("minha variável"), value: p.expression("0") },
    py: (v) => `${v.name || "minha_variavel"} = ${resolve(v.value) || "0"}`, imports: [], modules: [],
  },
  {
    id: "var_change", category: "variables", shape: "stack",
    template: "adicione ({delta}) a ({name})",
    params: { delta: p.expression(1), name: p.variable("minha variável") },
    py: (v) => `${v.name || "minha_variavel"} += ${resolve(v.delta) || "1"}`, imports: [], modules: [],
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
    shortTemplate: "mostre a variável ({name})",
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
  /* ======================= LISTAS (#8E7CFF) ======================= */
  {
    id: "list_create", category: "lists", shape: "stack",
    template: "crie a lista ({name}) com ({items})",
    params: { name: p.variable("lista"), items: p.text("1, 2, 3") },
    doc: "Cria uma lista vazia ou já preenchida. Todo programa com lista precisa deste bloco antes de usar os outros.",
    py: (v) => `${identifier(v.name, "lista")} = [${String(v.items ?? "").trim()}]`,
    imports: [], modules: [],
  },
  {
    id: "list_append", category: "lists", shape: "stack",
    template: "adicione ({value}) à lista ({name})",
    params: { value: p.expression("0"), name: p.variable("lista") },
    doc: "Coloca um valor no fim da lista.",
    py: (v) => `${identifier(v.name, "lista")}.append(${v.value ?? 0})`,
    imports: [], modules: [],
  },
  {
    id: "list_insert", category: "lists", shape: "stack",
    template: "insira ({value}) na posição ({index}) da lista ({name})",
    shortTemplate: "insira ({value}) na posição ({index})",
    params: { value: p.expression("0"), index: p.number(1), name: p.variable("lista") },
    doc: "Coloca um valor numa posição específica da lista.",
    py: (v) => `${identifier(v.name, "lista")}.insert(${Math.max(0, Math.round(v.index ?? 1) - 1)}, ${v.value ?? 0})`,
    imports: [], modules: [],
  },
  {
    id: "list_remove_value", category: "lists", shape: "stack",
    template: "remova ({value}) da lista ({name})",
    shortTemplate: "remova ({value}) da lista ({name})",
    params: { value: p.expression("0"), name: p.variable("lista") },
    doc: "Remove a primeira ocorrência do valor na lista.",
    py: (v) => `remove_once(${identifier(v.name, "lista")}, ${v.value ?? 0})`,
    imports: ["remove_once"], modules: ["pybricks.tools"],
  },
  {
    id: "list_remove_index", category: "lists", shape: "stack",
    template: "remova a posição ({index}) da lista ({name})",
    shortTemplate: "remova a posição ({index})",
    params: { index: p.number(1), name: p.variable("lista") },
    doc: "Remove o item que está na posição informada (contando de 1).",
    py: (v) => `${identifier(v.name, "lista")}.pop(${Math.max(0, Math.round(v.index ?? 1) - 1)})`,
    imports: [], modules: [],
  },
  {
    id: "list_get_item", category: "lists", shape: "reporter",
    template: "item ({index}) da lista ({name})",
    shortTemplate: "item ({index}) da lista ({name})",
    params: { index: p.number(1), name: p.variable("lista") },
    doc: "Lê um item da lista. Use em expressões, comparações e para mostrar na tela.",
    py: (v) => `${identifier(v.name, "lista")}[${Math.max(0, Math.round(v.index ?? 1) - 1)}]`,
    imports: [], modules: [],
  },
  {
    id: "list_index_of", category: "lists", shape: "reporter",
    template: "posição de ({value}) na lista ({name})",
    shortTemplate: "posição de ({value})",
    params: { value: p.expression("0"), name: p.variable("lista") },
    doc: "Devolve a posição (começando em 1) do valor na lista, ou 0 se não existir.",
    py: (v) => `(${identifier(v.name, "lista")}.index(${v.value ?? 0}) + 1)`,
    imports: [], modules: [],
  },
  {
    id: "list_length", category: "lists", shape: "reporter",
    template: "tamanho da lista ({name})",
    params: { name: p.variable("lista") },
    doc: "Quantos itens a lista tem agora.",
    py: (v) => `len(${identifier(v.name, "lista")})`,
    imports: [], modules: [],
  },
  {
    id: "list_contains", category: "lists", shape: "boolean",
    template: "a lista ({name}) contém ({value})?",
    shortTemplate: "a lista ({name}) contém ({value})?",
    params: { name: p.variable("lista"), value: p.expression("0") },
    doc: "Responde sim ou não: o valor está na lista?",
    py: (v) => `(${v.value ?? 0} in ${identifier(v.name, "lista")})`,
    imports: [], modules: [],
  },
  {
    id: "list_is_empty", category: "lists", shape: "boolean",
    template: "a lista ({name}) está vazia?",
    shortTemplate: "a lista ({name}) está vazia?",
    params: { name: p.variable("lista") },
    doc: "Responde sim ou não: a lista não tem nenhum item?",
    py: (v) => `(len(${identifier(v.name, "lista")}) == 0)`,
    imports: [], modules: [],
  },
  {
    id: "list_clear", category: "lists", shape: "stack",
    template: "esvazie a lista ({name})",
    params: { name: p.variable("lista") },
    doc: "Apaga todos os itens da lista, mas a lista continua existindo.",
    py: (v) => `${identifier(v.name, "lista")}.clear()`,
    imports: [], modules: [],
  },
  {
    id: "list_reverse", category: "lists", shape: "stack",
    template: "inverta a lista ({name})",
    params: { name: p.variable("lista") },
    doc: "Inverte a ordem dos itens da lista.",
    py: (v) => `${identifier(v.name, "lista")}.reverse()`,
    imports: [], modules: [],
  },
  {
    id: "list_sort", category: "lists", shape: "stack",
    template: "ordene a lista ({name})",
    params: { name: p.variable("lista") },
    doc: "Coloca os itens da lista em ordem crescente.",
    py: (v) => `${identifier(v.name, "lista")}.sort()`,
    imports: [], modules: [],
  },
  {
    id: "list_copy", category: "lists", shape: "stack",
    template: "copie a lista ({name}) para ({target})",
    shortTemplate: "copie a lista ({name}) para ({target})",
    params: { name: p.variable("lista"), target: p.variable("copia") },
    doc: "Cria uma cópia independente da lista.",
    py: (v) => `${identifier(v.target, "copia")} = list(${identifier(v.name, "lista")})`,
    imports: [], modules: [],
  },

  /* ======================= MEUS BLOCOS (#FF506B) ======================= */
  {
    id: "myblock_define", category: "myblocks", shape: "hat",
    template: "defina ({name})",
    params: { name: p.variable("nome do seu bloco") },
    /*
     * `args` NÃO aparece para a criança (item #6 do pedido): um campo de
     * texto genérico com o nome técnico dentro é ilegível para quem tem
     * 11 anos. A assinatura continua existindo no modelo — é ela que
     * reproduz o `def` fielmente — mas o painel visual mostra um campo
     * tipado por parâmetro dentro da frase (ver `functionFieldsHtml`).
     */
    advanced: { args: p.expression("") },
    doc: "Cria uma função Python sua. Depois de escrev\u00ed-la, ela vira bloco na categoria Meus blocos.",
    py: (v) => `def ${identifier(v.name, "meu_bloco")}(${signature(v)}):`,
    imports: [], modules: [], block: true,
  },
  {
    id: "myblock_call", category: "myblocks", shape: "stack",
    template: "{name}",
    params: { name: p.variable("nome do seu bloco") },
    advanced: { args: p.expression("") },
    doc: "Chama uma função definida por você neste arquivo.",
    py: (v) => `${identifier(v.name, "meu_bloco")}(${v.args || ""})`, imports: [], modules: [],
  },

  /* ============== BLOCO DE CÓDIGO PYTHON — NADA É DESCARTADO ============ */
  /*
   * REGRA CRÍTICA (nunca perder código do usuário): quando o Python escrito
   * pela equipe ainda não tem um bloco visual correspondente, o trecho NÃO é
   * apagado, ignorado nem substituído. Ele vira este bloco, que devolve
   * exatamente as linhas originais, na posição original.
   */
  {
    id: "python_code", category: "myblocks", shape: "code",
    template: "{code}",
    params: { code: p.text("# linhas preservadas") },
    doc: "Trecho escrito direto em Python que o editor ainda não sabe mostrar como bloco. O texto é preservado exatamente como foi digitado.",
    /*
     * O texto já vem com a indentação do arquivo original, e o gerador
     * acrescenta a indentação do pai a CADA linha. Sem descontar a comum,
     * um `try` dentro de uma `def` saía com o dobro do recuo e o Python
     * deixava de compilar — a linha estava "preservada" e inválida.
     */
    py: (v) => {
      const linhas = String(v.code ?? "").replace(/[ \t]+$/gm, "").split("\n");
      while (linhas.length && linhas[linhas.length - 1].trim() === "") linhas.pop();
      const comuns = linhas
        .filter((l) => l.trim())
        .map((l) => (/^\s*/.exec(l)?.[0] ?? "").length);
      const base = comuns.length ? Math.min(...comuns) : 0;
      return linhas.map((l) => (l.trim() ? l.slice(base) : "")).join("\n");
    },
    imports: [], modules: [],
    raw: true,
  },

  /* ================= BLOCO DE FUNÇÃO DO PROJETO ================= */
  /*
   * "Criar bloco a partir de função Python" (pedido do usuário).
   *
   * Se existe `def gyro_move(distancia, velocidade)` em `movimento.py`, o
   * sistema reconhece a função e monta um bloco com um campo por parâmetro.
   * O código gerado é o MESMO Python, com o nome técnico preservado:
   *
   *   Visual : Mover com girosc00f3pio   distância (500)   velocidade (300)
   *   Python : from movimento import gyro_move
   *            gyro_move(distancia=500, velocidade=300)
   *
   * Não existe botão fixo "Gyro Move": QUALQUER função vira bloco.
   */
  {
    id: "custom_call", category: "myblocks", shape: "stack",
    template: "{label}",
    params: { label: p.text("função"), function: p.text("funcao"), module: p.text("modulo") },
    /** os campos por parâmetro vivem em params.fields (ver blockRenderer) */
    py: (v) => gerarChamadaDeBloco(v),
    imports: [], modules: [],
    dynamicModule: true,
  },

  /* ======================= HUB (#3D7EFF) ======================= */
  {
    id: "hub_setup", category: "hub", shape: "stack",
    template: "inicializar o HUB",
    params: {},
    advanced: {
      model: p.select("PrimeHub", [["PrimeHub", "SPIKE Prime"], ["InventorHub", "SPIKE Essential"], ["TechnicHub", "Technic"]]),
      var: p.variable("", { label: "nome do hub" }),
    },
    py: (v) => `${CREATED_VAR(v, "hub")} = ${v.model || "PrimeHub"}()`,
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
    shortTemplate: "escreva no terminal ({text})",
    params: { text: p.text("Olá, mundo!") },
    py: (v) => `print(${JSON.stringify(String(v.text))})`, imports: [], modules: [],
  },
];


import { convert as converterUnidade } from "../semantic/units.js";

/**
 * GERAÇÃO DE CHAMADA DE FUNÇÃO DE BIBLIOTECA
 *
 * Este é o caminho de VOLTA: o que a criança vê na tela vira texto Python.
 * Ele tem que obedecer três coisas ao mesmo tempo.
 *
 * 1. ARGUMENTOS OCULTOS VOLTAM. `gb` e `hub` não aparecem no bloco, mas
 *    precisam sair no Python, na posição original da assinatura. Sem isto,
 *    esconder um argumento apagaria código do programa da criança — o que
 *    a regra do projeto proíbe.
 *
 * 2. O SINAL VEM DO DROPDOWN DE DIREÇÃO. O campo guarda o módulo, e o
 *    `sign` (-1 ou 1) é aplicado aqui. Se o sinal fosse reescrito no
 *    campo, trocar a direção e digitar de novo entrariam em conflito.
 *
 * 3. A UNIDADE É CONVERTIDA. O campo pode estar em cm enquanto a função
 *    espera mm; a conversão usa a tabela de unidades, e nunca é um texto.
 *
 * Quando o bloco não tem schema semântico (`semantic` ausente), o
 * comportamento antigo vale: campos nomeados, na ordem em que estão. É o
 * que mantém as 134 blocos do catálogo funcionando sem mudança.
 */
function gerarChamadaDeBloco(v) {
  const nome = String(v.function || "funcao");
  const campos = Array.isArray(v.fields) ? v.fields : [];
  const semantico = v.semantic ?? null;

  if (!semantico) {
    if (!campos.length) return `${nome}()`;
    const args = campos
      .filter((field) => field.value !== "" && field.value !== undefined)
      .map((field) => `${identifier(field.name, "valor")}=${field.value}`)
      .join(", ");
    return `${nome}(${args})`;
  }

  /*
   * Os ocultos entram PRIMEIRO, na ordem em que `camposVisiveis` não
   * aparece. `v.ocultosValores` foi guardado na ida com os valores reais
   * lidos do Python; sem ele, não há o que escrever e o bloco sinaliza.
   */
  const ocultos = semantico.ocultos ?? [];
  const valoresOcultos = v.ocultosValores ?? {};

  const partes = [];
  for (const nomeOculto of ocultos) {
    const valor = valoresOcultos[nomeOculto];
    if (valor === undefined || valor === null || valor === "") continue;
    partes.push(String(valor));
  }

  const visiveis = semantico.camposVisiveis ?? campos.map((f) => f.name);

  for (const nomeCampo of visiveis) {
    const campo = campos.find((c) => c.name === nomeCampo);
    if (!campo) continue;

    /*
     * Ausente no Python de entrada, ausente na saída.
     *
     * O campo pode até ter valor na tela (é o que o bloco sugere), mas
     * escreve-lo seria acrescentar argumento que a chamada não tinha. O
     * default pertence à função, e a função já o aplica.
     */
    /*
     * `resolveValue` converte booleanos para o texto Python: `true` chega
     * aqui como `"True"` e `false` como `"False"`.
     *
     * Só `"True"` significa AUSENTE. Tratar `"False"` também como ausente
     * apagava todo argumento presente — a chamada voltava `gb_move(gb, hub)`
     * sem distância. E usar `!campo.ausente` era pior: a string "False" é
     * truthy, então nenhum campo presente passaria.
     *
     * O teste é o valor, nunca o complemento.
     */
    if (campo.ausente === true || campo.ausente === "True") continue;

    const texto = textoDoCampoParaPython(campo, semantico);
    if (texto === null) continue;

    /*
     * `velocidade=300` tem que voltar `velocidade=300`. Sem o `forma`, o
     * bloco escrevia `300` posicional e o arquivo mudava de forma — mesmo
     * chamando a mesma função com os mesmos valores.
     */
    if (campo.forma === "keyword") {
      partes.push(`${identifier(nomeCampo, "valor")}=${texto}`);
    } else {
      partes.push(texto);
    }
  }

  return `${nome}(${partes.join(", ")})`;
}

/**
 * O texto Python de um campo visível.
 *
 * `null` significa "não dá para escrever" — campo vazio que a assinatura
 * exige. Aí ele simplesmente não é gerado, e a interface sinaliza em vez
 * de produzir `mover(, 100)`.
 */
function textoDoCampoParaPython(campo, semantico) {
  const bruto = campo.value;

  /* ---- Expressão/variável: é o texto que já está lá ---- */
  if (campo.type === "direction") {
    const ehNumero = String(bruto ?? "").trim() !== "" && Number.isFinite(Number(bruto));
    if (!ehNumero) {
      // Sem número não há sinal a aplicar: a expressão segue inteira.
      return bruto === "" || bruto === undefined ? null : String(bruto);
    }
    // `sign` também vira texto no caminho dos sockets.
    const sinal = campo.sign === -1 || campo.sign === "-1" ? -1 : 1;
    const modulo = Math.abs(Number(bruto));
    return String(sinal * modulo);
  }

  if (campo.type === "unit") {
    const texto = valorComUnidade(campo, semantico);
    if (texto === null) return null;
    return texto;
  }

  if (campo.type === "select" || campo.type === "enum") {
    if (bruto === "" || bruto === undefined) return null;

    /*
     * O valor do enum já é o texto do ARGUMENTO, e a opção de um
     * `Literal["azul"]` é a PALAVRA, não a string Python.
     *
     * Comentar por cima (`// azul`) seria o comportamento do Pybricks, mas
     * aí `Literal` deixaria de ser round-trip fiel, e quem escreve a
     * biblioteca pode usar os dois. O que não pode acontecer é
     * `JSON.stringify` num valor que JÁ tem aspas: `"azul"` virava
     * `"\"azul\""`, que é uma string com aspas dentro e muda o programa.
     */
    const texto = String(bruto);
    return /^["'].*["']$/.test(texto) ? texto : JSON.stringify(texto);
  }

  if (campo.type === "boolean") {
    return bruto ? "True" : "False";
  }

  if (bruto === "" || bruto === undefined) return null;
  return String(bruto);
}

/**
 * Valor de um campo com unidade, já convertido para a unidade da FUNÇÃO.
 *
 * A conversão só acontece quando os dois lados são da mesma grandeza. Se
 * não forem, o número vai cru — sinalizado pelo bloco — em vez de virar um
 * valor inventado.
 */
function valorComUnidade(campo, semantico) {
  const texto = String(campo.value ?? "").trim();
  if (texto === "") return null;

  const unidadeFuncao = semantico?.unidades?.[campo.name] ?? null;
  const unidadeVisivel = campo.unitKey ?? null;

  if (!unidadeFuncao || !unidadeVisivel || unidadeVisivel === unidadeFuncao) {
    return texto;
  }

  const convertido = converterUnidade(texto, unidadeVisivel, unidadeFuncao);
  if (convertido === null) return texto;
  return String(convertido);
}

/* ------------------------------------------------------------------ */
/* Documentação de cada bloco (pt-BR)                                  */
/* ------------------------------------------------------------------ */
/**
 * Todo bloco tem ajuda em português. Onde não há texto escrito à mão, o
 * catálogo monta uma frase a partir do próprio template — assim o tooltip
 * NUNCA mostra "undefined" (o que acontecia antes).
 */
const BLOCK_DOCS = {
  event_program_start: "O ponto de partida do programa. Os blocos que vêm abaixo dele são executados nesta ordem.",
  event_message_received: "Espera até chegar uma mensagem com esse nome pelos outros programas do robô.",
  event_broadcast: "Manda uma mensagem para os outros programas que estão esperando por ela.",
  event_broadcast_wait: "Manda a mensagem e espera 100 ms, dando tempo de o outro programa receber.",
  event_when_color: "Fica esperando até o sensor de cor enxergar a cor escolhida.",
  event_when_distance: "Fica esperando até a distância medida chegar no valor escolhido.",
  event_when_force: "Fica esperando até alguém pressionar o sensor de força.",
  event_when_tilted: "Fica esperando até o HUB ficar inclinado para o lado escolhido.",
  event_when_heading: "Fica esperando até a bússola girar o ângulo escolhido.",
  event_when_button: "Fica esperando até o botão escolhido do HUB ser apertado.",
  event_when_timer: "Fica esperando até o cronômetro passar do tempo escolhido.",
  motor_setup: "Liga um motor a uma porta do HUB e escolhe qual sentido é o positivo.",
  motor_run_angle: "Gira o motor por uma quantidade de voltas, graus ou segundos.",
  motor_run_target: "Leva o motor até uma posição conhecida (0 graus é onde ele estava quando ligou).",
  motor_run_time: "Liga o motor por um tempo e desliga sozinho.",
  motor_run: "Liga o motor em uma velocidade e deixa girando até você parar.",
  motor_stop: "Para o motor: livre, freando ou segurando a posição.",
  motor_speed_set: "Define a velocidade padrão do motor em porcentagem.",
  motor_dc: "Define a potência do motor em porcentagem (força bruta, sem controle de posição).",
  motor_position: "Lê o ângulo atual do motor em graus.",
  motor_speed: "Lê a velocidade atual do motor em graus por segundo.",
  motor_stalled: "Responde sim ou não: o motor travou porque encontrou resistência?",
  motor_reset_angle: "Faz a posição atual do motor virar o zero.",
  motor_pid: "Ajusta o controle do motor: kp (reação), ki (correção do erro acumulado) e kd (freio).",
  motor_acceleration: "Define o quanto o motor acelera e freia, em graus por segundo ao quadrado.",
  movement_straight: "Faz o robô andar em linha reta. Você pode escolher a medida: voltas, centímetros ou milímetros.",
  movement_turn: "Faz o robô girar no próprio lugar, para a esquerda ou para a direita.",
  movement_curve: "Faz o robô andar numa curva com o raio e o ângulo escolhidos.",
  movement_drive: "Faz o robô andar continuamente, com uma curva opcional.",
  movement_stop: "Para o robô imediatamente.",
  movement_speed: "Define a velocidade padrão de deslocamento em porcentagem.",
  movement_turn_rate: "Define a velocidade de giro em graus por segundo.",
  movement_steer_target: "Anda com o robô virado para um ângulo (precisão de linha).",
  movement_distance: "Lê quantos milímetros o robô andou desde o último zero.",
  movement_angle: "Lê quantos graus o robô girou desde o último zero.",
  movement_reset: "Zera a distância e o ângulo do robô.",
  movement_stalled: "Responde sim ou não: o robô parou de andar porque travou?",
  control_wait: "Espera um tempo antes de executar o próximo bloco.",
  control_repeat: "Repete os blocos dentro dele um número de vezes.",
  control_forever: "Repete os blocos dentro dele para sempre.",
  control_if: "Executa os blocos dentro dele só quando a condição for verdadeira.",
  control_if_else: "Escolhe entre dois caminhos: um quando a condição é verdadeira, outro quando é falsa.",
  control_repeat_until: "Repete os blocos até a condição virar verdadeira.",
  control_wait_until: "Fica parado esperando a condição virar verdadeira.",
  control_stop_all: "Encerra o programa do robô.",
  control_break: "Sai do laço que está em volta.",
  control_for_range: "Repete os blocos contando de um número até outro.",
  control_while: "Repete os blocos enquanto a condição for verdadeira.",
  control_multitask: "Faz vários programs ao mesmo tempo, cada um rodando em uma tarefa.",
  sensor_setup_color: "Liga o sensor de cor numa porta do HUB.",
  sensor_setup_distance: "Liga o sensor de distância numa porta do HUB.",
  sensor_setup_force: "Liga o sensor de força numa porta do HUB.",
  sensor_color_is: "Responde sim ou não: a cor lida é a escolhida?",
  sensor_color: "Lê o nome da cor que o sensor está enxergando.",
  sensor_reflection: "Lê a intensidade da luz que está voltando do objeto.",
  sensor_distance_compare: "Responde sim ou não: o objeto está mais perto ou mais longe que a distância escolhida?",
  sensor_distance_cm: "Lê a distância do sensor em centímetros.",
  sensor_distance_mm: "Lê a distância do sensor em milímetros.",
  sensor_force: "Lê a força que está sendo aplicada no sensor de força, em newtons.",
  sensor_pressed: "Responde sim ou não: o sensor de força está apertado?",
  sensor_tilt_is: "Responde sim ou não: o HUB está inclinado para o lado escolhido?",
  sensor_heading: "Lê a direção para a frente do HUB em graus.",
  sensor_reset_heading: "Faz a direção atual do HUB virar o zero.",
  sensor_button_pressed: "Responde sim ou não: o botão escolhido está apertado?",
  sensor_timer: "Lê quantos segundos passaram no cronômetro.",
  sensor_timer_reset: "Zera o cronômetro.",
  sensor_acceleration: "Lê a aceleração no eixo escolhido.",
  sensor_angular_velocity: "Lê a velocidade de rotação no eixo escolhido.",
  sensor_battery: "Lê a tensão da bateria do HUB.",
  op_math: "Faz uma conta e usa o resultado.",
  op_random: "Sorteia um número dentro do intervalo escolhido.",
  op_compare: "Compara dois valores e responde sim ou não.",
  op_and: "Só é verdadeiro quando as duas condições são verdadeiras.",
  op_or: "É verdadeiro quando pelo menos uma das condições é verdadeira.",
  op_not: "Inverte o valor lógico.",
  op_join: "Junta dois textos em um só.",
  op_letter: "Pega uma letra do texto. A posição 1 é a primeira letra.",
  op_length: "Conta quantos caracteres o texto tem.",
  op_contains: "Responde sim ou não: o texto contém aquele trecho?",
  op_mod: "Devolve o resto da divisão.",
  op_round: "Arredonda o número para o inteiro mais próximo.",
  op_abs: "Devolve o número sem o sinal: o valor absoluto.",
  op_min: "Devolve o menor dos dois números.",
  op_max: "Devolve o maior dos dois números.",
  var_set: "Cria uma variável ou muda o valor dela.",
  var_change: "Soma um valor a uma variável já existente.",
  var_report: "Usa o valor da variável em contas e comparações.",
  var_show: "Escreve o valor da variável no terminal do HUB.",
  var_hide: "Marca no código que a variável não será mostrada.",
  hub_setup: "Cria o HUB. É o primeiro bloco de qualquer programa Pybricks.",
  hub_timer_setup: "Cria o cronômetro usado pelos blocos de tempo.",
  hub_shutdown: "Desliga o HUB.",
  hub_print: "Escreve um texto no terminal do HUB.",
  sound_beep: "Toca um bipe pela quantidade de segundos escolhida.",
  sound_beep_start: "Começa um bipe e deixa tocando.",
  sound_notes: "Toca uma sequência de notas e espera terminar.",
  sound_notes_start: "Começa a tocar as notas e segue executando o programa.",
  sound_stop: "Para todos os sons.",
  sound_volume: "Define o volume de 0 a 100.",
  sound_volume_change: "Soma ou tira volume, sem passar de 0 nem de 100.",
  sound_volume_read: "Lê o volume atual.",
  sound_note: "Toca uma nota musical por uma quantidade de batidas.",
  sound_rest: "Fica em silêncio por uma quantidade de batidas.",
  light_icon: "Acende um desenho na tela do HUB.",
  light_icon_timed: "Acende um desenho por um tempo e desliga.",
  light_char: "Escreve um caractere na tela do HUB.",
  light_text: "Escreve um texto correndo na tela do HUB.",
  light_number: "Mostra um número na tela do HUB.",
  light_off: "Apaga a matriz de luz do HUB.",
  light_pixel: "Acende um ponto exato da matriz. Linha e coluna vão de 1 a 5.",
  light_center: "Acende a luz colorida no centro do botão do HUB.",
  light_center_off: "Apaga a luz colorida do HUB.",
  light_orientation: "Gira a tela do HUB em um ângulo.",
  light_sensor_lights: "Acende a luz do sensor por um tempo e apaga.",
};

/** Ajuda de um bloco, nunca vazia. */
export function blockDoc(spec) {
  if (spec?.doc) return spec.doc;
  const explicit = BLOCK_DOCS[spec?.id];
  if (explicit) return explicit;
  const category = CATEGORY_COLOR[spec?.category] ? spec.category : spec?.category;
  const template = String(spec?.template ?? "").replace(/\{(\w+)\}/g, "…");
  return `Bloco de ${category}. Insere: ${template}.`;
}

/* ------------------------------------------------------------------ */
/* Índices                                                             */
/* ------------------------------------------------------------------ */

export const BLOCK_BY_ID = new Map(BLOCK_CATALOG.map((block) => [block.id, block]));

export function blocksByCategory(category) {
  return BLOCK_CATALOG.filter((block) => block.category === category && !block.hidden);
}

/** Todas as categorias do catálogo que têm ao menos um bloco visível. */
export function catalogCategories() {
  return [...new Set(BLOCK_CATALOG.filter((block) => !block.hidden).map((block) => block.category))];
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

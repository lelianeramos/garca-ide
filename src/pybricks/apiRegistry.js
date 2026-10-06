/**
 * Registry da API Pybricks — GARÇA DE BOTAS CODE STUDIO
 * ------------------------------------------------------
 * Array único com TODAS as funções/métodos/propriedades/constantes do Pybricks.
 *
 * Este arquivo é a fonte de verdade para:
 *   1. Autocomplete do editor Python (Parte 15.3)
 *   2. Construção automática de blocos a partir de chamadas detectadas (Parte 10.5)
 *   3. Validação/correção conservadora de nomes (Parte 16 — cutoff >= 0.84)
 *   4. Tipo de controle de cada parâmetro (Parte 13.1)
 *   5. Documentação ao passar o mouse
 *   6. Verificação de parâmetros antes de executar (Parte 18.6)
 *
 * REGRA R02: o corretor nunca altera nomes de funções criadas pelo usuário.
 * REGRA 3.2: adicionar um comando novo = adicionar uma entrada aqui.
 *            NUNCA reescrever o renderizador.
 */

/* ------------------------------------------------------------------ */
/* Tipos de parâmetro -> controle de UI (Parte 13.1)                   */
/* ------------------------------------------------------------------ */

export const PORTS = ["A", "B", "C", "D", "E", "F"];

export const ENUMS = {
  /*
   * `Port` estava AUSENTE desta lista, e `enumValue(node, "Port")` conferia
   * `ENUMS["Port"]?.includes(...)` — ou seja, sempre `undefined`, sempre
   * `null`. Resultado: TODO motor colado no arquivo caía no `"A"` de
   * reserva, e `esq = Motor(Port.B)` virava "motor na porta A". Somado ao
   * nome fixo no `py()`, dava a duplicata exata que a criança relatava.
   *
   * A lista tem que conter as portas reais do SPIKE Prime, porque é contra
   * elas que o arquivo é conferido.
   */
  Port: ["A", "B", "C", "D", "E", "F"],
  Direction: ["CLOCKWISE", "COUNTERCLOCKWISE"],
  Stop: ["COAST", "BRAKE", "HOLD", "NONE"],
  Color: [
    "RED", "ORANGE", "YELLOW", "GREEN", "CYAN", "BLUE",
    "VIOLET", "MAGENTA", "WHITE", "GRAY", "BLACK", "NONE",
  ],
  Button: [
    "LEFT", "RIGHT", "CENTER", "BLUETOOTH", "BEACON",
    "PLUS", "MINUS", "RED",
    "LEFT_PLUS", "LEFT_MINUS", "RIGHT_PLUS", "RIGHT_MINUS",
  ],
  Side: ["TOP", "BOTTOM", "LEFT", "RIGHT", "FRONT", "BACK"],
  Axis: ["X", "Y", "Z", "-X", "-Y", "-Z"],
  Icon: [
    "ARROW_UP", "ARROW_DOWN", "ARROW_LEFT", "ARROW_RIGHT",
    "CIRCLE", "DIAMOND", "SQUARE", "HAPPY", "SAD", "HEART",
    "NO", "TRIANGLE_UP", "TRIANGLE_DOWN", "TRIANGLE_LEFT",
    "TRIANGLE_RIGHT", "CHECKMARK", "X", "PAUSE", "SLEEP",
    "ARROW_NW", "ARROW_NE", "ARROW_SW", "ARROW_SE",
    "TRUE", "FALSE", "CLOCKWISE", "COUNTERCLOCKWISE",
    "HALF_MOLEY", "FULL_MOLEY", "EYE_LEFT", "EYE_RIGHT",
    "EYES_LEFT", "EYES_RIGHT", "TARGET", "PINWHEEL",
  ],
};

/* ------------------------------------------------------------------ */
/* Rótulos em pt-BR (mesma nomenclatura do SPIKE Education)            */
/* ------------------------------------------------------------------ */

export const PT = {
  Direction: { CLOCKWISE: "↻ Horário", COUNTERCLOCKWISE: "↺ Anti-horário" },
  Stop: { COAST: "livre", BRAKE: "frear", HOLD: "manter", NONE: "nenhum" },
  Color: {
    RED: "vermelho", ORANGE: "laranja", YELLOW: "amarelo", GREEN: "verde",
    CYAN: "ciano", BLUE: "azul", VIOLET: "violeta", MAGENTA: "magenta",
    WHITE: "branco", GRAY: "cinza", BLACK: "preto", NONE: "nenhuma",
  },
  Button: {
    LEFT: "esquerdo", RIGHT: "direito", CENTER: "central",
    BLUETOOTH: "Bluetooth", BEACON: "beacon", PLUS: "+", MINUS: "−", RED: "vermelho",
  },
  Side: {
    TOP: "cima", BOTTOM: "baixo", LEFT: "esquerda",
    RIGHT: "direita", FRONT: "frente", BACK: "trás",
  },
};

/* ------------------------------------------------------------------ */
/* Helper de construção de parâmetros                                  */
/* ------------------------------------------------------------------ */

const num = (def, unit, min, max, extra = {}) => ({
  type: "number", default: def, ...(unit ? { unit } : {}),
  ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
  ...extra,
});

const enm = (kind, def, extra = {}) => ({
  type: "enum", enum: kind, options: ENUMS[kind].map((v) => `${kind}.${v}`),
  default: def ?? `${kind}.${ENUMS[kind][0]}`, ...extra,
});

const port = (def = "A") => ({ type: "port", options: PORTS, default: def });
const bool = (def = true, extra = {}) => ({ type: "boolean", default: def, ...extra });
const str = (def = "", extra = {}) => ({ type: "text", default: def, ...extra });
const variable = (def = "", extra = {}) => ({ type: "variable", default: def, ...extra });
const expr = (def = "", extra = {}) => ({ type: "expression", default: def, ...extra });

/* ------------------------------------------------------------------ */
/* CATEGORIAS — mesmas do LEGO Education SPIKE (Parte 11 / 20.3)       */
/* ------------------------------------------------------------------ */

export const CATEGORIES = [
  { id: "events",     name: "Eventos",      color: "#FFBE0B", icon: "flag" },
  { id: "movement",   name: "Movimento",    color: "#F72EA8", icon: "move" },
  { id: "motors",     name: "Motores",      color: "#078BFF", icon: "motor" },
  { id: "sound",      name: "Som",          color: "#B752F4", icon: "sound" },
  { id: "light",      name: "Luz",          color: "#984BF4", icon: "light" },
  { id: "control",    name: "Controle",     color: "#FF9914", icon: "control" },
  { id: "sensors",    name: "Sensores",     color: "#15C3DF", icon: "sensor" },
  { id: "operators",  name: "Operadores",   color: "#0ACB72", icon: "operators" },
  { id: "variables",  name: "Variáveis",    color: "#F730AB", icon: "variables" },
  { id: "lists",      name: "Listas",       color: "#8E7CFF", icon: "list" },
  { id: "myblocks",   name: "Meus blocos",  color: "#FF506B", icon: "myblocks" },
  { id: "hub",        name: "HUB",          color: "#3D7EFF", icon: "hub" },
  /*
    AVANÇADO — último da lista, de propósito.

    São os blocos genéricos (chamar função, operador, atributo,
    subscrito, condicional). Eles existem para que virtually nenhum
    código fique "somente Python", mas NÃO devem ser a primeira coisa
    que a criança vê: a decisão de produto foi escondê-los numa categoria
    recolhida no fim, e mostrá-los automaticamente quando o programa real
    precisar.
  */
  { id: "advanced",   name: "Avançado",     color: "#7C8FA5", icon: "advanced" },
];

/**
 * Categorias que são geradas a partir do PROJETO (funções Python do time).
 *
 * Decisão de produto (pedido explícito do usuário): NÃO existem botões fixos
 * tipo "Gyro Move". Se a equipe escreve `def gyro_move(...)` em
 * `movimento.py`, a função vira bloco sozinha. Python já resolve o resto:
 * `from movimento import gyro_move` é import normal.
 *
 * "Bibliotecas" = funções de OUTROS arquivos do projeto (módulos da equipe).
 * "Meus blocos" = funções do arquivo que está aberto + blocos personalizados.
 */
export const PROJECT_CATEGORIES = [
  { id: "libraries", name: "Funções do projeto", color: "#00C2A8", icon: "module" },
];

export const CATEGORY_COLOR = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.color]));

/* ------------------------------------------------------------------ */
/* Nomes de função em português (SÓ A INTERFACE)                       */
/* ------------------------------------------------------------------ */
/**
 * Tradução de NENHUMA regra interna: o Python continua usando o nome técnico
 * real. `gyro_turn(90)` vira "Girar com giroscópio" na tela e continua
 * `gyro_turn(90)` no editor.
 *
 *   Visual : Girar com giroscópio 90°
 *   Python : gyro_turn(90)
 */
export const PT_FUNCTIONS = {
  gyro_move: "Mover com giroscópio",
  gyro_turn: "Girar com giroscópio",
  gyro_curve: "Fazer curva com giroscópio",
  smooth_step: "Mover suave",
  smooth_turn: "Girar suave",
  wait: "Esperar",
  run_motor: "Mover motor",
  stop_motor: "Parar motor",
  line_follow: "Seguir linha",
  drive_distance: "Andar uma distância",
  turn_angle: "Girar um ângulo",
  grab: "Pegar objeto",
  release: "Soltar objeto",
  attach: "Engatar anexo",
  detach: "Destravar anexo",
  calibrate: "Calibrar",
  reset_gyro: "Zerar giroscópio",
  color_at: "Ler cor",
  distance_at: "Ler distância",
  clamp: "Limitar valor",
  wrap_angle: "Ajustar ângulo",
};

/** Palavras comuns de robotic translate_ndas para o rótulo visual. */
const PT_WORDS = {
  move: "Mover", turn: "Girar", curve: "Curva", straight: "Reto", gyro: "giroscópio",
  gyroscope: "giroscópio", distance: "distância", speed: "velocidade", angle: "ângulo",
  wheel: "roda", wheels: "rodas", motor: "motor", motors: "motores", line: "linha",
  follow: "seguir", wait: "Esperar", color: "cor", sensor: "sensor", grab: "pegar",
  release: "soltar", attach: "engatar", detach: "destravar", calibration: "calibração",
  calibrate: "calibrar", smooth: "suave", step: "passo", setup: "configurar",
  init: "iniciar", reset: "zerar", stop: "parar", start: "iniciar", run: "executar",
  drive: "andar", base: "base", drivebase: "base", arm: "braço", gripper: "garra",
  lift: "elevador", lift_arm: "elevador", follow_line: "seguir linha", ball: "bola",
  track: "trilho", color_sensor: "sensor de cor", distance_sensor: "sensor de distância",
};

/**
 * Rótulo visual em pt-BR de uma função Python.
 * Conhecidas usam o dicionário; desconhecidas viram "Palavra Palavra"
 * mantendo o nome real em tooltips e no código.
 */
export function ptFunctionLabel(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  if (PT_FUNCTIONS[raw]) return PT_FUNCTIONS[raw];
  const words = raw.replace(/[_\-.]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 1 && /^[A-Z]/.test(raw)) return raw; // classe: mantém o nome técnico
  const translated = words.map((word, index) => {
    if (PT_FUNCTIONS[word]) return PT_FUNCTIONS[word];
    if (PT_WORDS[word]) return PT_WORDS[word];
    if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  });
  return translated.join(" ");
}

/* ------------------------------------------------------------------ */
/* PYBRICKS_API — o array completo                                     */
/* ------------------------------------------------------------------ */

/**
 * Cada entrada:
 *   name       nome canônico ("Motor.run_angle")
 *   module     módulo Python de origem
 *   category   categoria de bloco
 *   kind       constructor | method | property | function | constant | module
 *   shape      stack | reporter | boolean | hat | c-block | cap
 *   doc        documentação curta em pt-BR
 *   params     parâmetros ordenados, com tipo/padrão/faixa
 *   returns    tipo de retorno
 *   python     gerador (params) => "linha python"
 *   signature  assinatura exibida no autocomplete
 */
export const PYBRICKS_API = [
  /* ==================== pybricks.hubs ==================== */
  {
    name: "PrimeHub", module: "pybricks.hubs", category: "hub", kind: "constructor", shape: "stack",
    doc: "Cria o HUB do SPIKE Prime. É o ponto de partida de todo programa.",
    signature: "PrimeHub(top_side=Axis.Z, front_side=Axis.X)",
    params: {
      top_side: { ...enm("Axis", "Axis.Z"), optional: true },
      front_side: { ...enm("Axis", "Axis.X"), optional: true },
    },
    returns: "PrimeHub",
  },
  {
    name: "InventorHub", module: "pybricks.hubs", category: "hub", kind: "constructor", shape: "stack",
    doc: "Cria o HUB do SPIKE Essential / Inventor.",
    signature: "InventorHub(top_side=Axis.Z, front_side=Axis.X)", params: {}, returns: "InventorHub",
  },
  {
    name: "TechnicHub", module: "pybricks.hubs", category: "hub", kind: "constructor", shape: "stack",
    doc: "Cria o HUB Technic (Control+).", signature: "TechnicHub()", params: {}, returns: "TechnicHub",
  },
  {
    name: "CityHub", module: "pybricks.hubs", category: "hub", kind: "constructor", shape: "stack",
    doc: "Cria o HUB City (Boost).", signature: "CityHub()", params: {}, returns: "CityHub",
  },
  {
    name: "MoveHub", module: "pybricks.hubs", category: "hub", kind: "constructor", shape: "stack",
    doc: "Cria o HUB Boost Move.", signature: "MoveHub()", params: {}, returns: "MoveHub",
  },
  {
    name: "EssentialHub", module: "pybricks.hubs", category: "hub", kind: "constructor", shape: "stack",
    doc: "Cria o HUB Essential.", signature: "EssentialHub()", params: {}, returns: "EssentialHub",
  },

  /* ---- hub.display ---- */
  {
    name: "hub.display.on", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Liga a matriz de luzes 5×5 com uma imagem.",
    signature: "display.on(image)", params: { image: expr("Icon.HEART") }, returns: "None",
  },
  {
    name: "hub.display.off", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Desliga a matriz de luzes.", signature: "display.off()", params: {}, returns: "None",
  },
  {
    name: "hub.display.icon", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Mostra um ícone pronto na matriz 5×5.",
    signature: "display.icon(icon)", params: { icon: enm("Icon", "Icon.HEART") }, returns: "None",
  },
  {
    name: "hub.display.char", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Mostra uma letra na matriz 5×5.",
    signature: "display.char(character)", params: { character: str("A") }, returns: "None",
  },
  {
    name: "hub.display.text", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Escreve um texto rolando na matriz 5×5.",
    signature: "display.text(text, on=100, off=100)", params: { text: str("OLA") }, returns: "None",
  },
  {
    name: "hub.display.number", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Mostra um número na matriz 5×5.",
    signature: "display.number(number, on=100, off=100)", params: { number: num(5) }, returns: "None",
  },
  {
    name: "hub.display.pixel", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Acende um único píxel (linha, coluna, brilho %).",
    signature: "display.pixel(row, column, brightness=100)",
    params: {
      row: num(0, "", 0, 4), column: num(0, "", 0, 4),
      brightness: num(100, "%", 0, 100),
    },
    returns: "None",
  },
  {
    name: "hub.display.orientation", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Define a orientação da imagem na matriz.",
    signature: "display.orientation(angle)", params: { angle: num(0, "graus") }, returns: "None",
  },
  {
    name: "hub.display.up", module: "pybricks.hubs", category: "light", kind: "method", shape: "reporter",
    doc: "Lê o lado do HUB que está para cima.", signature: "display.up()", params: {}, returns: "Side",
  },

  /* ---- hub.light ---- */
  {
    name: "hub.light.on", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Acende a luz central do HUB com uma cor.",
    signature: "light.on(color)", params: { color: enm("Color", "Color.GREEN") }, returns: "None",
  },
  {
    name: "hub.light.off", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Apaga a luz central do HUB.", signature: "light.off()", params: {}, returns: "None",
  },
  {
    name: "hub.light.blink", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Pisca a luz central.",
    signature: "light.blink(color, pattern)", params: { color: enm("Color", "Color.GREEN"), pattern: expr("[300, 200]") }, returns: "None",
  },
  {
    name: "hub.light.animate", module: "pybricks.hubs", category: "light", kind: "method", shape: "stack",
    doc: "Faz uma animação de cores na luz central.",
    signature: "light.animate(colors, duration=500)", params: { colors: expr("[Color.RED, Color.GREEN]"), duration: num(500, "ms") }, returns: "None",
  },

  /* ---- hub.speaker ---- */
  {
    name: "hub.speaker.beep", module: "pybricks.hubs", category: "sound", kind: "method", shape: "stack",
    doc: "Toca um bipe em uma frequência (Hz) por uma duração (ms).",
    signature: "speaker.beep(frequency=500, duration=100)",
    params: {
      frequency: num(500, "Hz", 64, 24000),
      duration: num(100, "ms", -1, 60000),
    },
    returns: "None",
  },
  {
    name: "hub.speaker.play_notes", module: "pybricks.hubs", category: "sound", kind: "method", shape: "stack",
    doc: "Toca uma sequência de notas musicais.",
    signature: "speaker.play_notes(notes, wait=True)",
    params: { notes: expr('["C4/4", "D4/4"]'), wait: { ...bool(true), optional: true } },
    returns: "None",
  },
  {
    name: "hub.speaker.play_file", module: "pybricks.hubs", category: "sound", kind: "method", shape: "stack",
    doc: "Toca um arquivo de som salvo no HUB.",
    signature: "speaker.play_file(file_name, wait=True)", params: { file_name: str("cat.wav"), wait: { ...bool(true), optional: true } }, returns: "None",
  },
  {
    name: "hub.speaker.set_volume", module: "pybricks.hubs", category: "sound", kind: "method", shape: "stack",
    doc: "Define o volume do alto-falante em %.",
    signature: "speaker.set_volume(volume)", params: { volume: num(75, "%", 0, 100) }, returns: "None",
  },
  {
    name: "hub.speaker.volume", module: "pybricks.hubs", category: "sound", kind: "method", shape: "reporter",
    doc: "Lê o volume atual do alto-falante.", signature: "speaker.volume()", params: {}, returns: "int",
  },
  {
    name: "hub.speaker.stop", module: "pybricks.hubs", category: "sound", kind: "method", shape: "stack",
    doc: "Interrompe todos os sons em reprodução.", signature: "speaker.stop()", params: {}, returns: "None",
  },

  /* ---- hub.imu ---- */
  {
    name: "hub.imu.heading", module: "pybricks.hubs", category: "sensors", kind: "method", shape: "reporter",
    doc: "Ângulo de guinada (0 a 360 graus) medido pelo giroscópio.",
    signature: "imu.heading()", params: {}, returns: "float",
  },
  {
    name: "hub.imu.reset_heading", module: "pybricks.hubs", category: "sensors", kind: "method", shape: "stack",
    doc: "Zera o ângulo de guinada para um valor.",
    signature: "imu.reset_heading(angle=0)", params: { angle: num(0, "graus") }, returns: "None",
  },
  {
    name: "hub.imu.tilt", module: "pybricks.hubs", category: "sensors", kind: "method", shape: "reporter",
    doc: "Ângulos de inclinação (pitch, roll) do HUB.",
    signature: "imu.tilt()", params: {}, returns: "tuple",
  },
  {
    name: "hub.imu.up", module: "pybricks.hubs", category: "sensors", kind: "method", shape: "reporter",
    doc: "Qual lado do HUB está apontando para cima.",
    signature: "imu.up()", params: {}, returns: "Side",
  },
  {
    name: "hub.imu.acceleration", module: "pybricks.hubs", category: "sensors", kind: "method", shape: "reporter",
    doc: "Aceleração linear nos três eixos (mm/s²).",
    signature: "imu.acceleration()", params: {}, returns: "tuple",
  },
  {
    name: "hub.imu.angular_velocity", module: "pybricks.hubs", category: "sensors", kind: "method", shape: "reporter",
    doc: "Velocidade angular nos três eixos (graus/s).",
    signature: "imu.angular_velocity()", params: {}, returns: "tuple",
  },
  {
    name: "hub.imu.ready", module: "pybricks.hubs", category: "sensors", kind: "method", shape: "boolean",
    doc: "Indica se o sensor inercial já terminou a calibração.",
    signature: "imu.ready()", params: {}, returns: "bool",
  },

  /* ---- hub.battery / buttons / ble / system ---- */
  {
    name: "hub.battery.voltage", module: "pybricks.hubs", category: "hub", kind: "method", shape: "reporter",
    doc: "Tensão atual da bateria em mV.", signature: "battery.voltage()", params: {}, returns: "int",
  },
  {
    name: "hub.battery.current", module: "pybricks.hubs", category: "hub", kind: "method", shape: "reporter",
    doc: "Corrente atual em mA.", signature: "battery.current()", params: {}, returns: "int",
  },
  {
    name: "hub.buttons.pressed", module: "pybricks.hubs", category: "events", kind: "method", shape: "boolean",
    doc: "Verifica se um botão está pressionado agora.",
    signature: "buttons.pressed(button)", params: { button: enm("Button", "Button.LEFT") }, returns: "bool",
  },
  {
    name: "hub.system.shutdown", module: "pybricks.hubs", category: "control", kind: "method", shape: "cap",
    doc: "Desliga o HUB.", signature: "system.shutdown()", params: {}, returns: "None",
  },
  {
    name: "hub.system.name", module: "pybricks.hubs", category: "hub", kind: "method", shape: "reporter",
    doc: "Nome Bluetooth do HUB.", signature: "system.name()", params: {}, returns: "str",
  },
  {
    name: "hub.ble.broadcast", module: "pybricks.hubs", category: "hub", kind: "method", shape: "stack",
    doc: "Transmite dados por Bluetooth para outros HUBs.",
    signature: "ble.broadcast(data, channel=None)", params: { data: expr('"mensagem1"'), channel: { ...num(0, "", 0, 255), optional: true } }, returns: "None",
  },
  {
    name: "hub.ble.observe", module: "pybricks.hubs", category: "hub", kind: "method", shape: "reporter",
    doc: "Recebe dados transmitidos por outro HUB.",
    signature: "ble.observe(channel)", params: { channel: num(0, "", 0, 255) }, returns: "any",
  },

  /* ==================== pybricks.pupdevices — Motores ==================== */
  {
    name: "Motor", module: "pybricks.pupdevices", category: "motors", kind: "constructor", shape: "stack",
    doc: "Cria um motor conectado a uma porta do HUB.",
    signature: "Motor(port, positive_direction=Direction.CLOCKWISE, gears=None, reset_angle=True)",
    params: {
      port: port("A"),
      positive_direction: { ...enm("Direction", "Direction.CLOCKWISE"), optional: true },
      gears: { ...expr(""), optional: true },
      reset_angle: { ...bool(true), optional: true },
    },
    returns: "Motor",
  },
  {
    name: "Motor.run", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Gira o motor continuamente na velocidade indicada (graus/s).",
    signature: "run(speed)", params: { speed: num(500, "graus/s", -1500, 1500, { control: "slider+input" }) },
    returns: "None",
  },
  {
    name: "Motor.run_time", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Gira o motor por um tempo determinado.",
    signature: "run_time(speed, time, then=Stop.HOLD, wait=True)",
    params: {
      speed: num(500, "graus/s", -1500, 1500),
      time: num(1000, "ms"),
      then: { ...enm("Stop", "Stop.HOLD"), optional: true },
      wait: { ...bool(true), optional: true },
    },
    returns: "None",
  },
  {
    name: "Motor.run_angle", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Gira o motor um número exato de graus. Sinal negativo = anti-horário.",
    signature: "run_angle(speed, rotation_angle, then=Stop.HOLD, wait=True)",
    params: {
      speed: num(500, "graus/s", -1500, 1500),
      rotation_angle: num(360, "graus"),
      then: { ...enm("Stop", "Stop.HOLD"), optional: true },
      wait: { ...bool(true), optional: true },
    },
    returns: "None",
  },
  {
    name: "Motor.run_target", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Gira o motor até uma posição absoluta, pelo caminho mais curto.",
    signature: "run_target(speed, target_angle, then=Stop.HOLD, wait=True)",
    params: {
      speed: num(500, "graus/s", -1500, 1500),
      target_angle: num(0, "graus"),
      then: { ...enm("Stop", "Stop.HOLD"), optional: true },
      wait: { ...bool(true), optional: true },
    },
    returns: "None",
  },
  {
    name: "Motor.run_until_stalled", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Gira até o motor travar (bater em algo). Retorna o ângulo percorrido.",
    signature: "run_until_stalled(speed, then=Stop.COAST, wait=True)",
    params: {
      speed: num(400, "graus/s", -1500, 1500),
      then: { ...enm("Stop", "Stop.COAST"), optional: true },
      wait: { ...bool(true), optional: true },
    },
    returns: "int",
  },
  {
    name: "Motor.track_target", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Persegue um alvo sem travar — ideal para controle contínuo de posição.",
    signature: "track_target(target_angle)", params: { target_angle: num(0, "graus") }, returns: "None",
  },
  {
    name: "Motor.stop", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Para o motor imediatamente, deixando-o livre.",
    signature: "stop()", params: {}, returns: "None",
  },
  {
    name: "Motor.brake", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Para o motor freando (passivo).", signature: "brake()", params: {}, returns: "None",
  },
  {
    name: "Motor.hold", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Para o motor e mantém a posição ativamente.", signature: "hold()", params: {}, returns: "None",
  },
  {
    name: "Motor.dc", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Aplica tensão direta em % — controle cru de potência.",
    signature: "dc(duty)", params: { duty: num(50, "%", -100, 100) }, returns: "None",
  },
  {
    name: "Motor.angle", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "reporter",
    doc: "Posição acumulada do motor em graus.", signature: "angle()", params: {}, returns: "int",
  },
  {
    name: "Motor.speed", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "reporter",
    doc: "Velocidade atual do motor em graus/s.", signature: "speed()", params: {}, returns: "int",
  },
  {
    name: "Motor.load", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "reporter",
    doc: "Torque estimado que o motor está fazendo agora.", signature: "load()", params: {}, returns: "int",
  },
  {
    name: "Motor.stalled", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "boolean",
    doc: "Indica se o motor travou.", signature: "stalled()", params: {}, returns: "bool",
  },
  {
    name: "Motor.done", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "boolean",
    doc: "Indica se o último comando terminou.", signature: "done()", params: {}, returns: "bool",
  },
  {
    name: "Motor.reset_angle", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Redefine a posição zero do motor.",
    signature: "reset_angle(angle=0)", params: { angle: num(0, "graus") }, returns: "None",
  },
  {
    name: "Motor.settings", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack",
    doc: "Configura limites de velocidade, aceleração e PID do motor.",
    signature: "settings(max_velocity=None, acceleration=None, deceleration=None, pid=None, stall_torque=None, stall_current=None)",
    params: {
      max_velocity: { ...num(1000, "graus/s"), optional: true },
      acceleration: { ...num(2000, "graus/s²"), optional: true },
      deceleration: { ...num(2000, "graus/s²"), optional: true },
    },
    returns: "None",
  },
  {
    name: "Motor.control", module: "pybricks.pupdevices", category: "motors", kind: "property", shape: "reporter",
    doc: "Acesso ao controle PID do motor (pid, target_torque, limits).",
    signature: "control", params: {}, returns: "Control",
  },
  { name: "Motor.control.pid", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "reporter", doc: "Lê ou define os ganhos KP, KI, KD do motor.", signature: "control.pid(kp=45, ki=0, kd=0, position_deadband=0, speed_deadband=0)", params: { kp: num(45), ki: num(0), kd: num(0) }, returns: "tuple" },
  { name: "Motor.control.limits", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "reporter", doc: "Limites de velocidade e torque.", signature: "control.limits(speed=1000, acceleration=2000, deceleration=2000, torque=100)", params: { speed: num(1000), torque: num(100, "%", 0, 100) }, returns: "tuple" },

  {
    name: "DCMotor", module: "pybricks.pupdevices", category: "motors", kind: "constructor", shape: "stack",
    doc: "Motor simples sem sensor de posição.",
    signature: "DCMotor(port, positive_direction=Direction.CLOCKWISE)",
    params: { port: port("A"), positive_direction: { ...enm("Direction", "Direction.CLOCKWISE"), optional: true } },
    returns: "DCMotor",
  },
  { name: "DCMotor.dc", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack", doc: "Aplica tensão direta em %.", signature: "dc(duty)", params: { duty: num(50, "%", -100, 100) }, returns: "None" },
  { name: "DCMotor.stop", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack", doc: "Para o motor.", signature: "stop()", params: {}, returns: "None" },
  { name: "DCMotor.brake", module: "pybricks.pupdevices", category: "motors", kind: "method", shape: "stack", doc: "Freia o motor.", signature: "brake()", params: {}, returns: "None" },

  /* ==================== pybricks.pupdevices — Sensores ==================== */
  {
    name: "ColorSensor", module: "pybricks.pupdevices", category: "sensors", kind: "constructor", shape: "stack",
    doc: "Sensor de cor e de luz refletida.",
    signature: "ColorSensor(port, lights=None)", params: { port: port("C") }, returns: "ColorSensor",
  },
  { name: "ColorSensor.color", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Cor detectada pelo sensor.", signature: "color()", params: {}, returns: "Color" },
  { name: "ColorSensor.reflection", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Intensidade da luz refletida (0–100%).", signature: "reflection()", params: {}, returns: "int" },
  { name: "ColorSensor.ambient", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Luz ambiente (0–100%).", signature: "ambient()", params: {}, returns: "int" },
  { name: "ColorSensor.hsv", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Cor no modelo HSV.", signature: "hsv(surface=True)", params: { surface: { ...bool(true), optional: true } }, returns: "Color" },
  { name: "ColorSensor.lights", module: "pybricks.pupdevices", category: "sensors", kind: "property", shape: "reporter", doc: "Três luzes ao redor do sensor.", signature: "lights", params: {}, returns: "ColorLight" },
  { name: "ColorSensor.detectable_colors", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "stack", doc: "Define quais cores o sensor reconhece.", signature: "detectable_colors(colors)", params: { colors: expr("[Color.RED, Color.GREEN]") }, returns: "None" },

  {
    name: "UltrasonicSensor", module: "pybricks.pupdevices", category: "sensors", kind: "constructor", shape: "stack",
    doc: "Sensor de distância por ultrassom.",
    signature: "UltrasonicSensor(port, lights=None)", params: { port: port("D") }, returns: "UltrasonicSensor",
  },
  { name: "UltrasonicSensor.distance", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Distância até o obstáculo em mm.", signature: "distance()", params: {}, returns: "int" },
  { name: "UltrasonicSensor.presence", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "boolean", doc: "Detecta presença de outro ultrassom por perto.", signature: "presence()", params: {}, returns: "bool" },
  { name: "UltrasonicSensor.lights", module: "pybricks.pupdevices", category: "sensors", kind: "property", shape: "reporter", doc: "Quatro luzes do sensor.", signature: "lights", params: {}, returns: "ColorLight" },

  {
    name: "ForceSensor", module: "pybricks.pupdevices", category: "sensors", kind: "constructor", shape: "stack",
    doc: "Sensor de força/pressão.",
    signature: "ForceSensor(port)", params: { port: port("E") }, returns: "ForceSensor",
  },
  { name: "ForceSensor.force", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Força aplicada em newtons.", signature: "force()", params: {}, returns: "float" },
  { name: "ForceSensor.distance", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Deslocamento do botão em mm.", signature: "distance()", params: {}, returns: "float" },
  { name: "ForceSensor.pressed", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "boolean", doc: "Indica se o sensor está pressionado.", signature: "pressed(force=3)", params: { force: { ...num(3, "N"), optional: true } }, returns: "bool" },
  { name: "ForceSensor.touched", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "boolean", doc: "Indica se houve toque leve.", signature: "touched(force=1)", params: { force: { ...num(1, "N"), optional: true } }, returns: "bool" },

  {
    name: "ColorDistanceSensor", module: "pybricks.pupdevices", category: "sensors", kind: "constructor", shape: "stack",
    doc: "Sensor de cor e distância (Boost).",
    signature: "ColorDistanceSensor(port, lights=None)", params: { port: port("C") }, returns: "ColorDistanceSensor",
  },
  { name: "ColorDistanceSensor.color", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Cor detectada.", signature: "color()", params: {}, returns: "Color" },
  { name: "ColorDistanceSensor.distance", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Distância em % (0–100).", signature: "distance()", params: {}, returns: "int" },
  { name: "ColorDistanceSensor.reflection", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Luz refletida.", signature: "reflection()", params: {}, returns: "int" },
  { name: "ColorDistanceSensor.light", module: "pybricks.pupdevices", category: "sensors", kind: "property", shape: "reporter", doc: "Luz do sensor.", signature: "light", params: {}, returns: "Light" },

  {
    name: "TiltSensor", module: "pybricks.pupdevices", category: "sensors", kind: "constructor", shape: "stack",
    doc: "Sensor de inclinação (WeDo).", signature: "TiltSensor(port)", params: { port: port("A") }, returns: "TiltSensor",
  },
  { name: "TiltSensor.tilt", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Ângulos de inclinação (pitch, roll).", signature: "tilt()", params: {}, returns: "tuple" },
  { name: "TiltSensor.up", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Lado voltado para cima.", signature: "up()", params: {}, returns: "Side" },

  {
    name: "InfraredSensor", module: "pybricks.pupdevices", category: "sensors", kind: "constructor", shape: "stack",
    doc: "Sensor infravermelho (Control+).", signature: "InfraredSensor(port, lights=None)", params: { port: port("A") }, returns: "InfraredSensor",
  },
  { name: "InfraredSensor.distance", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Distância relativa (0–100%).", signature: "distance()", params: {}, returns: "int" },
  { name: "InfraredSensor.buttons", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Botões pressionados no controle remoto.", signature: "buttons(channel=1)", params: { channel: num(1, "", 1, 4) }, returns: "list" },
  { name: "InfraredSensor.keypad", module: "pybricks.pupdevices", category: "sensors", kind: "method", shape: "reporter", doc: "Estado bruto do teclado IR.", signature: "keypad()", params: {}, returns: "list" },

  {
    name: "Light", module: "pybricks.pupdevices", category: "light", kind: "constructor", shape: "stack",
    doc: "Luz simples conectada a uma porta.", signature: "Light(port)", params: { port: port("A") }, returns: "Light",
  },
  { name: "Light.on", module: "pybricks.pupdevices", category: "light", kind: "method", shape: "stack", doc: "Acende a luz com brilho em %.", signature: "on(brightness=100)", params: { brightness: num(100, "%", 0, 100) }, returns: "None" },
  { name: "Light.off", module: "pybricks.pupdevices", category: "light", kind: "method", shape: "stack", doc: "Apaga a luz.", signature: "off()", params: {}, returns: "None" },
  { name: "Light.blink", module: "pybricks.pupdevices", category: "light", kind: "method", shape: "stack", doc: "Pisca a luz com um padrão.", signature: "light.blink(pattern=[300, 200])", params: { pattern: expr("[300, 200]") }, returns: "None" },

  {
    name: "ColorLightMatrix", module: "pybricks.pupdevices", category: "light", kind: "constructor", shape: "stack",
    doc: "Matriz 3×3 de luzes coloridas.", signature: "ColorLightMatrix(port)", params: { port: port("A") }, returns: "ColorLightMatrix",
  },
  { name: "ColorLightMatrix.on", module: "pybricks.pupdevices", category: "light", kind: "method", shape: "stack", doc: "Acende todas as luzes com uma cor.", signature: "on(color)", params: { color: enm("Color", "Color.RED") }, returns: "None" },
  { name: "ColorLightMatrix.off", module: "pybricks.pupdevices", category: "light", kind: "method", shape: "stack", doc: "Apaga todas as luzes.", signature: "off()", params: {}, returns: "None" },
  { name: "ColorLightMatrix.pattern", module: "pybricks.pupdevices", category: "light", kind: "method", shape: "stack", doc: "Acende a matriz com um padrão 3×3 de cores.", signature: "pattern(colors)", params: { colors: expr("[Color.RED]*9") }, returns: "None" },

  {
    name: "Remote", module: "pybricks.pupdevices", category: "events", kind: "constructor", shape: "stack",
    doc: "Controle remoto Bluetooth.", signature: "Remote(name=None, timeout=10000)", params: { name: { ...str(""), optional: true }, timeout: { ...num(10000, "ms"), optional: true } }, returns: "Remote",
  },
  { name: "Remote.buttons", module: "pybricks.pupdevices", category: "events", kind: "method", shape: "reporter", doc: "Botões pressionados no controle.", signature: "buttons()", params: {}, returns: "list" },
  { name: "Remote.light", module: "pybricks.pupdevices", category: "events", kind: "property", shape: "reporter", doc: "Luz do controle remoto.", signature: "light", params: {}, returns: "Light" },
  { name: "Remote.name", module: "pybricks.pupdevices", category: "events", kind: "method", shape: "reporter", doc: "Nome do controle.", signature: "name()", params: {}, returns: "str" },

  /* ==================== pybricks.robotics ==================== */
  {
    name: "DriveBase", module: "pybricks.robotics", category: "movement", kind: "constructor", shape: "stack",
    doc: "Base de movimento com dois motores, roda e distância entre eixos.",
    signature: "DriveBase(left_motor, right_motor, wheel_diameter, axle_track)",
    params: {
      left_motor: variable("motor_a"),
      right_motor: variable("motor_b"),
      wheel_diameter: num(56, "mm"),
      axle_track: num(112, "mm"),
    },
    returns: "DriveBase",
  },
  {
    name: "DriveBase.straight", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack",
    doc: "Move o robô em linha reta uma distância em mm (negativo = ré).",
    signature: "straight(distance)", params: { distance: num(1760, "mm") }, returns: "None",
  },
  {
    name: "DriveBase.turn", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack",
    doc: "Gira o robô no próprio eixo (graus; negativo = anti-horário).",
    signature: "turn(angle)", params: { angle: num(90, "graus") }, returns: "None",
  },
  {
    name: "DriveBase.curve", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack",
    doc: "Faz uma curva de raio definido girando um ângulo.",
    signature: "curve(radius, angle)", params: { radius: num(200, "mm"), angle: num(90, "graus") }, returns: "None",
  },
  {
    name: "DriveBase.drive", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack",
    doc: "Inicia movimento contínuo: velocidade (mm/s) e taxa de giro (graus/s).",
    signature: "drive(speed, turn_rate)", params: { speed: num(200, "mm/s"), turn_rate: num(0, "graus/s") }, returns: "None",
  },
  {
    name: "DriveBase.stop", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack",
    doc: "Para o movimento.", signature: "stop()", params: {}, returns: "None",
  },
  {
    name: "DriveBase.distance", module: "pybricks.robotics", category: "movement", kind: "method", shape: "reporter",
    doc: "Distância percorrida desde o último reset (mm).", signature: "distance()", params: {}, returns: "float",
  },
  {
    name: "DriveBase.angle", module: "pybricks.robotics", category: "movement", kind: "method", shape: "reporter",
    doc: "Ângulo girado desde o último reset (graus).", signature: "angle()", params: {}, returns: "float",
  },
  {
    name: "DriveBase.state", module: "pybricks.robotics", category: "movement", kind: "method", shape: "reporter",
    doc: "Distância, velocidade, ângulo e taxa de giro atuais.", signature: "state()", params: {}, returns: "tuple",
  },
  {
    name: "DriveBase.reset", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack",
    doc: "Zera distância e ângulo acumulados.", signature: "reset()", params: {}, returns: "None",
  },
  {
    name: "DriveBase.settings", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack",
    doc: "Configura velocidade, aceleração e taxa de giro do movimento.",
    signature: "settings(straight_speed=None, straight_acceleration=None, turn_rate=None, turn_acceleration=None)",
    params: {
      straight_speed: { ...num(750, "mm/s"), optional: true },
      straight_acceleration: { ...num(1000, "mm/s²"), optional: true },
      turn_rate: { ...num(360, "graus/s"), optional: true },
      turn_acceleration: { ...num(720, "graus/s²"), optional: true },
    },
    returns: "None",
  },
  { name: "DriveBase.done", module: "pybricks.robotics", category: "movement", kind: "method", shape: "boolean", doc: "Indica se o último movimento terminou.", signature: "done()", params: {}, returns: "bool" },
  { name: "DriveBase.stalled", module: "pybricks.robotics", category: "movement", kind: "method", shape: "boolean", doc: "Indica se o movimento travou.", signature: "stalled()", params: {}, returns: "bool" },
  { name: "DriveBase.distance_control", module: "pybricks.robotics", category: "movement", kind: "property", shape: "reporter", doc: "Controle PID da distância (tolerance, pid, limits).", signature: "distance_control", params: {}, returns: "Control" },
  { name: "DriveBase.heading_control", module: "pybricks.robotics", category: "movement", kind: "property", shape: "reporter", doc: "Controle PID da direção (tolerance, pid, limits).", signature: "heading_control", params: {}, returns: "Control" },

  {
    name: "Car", module: "pybricks.robotics", category: "movement", kind: "constructor", shape: "stack",
    doc: "Carro com direção separada do movimento.",
    signature: "Car(steer_motor, drive_motors)", params: { steer_motor: variable("motor_a"), drive_motors: expr("[motor_b, motor_c]") }, returns: "Car",
  },
  { name: "Car.steer", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack", doc: "Define o ângulo da direção.", signature: "steer(angle)", params: { angle: num(0, "graus") }, returns: "None" },
  { name: "Car.drive", module: "pybricks.robotics", category: "movement", kind: "method", shape: "stack", doc: "Move o carro a uma velocidade.", signature: "drive(speed)", params: { speed: num(200, "mm/s") }, returns: "None" },

  /* ==================== pybricks.tools ==================== */
  {
    name: "wait", module: "pybricks.tools", category: "control", kind: "function", shape: "stack",
    doc: "Espera um tempo em milissegundos.",
    signature: "wait(time)", params: { time: num(1000, "ms") }, returns: "None",
  },
  {
    name: "StopWatch", module: "pybricks.tools", category: "control", kind: "constructor", shape: "stack",
    doc: "Cronômetro para medir tempo de execução.", signature: "StopWatch()", params: {}, returns: "StopWatch",
  },
  { name: "StopWatch.time", module: "pybricks.tools", category: "control", kind: "method", shape: "reporter", doc: "Tempo decorrido em ms.", signature: "time()", params: {}, returns: "int" },
  { name: "StopWatch.pause", module: "pybricks.tools", category: "control", kind: "method", shape: "stack", doc: "Pausa o cronômetro.", signature: "pause()", params: {}, returns: "None" },
  { name: "StopWatch.resume", module: "pybricks.tools", category: "control", kind: "method", shape: "stack", doc: "Retoma o cronômetro.", signature: "resume()", params: {}, returns: "None" },
  { name: "StopWatch.reset", module: "pybricks.tools", category: "control", kind: "method", shape: "stack", doc: "Zera o cronômetro.", signature: "reset()", params: {}, returns: "None" },

  {
    name: "multitask", module: "pybricks.tools", category: "control", kind: "function", shape: "stack",
    doc: "Executa várias tarefas ao mesmo tempo (corrotinas).",
    signature: "multitask(*args)", params: { args: expr("tarefa_a(), tarefa_b()") }, returns: "None",
  },
  {
    name: "run_task", module: "pybricks.tools", category: "control", kind: "function", shape: "stack",
    doc: "Executa a tarefa principal e as secundárias do programa.",
    signature: "run_task(main, *others)", params: { main: expr("principal") }, returns: "None",
  },
  {
    name: "Matrix", module: "pybricks.tools", category: "operators", kind: "constructor", shape: "stack",
    doc: "Matriz numérica para imagens e álgebra.",
    signature: "Matrix(data)", params: { data: expr("[[0, 0], [0, 0]]") }, returns: "Matrix",
  },
  { name: "hub_menu", module: "pybricks.tools", category: "control", kind: "function", shape: "reporter", doc: "Mostra um menu no HUB e espera a escolha.", signature: "hub_menu()", params: {}, returns: "str" },
  { name: "read_input_byte", module: "pybricks.tools", category: "control", kind: "function", shape: "reporter", doc: "Lê um byte enviado pelo computador.", signature: "read_input_byte()", params: {}, returns: "int" },
  { name: "AppData", module: "pybricks.tools", category: "variables", kind: "constructor", shape: "stack", doc: "Guarda dados que sobrevivem ao desligar o HUB.", signature: "AppData('nome', padrao)", params: { key: str("pontos"), value: expr("0") }, returns: "AppData" },

  /* ==================== pybricks.iodevices ==================== */
  { name: "PUPDevice", module: "pybricks.iodevices", category: "sensors", kind: "constructor", shape: "stack", doc: "Acesso genérico a um dispositivo Powered Up.", signature: "PUPDevice(port)", params: { port: port("A") }, returns: "PUPDevice" },
  { name: "PUPDevice.read", module: "pybricks.iodevices", category: "sensors", kind: "method", shape: "reporter", doc: "Lê dados brutos de um modo.", signature: "read(mode)", params: { mode: num(0) }, returns: "tuple" },
  { name: "PUPDevice.write", module: "pybricks.iodevices", category: "sensors", kind: "method", shape: "stack", doc: "Escreve dados em um modo.", signature: "write(mode, data)", params: { mode: num(0), data: expr("(0,)") }, returns: "None" },
  { name: "PUPDevice.info", module: "pybricks.iodevices", category: "sensors", kind: "method", shape: "reporter", doc: "Informações técnicas do dispositivo.", signature: "info()", params: {}, returns: "dict" },
  { name: "AnalogSensor", module: "pybricks.iodevices", category: "sensors", kind: "constructor", shape: "stack", doc: "Sensor analógico (tensão/resistência).", signature: "AnalogSensor(port, passive=False)", params: { port: port("A"), passive: { ...bool(false), optional: true } }, returns: "AnalogSensor" },
  { name: "AnalogSensor.voltage", module: "pybricks.iodevices", category: "sensors", kind: "method", shape: "reporter", doc: "Tensão em mV.", signature: "voltage()", params: {}, returns: "float" },
  { name: "AnalogSensor.resistance", module: "pybricks.iodevices", category: "sensors", kind: "method", shape: "reporter", doc: "Resistência em ohms.", signature: "resistance()", params: {}, returns: "float" },
  { name: "I2CDevice", module: "pybricks.iodevices", category: "sensors", kind: "constructor", shape: "stack", doc: "Dispositivo I²C.", signature: "I2CDevice(port, address)", params: { port: port("A"), address: num(1) }, returns: "I2CDevice" },
  { name: "UARTDevice", module: "pybricks.iodevices", category: "sensors", kind: "constructor", shape: "stack", doc: "Dispositivo serial UART.", signature: "UARTDevice(port, baudrate, timeout=2000)", params: { port: port("A"), baudrate: num(9600), timeout: { ...num(2000, "ms"), optional: true } }, returns: "UARTDevice" },
  { name: "LWP3Device", module: "pybricks.iodevices", category: "hub", kind: "constructor", shape: "stack", doc: "Conecta a outro HUB por Bluetooth.", signature: "LWP3Device(hub_kind, name=None, timeout=10000)", params: { hub_kind: num(64), name: { ...str(""), optional: true } }, returns: "LWP3Device" },

  /* ==================== pybricks.messaging ==================== */
  { name: "mailbox.send", module: "pybricks.messaging", category: "events", kind: "function", shape: "stack", doc: "Transmite uma mensagem para outro HUB.", signature: "send(data, channel=0)", params: { data: str("mensagem1"), channel: { ...num(0), optional: true } }, returns: "None" },
  { name: "mailbox.wait_new", module: "pybricks.messaging", category: "events", kind: "function", shape: "stack", doc: "Espera até receber uma mensagem nova.", signature: "wait_new(channel=0)", params: { channel: { ...num(0), optional: true } }, returns: "any" },
  { name: "mailbox.read", module: "pybricks.messaging", category: "events", kind: "function", shape: "reporter", doc: "Lê a última mensagem recebida.", signature: "read(channel=0)", params: { channel: { ...num(0), optional: true } }, returns: "any" },

  /* ==================== pybricks.parameters (constantes) ==================== */
  ...Object.entries(ENUMS).flatMap(([kind, values]) =>
    values.map((value) => ({
      name: `${kind}.${value}`, module: "pybricks.parameters", category: "operators",
      kind: "constant", shape: "reporter",
      doc: `Constante ${kind}.${value}${PT[kind]?.[value] ? ` — ${PT[kind][value]}` : ""}.`,
      signature: `${kind}.${value}`, params: {}, returns: kind,
    })),
  ),
];

/* ------------------------------------------------------------------ */
/* Índices derivados — calculados uma única vez                        */
/* ------------------------------------------------------------------ */

export const BY_NAME = new Map(PYBRICKS_API.map((entry) => [entry.name, entry]));

/** "Motor.run" -> entrada. Também resolve "motor.run" (minúsculo). */
export function resolve(name) {
  if (!name) return null;
  return BY_NAME.get(name) ?? BY_NAME.get(String(name).toLowerCase()) ?? null;
}

/** Último segmento: "hub.speaker.beep" -> "beep". */
export const tail = (name) => String(name).split(".").pop();

/** Todas as entradas de um módulo. */
export function byModule(module) {
  return PYBRICKS_API.filter((entry) => entry.module === module);
}

/** Todas as entradas de uma categoria de bloco. */
export function byCategory(category) {
  return PYBRICKS_API.filter((entry) => entry.category === category);
}

/**
 * Métodos de uma classe: resolveType("Motor") -> [run, run_angle, ...]
 * Usado pelo autocomplete após "motor." quando motor : Motor.
 */
export function membersOf(type) {
  if (!type) return [];
  const prefix = `${type}.`;
  return PYBRICKS_API.filter(
    (entry) => entry.name.startsWith(prefix) && !entry.name.slice(prefix.length).includes("."),
  );
}

/**
 * Cadeia de membros: resolveChain("hub", "imu") -> entradas "hub.imu.*"
 * Usado para "hub.imu." no autocomplete.
 */
export function membersOfChain(chain) {
  const prefix = `${chain}.`;
  return PYBRICKS_API.filter((entry) => entry.name.startsWith(prefix));
}

export const MODULES = [
  "pybricks.hubs",
  "pybricks.pupdevices",
  "pybricks.iodevices",
  "pybricks.parameters",
  "pybricks.robotics",
  "pybricks.tools",
  "pybricks.messaging",
];

/** Nomes de classes/constantes que podem ser importados de cada módulo. */
export const IMPORTABLE = {
  "pybricks.hubs": ["PrimeHub", "InventorHub", "TechnicHub", "CityHub", "MoveHub", "EssentialHub"],
  "pybricks.pupdevices": [
    "Motor", "DCMotor", "ColorSensor", "UltrasonicSensor", "ForceSensor",
    "ColorDistanceSensor", "TiltSensor", "InfraredSensor", "Light",
    "ColorLightMatrix", "Remote",
  ],
  "pybricks.iodevices": ["PUPDevice", "AnalogSensor", "I2CDevice", "UARTDevice", "LWP3Device"],
  "pybricks.parameters": Object.keys(ENUMS),
  "pybricks.robotics": ["DriveBase", "Car"],
  "pybricks.tools": ["wait", "StopWatch", "Matrix", "multitask", "run_task", "hub_menu", "read_input_byte", "AppData"],
  "pybricks.messaging": ["mailbox"],
};

/**
 * Mapa classe -> módulo. Usado para saber de onde importar ao gerar código.
 */
export const CLASS_MODULE = Object.fromEntries(
  Object.entries(IMPORTABLE).flatMap(([mod, names]) => names.map((n) => [n, mod])),
);

/**
 * Nomes reconhecidos da API, usados pela correção conservadora (Parte 16.1.10).
 * Inclui métodos sem o prefixo da classe ("run_angle") e com o prefixo.
 */
export const KNOWN_NAMES = (() => {
  const set = new Set();
  for (const entry of PYBRICKS_API) {
    set.add(tail(entry.name));
    const parts = entry.name.split(".");
    if (parts.length > 1) set.add(parts.slice(-2).join("."));
    set.add(entry.name);
  }
  return set;
})();

/**
 * Inferência de tipo a partir de construtores conhecidos (Parte 9.5).
 * "Motor(Port.A)" -> Motor ; "DriveBase(...)" -> DriveBase ; "PrimeHub()" -> PrimeHub
 */
export const CONSTRUCTORS = new Set(
  PYBRICKS_API.filter((entry) => entry.kind === "constructor").map((entry) => entry.name),
);

/** Palavras-chave do Python exibidas no autocomplete. */
export const PYTHON_KEYWORDS = [
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
];

/** Funções built-in mais usadas. */
export const BUILTINS = [
  "abs", "all", "any", "bin", "bool", "chr", "dict", "dir", "divmod", "enumerate",
  "filter", "float", "format", "frozenset", "getattr", "hasattr", "hex", "int",
  "isinstance", "len", "list", "map", "max", "min", "oct", "ord", "pow", "print",
  "range", "repr", "reversed", "round", "set", "sorted", "str", "sum", "tuple",
  "type", "zip", "randint", "random", "uniform",
];

export default PYBRICKS_API;

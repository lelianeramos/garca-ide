(() => {
  "use strict";

  const COLORS = [
    ["vermelho", "Color.RED"],
    ["amarelo", "Color.YELLOW"],
    ["verde", "Color.GREEN"],
    ["azul", "Color.BLUE"],
    ["violeta", "Color.VIOLET"],
    ["branco", "Color.WHITE"],
    ["preto", "Color.BLACK"],
    ["nenhuma", "Color.NONE"],
  ];

  const PORTS = ["A", "B", "C", "D", "E", "F"];
  const MOTOR_DIRECTIONS = [
    ["cw", "↻ Horário"],
    ["ccw", "↺ Anti-horário"],
  ];
  const MOVE_DIRECTIONS = [
    ["forward", "↑ Frente"],
    ["backward", "↓ Trás"],
  ];

  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  const asNumber = (value, fallback = 0) => {
    const normalized = String(value ?? "")
      .trim()
      .replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const cleanNumber = (value) => Number(asNumber(value).toFixed(6));

  const ptNumber = (value) => {
    const number = cleanNumber(value);
    return String(number).replace(".", ",");
  };

  const identifier = (value, fallback = "valor") => {
    const normalized = String(value ?? "")
      .trim()
      .replace(/\W+/g, "_");
    return /^[A-Za-z_]\w*$/.test(normalized) ? normalized : fallback;
  };

  const control = {
    number(field, value, options = {}) {
      const min = options.min ?? "";
      const max = options.max ?? "";
      const unit = options.unit ? `<span class="gb-unit">${escape(options.unit)}</span>` : "";
      return `<span class="gb-value"><input class="gb-field number-field" data-field="${field}" value="${escape(ptNumber(value))}" inputmode="decimal" aria-label="${escape(options.label || field)}" data-min="${min}" data-max="${max}" />${unit}</span>`;
    },
    port(field, value) {
      return `<select class="gb-field port-field" data-field="${field}" aria-label="Porta">${PORTS.map((port) => `<option value="${port}" ${port === value ? "selected" : ""}>Porta ${port}</option>`).join("")}</select>`;
    },
    select(field, value, options, label) {
      return `<select class="gb-field enum-field" data-field="${field}" aria-label="${escape(label || field)}">${options.map((option) => { const [key, name] = Array.isArray(option) ? option : [option, option]; return `<option value="${escape(key)}" ${key === value ? "selected" : ""}>${escape(name)}</option>`; }).join("")}</select>`;
    },
    identifier(field, value, label) {
      return `<input class="gb-field name-field" data-field="${field}" value="${escape(value)}" aria-label="${escape(label || field)}" />`;
    },
    text(field, value, label) {
      return `<input class="gb-field text-field" data-field="${field}" value="${escape(value)}" aria-label="${escape(label || field)}" />`;
    },
    boolean(field, value, label) {
      return `<label class="gb-toggle"><input class="gb-field boolean-field" data-field="${field}" type="checkbox" ${value ? "checked" : ""} /><span>${escape(label || field)}</span></label>`;
    },
  };

  const specs = {
    motor_run_angle: {
      category: "motors",
      shape: "stack",
      defaults: {
        port: "A",
        direction: "cw",
        rotations: 1,
        speed: 500,
      },
      render(params) {
        return [
          control.port("port", params.port),
          "executar",
          control.select("direction", params.direction, MOTOR_DIRECTIONS, "Direção"),
          "por",
          control.number("rotations", params.rotations, {
            min: 0,
            unit: "rotações",
            label: "Quantidade de rotações",
          }),
          "a",
          control.number("speed", params.speed, {
            min: 0,
            unit: "graus/s",
            label: "Velocidade",
          }),
        ].join(" ");
      },
      generate(params) {
        const sign = params.direction === "ccw" ? -1 : 1;
        return `motor_${params.port.toLowerCase()}.run_angle(${cleanNumber(params.speed)}, ${cleanNumber(params.rotations * 360 * sign)})`;
      },
      label(params) {
        return `${params.port} executar ${params.direction === "ccw" ? "↺" : "↻"} por ${ptNumber(params.rotations)} rotações a ${ptNumber(params.speed)} graus/s`;
      },
    },
    motor_run_target: {
      category: "motors",
      shape: "stack",
      defaults: {
        port: "A",
        target: 0,
        speed: 500,
      },
      render(params) {
        return [
          control.port("port", params.port),
          "ir pelo caminho mais curto para",
          control.number("target", params.target, {
            unit: "graus",
            label: "Posição de destino",
          }),
          "a",
          control.number("speed", params.speed, {
            min: 0,
            unit: "graus/s",
            label: "Velocidade",
          }),
        ].join(" ");
      },
      generate(params) {
        return `motor_${params.port.toLowerCase()}.run_target(${cleanNumber(params.speed)}, ${cleanNumber(params.target)})`;
      },
      label(params) {
        return `${params.port} ir pelo caminho mais curto para posição ${ptNumber(params.target)} a ${ptNumber(params.speed)} graus/s`;
      },
    },
    motor_run: {
      category: "motors",
      shape: "stack",
      defaults: {
        port: "A",
        direction: "cw",
        speed: 500,
      },
      render(params) {
        return [
          control.port("port", params.port),
          "iniciar motor",
          control.select("direction", params.direction, MOTOR_DIRECTIONS, "Direção"),
          "a",
          control.number("speed", params.speed, {
            min: 0,
            unit: "graus/s",
            label: "Velocidade",
          }),
        ].join(" ");
      },
      generate(params) {
        const sign = params.direction === "ccw" ? -1 : 1;
        return `motor_${params.port.toLowerCase()}.run(${cleanNumber(params.speed * sign)})`;
      },
      label(params) {
        return `${params.port} iniciar motor ${params.direction === "ccw" ? "↺" : "↻"} a ${ptNumber(params.speed)} graus/s`;
      },
    },
    motor_stop: {
      category: "motors",
      shape: "stack",
      defaults: {
        port: "A",
        stop: "coast",
      },
      render(params) {
        return [
          control.port("port", params.port),
          "parar motor",
          control.select(
            "stop",
            params.stop,
            [
              ["coast", "Livre"],
              ["brake", "Frear"],
              ["hold", "Manter posição"],
            ],
            "Comportamento de parada",
          ),
        ].join(" ");
      },
      generate(params) {
        const method = params.stop === "brake" ? "brake" : params.stop === "hold" ? "hold" : "stop";
        return `motor_${params.port.toLowerCase()}.${method}()`;
      },
      label(params) {
        return `${params.port} parar motor ${params.stop}`;
      },
    },
    motor_speed: {
      category: "motors",
      shape: "stack",
      defaults: {
        port: "A",
        percent: 75,
      },
      render(params) {
        return [
          control.port("port", params.port),
          "definir velocidade para",
          control.number("percent", params.percent, {
            min: 0,
            max: 100,
            unit: "%",
            label: "Velocidade percentual",
          }),
        ].join(" ");
      },
      generate(params) {
        return `motor_${params.port.toLowerCase()}_speed = ${cleanNumber(params.percent * 10)}`;
      },
      label(params) {
        return `${params.port} definir velocidade para ${ptNumber(params.percent)} %`;
      },
    },
    movement_straight: {
      category: "movement",
      shape: "stack",
      defaults: {
        direction: "forward",
        rotations: 10,
      },
      render(params) {
        return [
          "mover",
          control.select("direction", params.direction, MOVE_DIRECTIONS, "Direção"),
          "por",
          control.number("rotations", params.rotations, {
            min: 0,
            unit: "rotações",
            label: "Distância em rotações",
          }),
        ].join(" ");
      },
      generate(params) {
        const sign = params.direction === "backward" ? -1 : 1;
        return `robot.straight(${cleanNumber(params.rotations * 176 * sign)})`;
      },
      label(params) {
        return `mover ${params.direction === "backward" ? "↓" : "↑"} por ${ptNumber(params.rotations)} rotações`;
      },
    },
    movement_drive: {
      category: "movement",
      shape: "stack",
      defaults: {
        direction: "forward",
        speed: 200,
        turn_rate: 0,
      },
      render(params) {
        return [
          "iniciar movimento",
          control.select("direction", params.direction, MOVE_DIRECTIONS, "Direção"),
          "a",
          control.number("speed", params.speed, {
            min: 0,
            unit: "mm/s",
            label: "Velocidade linear",
          }),
          "curva",
          control.number("turn_rate", params.turn_rate, {
            unit: "graus/s",
            label: "Velocidade de curva",
          }),
        ].join(" ");
      },
      generate(params) {
        const sign = params.direction === "backward" ? -1 : 1;
        return `robot.drive(${cleanNumber(params.speed * sign)}, ${cleanNumber(params.turn_rate)})`;
      },
      label(params) {
        return `iniciar movimento ${params.direction === "backward" ? "↓" : "↑"} a ${ptNumber(params.speed)} mm/s com curva ${ptNumber(params.turn_rate)}`;
      },
    },
    movement_stop: {
      category: "movement",
      shape: "stack",
      defaults: {},
      render() {
        return "parar de mover";
      },
      generate() {
        return "robot.stop()";
      },
      label() {
        return "parar de mover";
      },
    },
    movement_speed: {
      category: "movement",
      shape: "stack",
      defaults: {
        percent: 75,
      },
      render(params) {
        return `definir velocidade de movimento para ${control.number("percent", params.percent, {
          min: 0,
          max: 100,
          unit: "%",
          label: "Velocidade de movimento",
        })}`;
      },
      generate(params) {
        return `robot.settings(straight_speed=${cleanNumber(params.percent * 10)})`;
      },
      label(params) {
        return `definir velocidade de movimento para ${ptNumber(params.percent)} %`;
      },
    },
    wait: {
      category: "control",
      shape: "stack",
      defaults: {
        seconds: 1,
      },
      render(params) {
        return `espere ${control.number("seconds", params.seconds, {
          min: 0,
          unit: "segundos",
          label: "Tempo de espera",
        })}`;
      },
      generate(params) {
        return `wait(${cleanNumber(params.seconds * 1000)})`;
      },
      label(params) {
        return `espere ${ptNumber(params.seconds)} segundos`;
      },
    },
    repeat: {
      category: "control",
      shape: "c-block",
      defaults: {
        times: 10,
      },
      render(params) {
        return `repita ${control.number("times", params.times, {
          min: 0,
          unit: "vezes",
          label: "Repetições",
        })}<span class="gb-cavity" aria-hidden="true"></span>`;
      },
      generate(params) {
        return `for i in range(${Math.max(0, Math.round(params.times))}):\n    pass`;
      },
      label(params) {
        return `repita ${ptNumber(params.times)} vezes`;
      },
    },
    forever: {
      category: "control",
      shape: "c-block",
      defaults: {},
      render() {
        return `sempre<span class="gb-cavity" aria-hidden="true"></span>`;
      },
      generate() {
        return "while True:\n    pass";
      },
      label() {
        return "sempre";
      },
    },
    if: {
      category: "control",
      shape: "c-block",
      defaults: {
        condition: "True",
      },
      render(params) {
        return `se ${control.text("condition", params.condition, "Condição Python")} então<span class="gb-cavity" aria-hidden="true"></span>`;
      },
      generate(params) {
        return `if ${params.condition || "True"}:\n    pass`;
      },
      label(params) {
        return `se ${params.condition || "True"} então`;
      },
    },
    beep: {
      category: "sound",
      shape: "stack",
      defaults: {
        frequency: 500,
        seconds: 0.5,
      },
      render(params) {
        return [
          "tocar bipe",
          control.number("frequency", params.frequency, {
            min: 20,
            unit: "Hz",
            label: "Frequência",
          }),
          "por",
          control.number("seconds", params.seconds, {
            min: 0,
            unit: "segundos",
            label: "Duração",
          }),
        ].join(" ");
      },
      generate(params) {
        return `hub.speaker.beep(${cleanNumber(params.frequency)}, ${cleanNumber(params.seconds * 1000)})`;
      },
      label(params) {
        return `tocar bipe ${ptNumber(params.frequency)} Hz por ${ptNumber(params.seconds)} segundos`;
      },
    },
    volume: {
      category: "sound",
      shape: "stack",
      defaults: {
        percent: 75,
      },
      render(params) {
        return `definir volume para ${control.number("percent", params.percent, {
          min: 0,
          max: 100,
          unit: "%",
          label: "Volume",
        })}`;
      },
      generate(params) {
        return `hub.speaker.volume(${cleanNumber(params.percent)})`;
      },
      label(params) {
        return `definir volume para ${ptNumber(params.percent)} %`;
      },
    },
    display_char: {
      category: "light",
      shape: "stack",
      defaults: {
        text: "A",
      },
      render(params) {
        return `escrever ${control.text("text", params.text, "Caractere")}`;
      },
      generate(params) {
        return `hub.display.char(${JSON.stringify(String(params.text || " ").slice(0, 1))})`;
      },
      label(params) {
        return `escrever ${String(params.text || " ").slice(0, 1)}`;
      },
    },
    display_off: {
      category: "light",
      shape: "stack",
      defaults: {},
      render() {
        return "desligar matriz";
      },
      generate() {
        return "hub.display.off()";
      },
      label() {
        return "desligar matriz";
      },
    },
    variable_set: {
      category: "variables",
      shape: "stack",
      defaults: {
        name: "minha_variavel",
        value: 0,
      },
      render(params) {
        return [
          "mude",
          control.identifier("name", params.name, "Nome da variável"),
          "para",
          control.number("value", params.value, {
            label: "Valor",
          }),
        ].join(" ");
      },
      generate(params) {
        return `${identifier(params.name, "minha_variavel")} = ${cleanNumber(params.value)}`;
      },
      label(params) {
        return `mude ${identifier(params.name, "minha_variavel")} para ${ptNumber(params.value)}`;
      },
    },
    variable_change: {
      category: "variables",
      shape: "stack",
      defaults: {
        name: "minha_variavel",
        value: 1,
      },
      render(params) {
        return [
          "adicione",
          control.number("value", params.value, {
            label: "Valor",
          }),
          "a",
          control.identifier("name", params.name, "Nome da variável"),
        ].join(" ");
      },
      generate(params) {
        return `${identifier(params.name, "minha_variavel")} += ${cleanNumber(params.value)}`;
      },
      label(params) {
        return `adicione ${ptNumber(params.value)} a ${identifier(params.name, "minha_variavel")}`;
      },
    },
    comparison: {
      category: "operators",
      shape: "boolean",
      defaults: { left: 10, operator: ">", right: 5 },
      render(params) {
        return [
          control.number("left", params.left, { label: "Valor esquerdo" }),
          control.select("operator", params.operator, ["==", "!=", ">", ">=", "<", "<="], "Comparação"),
          control.number("right", params.right, { label: "Valor direito" }),
        ].join(" ");
      },
      generate(params) { return `${cleanNumber(params.left)} ${params.operator} ${cleanNumber(params.right)}`; },
      label(params) { return `${ptNumber(params.left)} ${params.operator} ${ptNumber(params.right)}`; },
    },
    logic_operation: {
      category: "operators",
      shape: "boolean",
      defaults: { left: true, operator: "and", right: false },
      render(params) {
        return [
          control.boolean("left", params.left, "Valor esquerdo"),
          control.select("operator", params.operator, [["and", "e"], ["or", "ou"]], "Operador lógico"),
          control.boolean("right", params.right, "Valor direito"),
        ].join(" ");
      },
      generate(params) { return `${params.left ? "True" : "False"} ${params.operator} ${params.right ? "True" : "False"}`; },
      label(params) { return `${params.left ? "verdadeiro" : "falso"} ${params.operator === "and" ? "e" : "ou"} ${params.right ? "verdadeiro" : "falso"}`; },
    },
    logic_not: {
      category: "operators",
      shape: "boolean",
      defaults: { value: true },
      render(params) { return `não ${control.boolean("value", params.value, "Valor lógico")}`; },
      generate(params) { return `not ${params.value ? "True" : "False"}`; },
      label(params) { return `não ${params.value ? "verdadeiro" : "falso"}`; },
    },
    math_expression: {
      category: "operators",
      shape: "reporter",
      defaults: { left: 10, operator: "+", right: 5 },
      render(params) {
        return [
          control.number("left", params.left, { label: "Valor esquerdo" }),
          control.select("operator", params.operator, ["+", "-", "*", "/", "//", "%", "**"], "Operação"),
          control.number("right", params.right, { label: "Valor direito" }),
        ].join(" ");
      },
      generate(params) { return `${cleanNumber(params.left)} ${params.operator} ${cleanNumber(params.right)}`; },
      label(params) { return `${ptNumber(params.left)} ${params.operator} ${ptNumber(params.right)}`; },
    },
    if_distance: {
      category: "control",
      shape: "c-block",
      defaults: { port: "D", operator: "<", distance: 20 },
      render(params) {
        return [
          "se distância em", control.port("port", params.port),
          control.select("operator", params.operator, ["<", "<=", "==", "!=", ">=", ">"], "Comparação"),
          control.number("distance", params.distance, { min: 0, unit: "mm", label: "Distância" }), "então",
          '<span class="gb-cavity" aria-hidden="true"></span>',
        ].join(" ");
      },
      generate(params) { return `if distance_${params.port}.distance() ${params.operator} ${cleanNumber(params.distance)}:\n    pass`; },
      label(params) { return `se distância ${params.operator} ${ptNumber(params.distance)} mm então`; },
    },
    sensor_distance: {
      category: "sensors",
      shape: "reporter",
      defaults: { port: "D" },
      render(params) { return `distância em ${control.port("port", params.port)} <span class="gb-unit">mm</span>`; },
      generate(params) { return `distance_${params.port}.distance()`; },
      label(params) { return `distância (${params.port})`; },
    },
    sensor_color: {
      category: "sensors",
      shape: "reporter",
      defaults: { port: "E" },
      render(params) { return `cor em ${control.port("port", params.port)}`; },
      generate(params) { return `color_${params.port}.color()`; },
      label(params) { return `cor (${params.port})`; },
    },
    sensor_force: {
      category: "sensors",
      shape: "boolean",
      defaults: { port: "F", operator: ">", force: 5 },
      render(params) {
        return `força em ${control.port("port", params.port)} ${control.select("operator", params.operator, [">", ">=", "==", "!=", "<=", "<"], "Comparação")} ${control.number("force", params.force, { min: 0, unit: "N", label: "Força" })}`;
      },
      generate(params) { return `force_${params.port}.force() ${params.operator} ${cleanNumber(params.force)}`; },
      label(params) { return `força (${params.port}) ${params.operator} ${ptNumber(params.force)} N`; },
    },
    button_pressed: {
      category: "sensors",
      shape: "boolean",
      defaults: { button: "CENTER" },
      render(params) { return `botão ${control.select("button", params.button, ["LEFT", "RIGHT", "CENTER", "BLUETOOTH"], "Botão do hub")} pressionado`; },
      generate(params) { return `Button.${params.button} in hub.buttons.pressed()`; },
      label(params) { return `botão ${params.button.toLowerCase()} pressionado`; },
    },
    library_call: {
      category: "libraries",
      shape: "stack",
      defaults: {
        module: "movements",
        function: "gyro_move",
        arguments: {},
      },
      render(params) {
        const argumentsHtml = Object.entries(params.arguments || {})
          .map(([name, value]) => {
            if (value && typeof value === "object" && value.identifier) {
              return `<span class="gb-argument"><span>${escape(name)}</span>${control.identifier(`arguments.${name}`, value.identifier, name)}</span>`;
            }
            const editor = typeof value === "number"
              ? control.number(`arguments.${name}`, value, { label: name })
              : control.text(`arguments.${name}`, value, name);
            return `<span class="gb-argument"><span>${escape(name)}</span>${editor}</span>`;
          })
          .join(" ");
        return `<span class="gb-library-name">${escape(params.function)}</span>${argumentsHtml}`;
      },
      generate(params) {
        const args = Object.entries(params.arguments || {})
          .map(([name, value]) => {
            let output;
            if (value && typeof value === "object" && value.identifier) output = identifier(value.identifier);
            else if (typeof value === "number") output = cleanNumber(value);
            else if (typeof value === "boolean") output = value ? "True" : "False";
            else if (value === null || value === undefined) output = "None";
            else output = JSON.stringify(String(value));
            return `${identifier(name, "argumento")}=${output}`;
          })
          .join(", ");
        return `from ${params.module} import ${params.function}\n${params.function}(${args})`;
      },
      label(params) {
        return `${params.function} ${Object.entries(params.arguments || {})
          .map(([name, value]) => `${name}: ${value?.identifier || ptNumber(value)}`)
          .join(" · ")}`;
      },
    },
  };

  function inferParams(block, spec) {
    const provided = block.params || {};
    const params = { ...spec.defaults, ...provided };
    const has = (name) => Object.prototype.hasOwnProperty.call(provided, name);
    const label = block.label || "";
    const values = [...label.matchAll(/-?\d+(?:[,.]\d+)?/g)].map((match) => asNumber(match[0]));
    const port = label.match(/^([A-F])\b/)?.[1] || label.match(/\(([A-F])\)/)?.[1];
    if (port && "port" in params && !has("port")) params.port = port;
    if ("direction" in params && !has("direction")) {
      if (/↺/.test(label)) params.direction = "ccw";
      if (/↻/.test(label)) params.direction = "cw";
      if (/↓/.test(label)) params.direction = "backward";
      if (/↑/.test(label)) params.direction = "forward";
    }
    const assignNumber = (name, index, fallback) => {
      if (!has(name)) params[name] = values[index] ?? fallback;
    };
    switch (block.schema) {
      case "motor_run_angle":
        assignNumber("rotations", 0, 1);
        assignNumber("speed", 1, 500);
        break;
      case "motor_run_target":
        assignNumber("target", 0, 0);
        assignNumber("speed", 1, 500);
        break;
      case "motor_run":
        assignNumber("speed", 0, 500);
        break;
      case "motor_speed":
      case "movement_speed":
      case "volume":
        assignNumber("percent", 0, 75);
        break;
      case "movement_straight":
        assignNumber("rotations", 0, 10);
        break;
      case "movement_drive":
        assignNumber("speed", 0, 200);
        assignNumber("turn_rate", 1, 0);
        break;
      case "wait":
        assignNumber("seconds", 0, 1);
        break;
      case "repeat":
        assignNumber("times", 0, 10);
        break;
      case "beep":
        assignNumber("frequency", 0, 500);
        assignNumber("seconds", 1, 0.5);
        break;
      case "comparison":
      case "math_expression": {
        assignNumber("left", 0, 10);
        assignNumber("right", 1, 5);
        const operator = label.match(/(==|!=|>=|<=|\/\/|\*\*|>|<|\+|-|\*|\/|%)/)?.[1];
        if (operator && !has("operator")) params.operator = operator;
        break;
      }
      case "logic_operation":
        if (!has("left")) params.left = /^verdadeiro/i.test(label);
        if (!has("right")) params.right = /verdadeiro\s*$/i.test(label);
        if (!has("operator")) params.operator = /\sou\s/i.test(label) ? "or" : "and";
        break;
      case "logic_not":
        if (!has("value")) params.value = !/falso/i.test(label);
        break;
      case "if_distance": {
        assignNumber("distance", 0, 20);
        const operator = label.match(/(==|!=|>=|<=|>|<)/)?.[1];
        if (operator && !has("operator")) params.operator = operator;
        break;
      }
      case "sensor_force": {
        assignNumber("force", 0, 5);
        const operator = label.match(/(==|!=|>=|<=|>|<)/)?.[1];
        if (operator && !has("operator")) params.operator = operator;
        break;
      }
      case "button_pressed": {
        const button = label.match(/botão\s+(esquerdo|direito|central|bluetooth|left|right|center)/i)?.[1]?.toLowerCase();
        if (button && !has("button")) params.button = ({ esquerdo: "LEFT", direito: "RIGHT", central: "CENTER", bluetooth: "BLUETOOTH", left: "LEFT", right: "RIGHT", center: "CENTER" })[button];
        break;
      }
    }
    return params;
  }

  function prepare(block) {
    const spec = specs[block.schema];
    if (!spec) return block;
    block.params = inferParams(block, spec);
    block.category = spec.category || block.category;
    block.shape = spec.shape || "stack";
    block.label = spec.label(block.params);
    block.code = spec.generate(block.params);
    return block;
  }

  function render(block) {
    const spec = specs[block.schema];
    if (!spec) return null;
    prepare(block);
    return {
      html: spec.render(block.params),
      shape: spec.shape || "stack",
    };
  }

  function setPath(object, path, value) {
    const parts = path.split(".");
    let current = object;
    for (let index = 0; index < parts.length - 1; index += 1) {
      current[parts[index]] ||= {};
      current = current[parts[index]];
    }
    const key = parts.at(-1);
    const previous = current[key];
    if (previous && typeof previous === "object" && "identifier" in previous) {
      current[key] = { identifier: identifier(value, previous.identifier) };
    } else if (typeof previous === "number") {
      current[key] = asNumber(value, previous);
    } else if (typeof previous === "boolean") {
      current[key] = Boolean(value);
    } else {
      current[key] = value;
    }
  }

  function update(block, field, value) {
    const spec = specs[block.schema];
    if (!spec) return false;
    prepare(block);
    setPath(block.params, field, value);
    block.label = spec.label(block.params);
    block.code = spec.generate(block.params);
    return true;
  }

  function genericRender(block) {
    let label = escape(block.label || "");
    if (/^[A-F]\s/.test(block.label || "")) {
      const current = block.label[0];
      label = label.replace(
        current,
        control.port("legacy.port", current),
      );
    }
    label = label.replace(/(↻|↺|↑|↓)/, (direction) => {
      const movement = direction === "↑" || direction === "↓";
      const value = movement
        ? direction === "↓"
          ? "backward"
          : "forward"
        : direction === "↺"
          ? "ccw"
          : "cw";
      return control.select(
        "legacy.direction",
        value,
        movement ? MOVE_DIRECTIONS : MOTOR_DIRECTIONS,
        "Direção",
      );
    });
    let index = 0;
    label = label.replace(/\b(-?\d+(?:[,.]\d+)?)\b/g, (number) =>
      control.number(`legacy.number.${index++}`, asNumber(number), {
        label: "Valor numérico",
      }),
    );
    for (const [name] of COLORS) {
      const expression = new RegExp(`\\b${name}\\b`, "i");
      if (expression.test(block.label || "")) {
        label = label.replace(
          expression,
          control.select(
            "legacy.color",
            name,
            COLORS.map(([color]) => [color, color]),
            "Cor",
          ),
        );
        break;
      }
    }
    return {
      html: label,
      shape:
        block.type === "reporter"
          ? "reporter"
          : block.type === "boolean"
            ? "boolean"
            : block.category === "events"
              ? "hat"
              : /^(repita|sempre|se )/.test(block.label || "")
                ? "c-block"
                : "stack",
    };
  }

  function updateLegacy(block, field, value) {
    if (field === "legacy.port") {
      const old = block.label.match(/^[A-F]/)?.[0] || "A";
      block.label = block.label.replace(/^[A-F]/, value);
      block.code = block.code
        .replaceAll(`motor_${old.toLowerCase()}`, `motor_${value.toLowerCase()}`)
        .replaceAll(`Port.${old}`, `Port.${value}`);
      return true;
    }
    if (field === "legacy.direction") {
      const previous = block.label.match(/↻|↺|↑|↓/)?.[0];
      const symbol =
        value === "ccw" ? "↺" : value === "cw" ? "↻" : value === "backward" ? "↓" : "↑";
      if (previous) block.label = block.label.replace(previous, symbol);
      return true;
    }
    if (field.startsWith("legacy.number.")) {
      const target = Number(field.split(".").at(-1));
      let current = -1;
      let oldValue = "";
      block.label = block.label.replace(/-?\d+(?:[,.]\d+)?/g, (match) => {
        current += 1;
        if (current !== target) return match;
        oldValue = match;
        return ptNumber(value);
      });
      if (oldValue) {
        let codeIndex = -1;
        block.code = block.code.replace(/-?\d+(?:\.\d+)?/g, (match) => {
          codeIndex += 1;
          return codeIndex === target ? String(cleanNumber(value)) : match;
        });
      }
      return true;
    }
    if (field === "legacy.color") {
      for (const [name, constant] of COLORS) {
        if (new RegExp(`\\b${name}\\b`, "i").test(block.label)) {
          block.label = block.label.replace(new RegExp(`\\b${name}\\b`, "i"), value);
          const replacement = COLORS.find(([color]) => color === value)?.[1] || "Color.NONE";
          block.code = block.code.replace(constant, replacement);
          return true;
        }
      }
    }
    return false;
  }

  window.GarcaBlocks = {
    specs,
    prepare,
    render,
    update,
    genericRender,
    updateLegacy,
    ptNumber,
    asNumber,
  };
})();

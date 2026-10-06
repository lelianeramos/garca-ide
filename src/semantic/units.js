/* ================================================================== */
/* UNIDADES                                                            */
/* ================================================================== */
/*
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * O valor que a criança digita não é o valor que a função Python recebe.
 *
 *     "10 cm"  ->  a função espera 100 mm
 *     "0.5 m"  ->  a função espera 500 mm
 *      100    ->  volta como "10 cm" se o bloco mostra cm
 *
 * São TRÊS valores diferentes para o mesmo campo:
 *
 *     valor visual     o que está escrito no bloco    ("10")
 *     unidade visual   o que está no dropdown        ("cm")
 *     valor enviado    o que vai para o Python       (100)
 *
 * Guardar os três é o que faz o round-trip fechar: o Python tem 100, a
 * criança vê "10 cm"; se ela editar para "15 cm", o Python tem que virar
 * 150. É uma CONVERSÃO com tabela, não um texto decorado.
 *
 * Este módulo é a única fonte dessa tabela. `semanticSchemas.js` usa estes
 * fatores; nada mais escreve "mm por cm" espalhado pelo catálogo.
 *
 * fator = quanto vale 1 unidade visual no BASE do papel.
 */

/*
 * As chaves são NORMALIZADAS (sem acento, minúsculas, sem espaço) porque é
 * assim que a docstring e a anotação de tipo escrevem: "cm/s", "cm / s",
 * "milímetros". `resolver()` normaliza antes de olhar, então não existem
 * duas grafias do mesmo conceito.
 *
 * Cada entrada declara o BASE do seu papel. Converter é sempre
 * `valor * fatorVisual / fatorBase` — não há tabela de pares, o que impede
 * o erro clássico de "cm de comprimento" e "cm de velocidade" colidirem
 * numa chave só, que era exatamente o bug desta primeira versão.
 */
const UNIT_DEFS = {
  /* ---- comprimento: base mm ---- */
  mm: { kind: "length", fator: 1, rotulo: "mm" },
  centimetro: { kind: "length", fator: 10, rotulo: "cm" },
  metro: { kind: "length", fator: 1000, rotulo: "m" },

  /* ---- ângulo: base graus ---- */
  grau: { kind: "angle", fator: 1, rotulo: "\u00b0" },
  rad: { kind: "angle", fator: 57.29577951308232, rotulo: "rad" },

  /* ---- tempo: base ms (é o que o Pybricks usa) ---- */
  ms: { kind: "time", fator: 1, rotulo: "ms" },
  s: { kind: "time", fator: 1000, rotulo: "s" },
  segundo: { kind: "time", fator: 1000, rotulo: "s" },

  /* ---- velocidade: base mm/s ---- */
  "mm/s": { kind: "speed", fator: 1, rotulo: "mm/s" },
  "cm/s": { kind: "speed", fator: 10, rotulo: "cm/s" },
  "m/s": { kind: "speed", fator: 1000, rotulo: "m/s" },

  /* ---- potência: base porcentagem ---- */
  "%": { kind: "power", fator: 1, rotulo: "%" },

  /* ---- voltas ---- */
  volta: { kind: "rotation", fator: 1, rotulo: "voltas" },
};

/*
 * Grafias aceitas na entrada viram apelidos, não entradas novas. Assim
 * `cm` continua funcionando sem sequestrar a chave do comprimento — `cm`
 * sozinho é ambíguo e quem decide é o PAPEL do campo, não a tabela.
 */
const UNIT_ALIASES = {
  /* comprimento */
  cm: "centimetro",
  cms: "centimetro",
  m: "metro",
  milimetro: "mm",
  milimetros: "mm",
  /* ângulo */
  graus: "grau",
  "\u00b0": "grau",
  degree: "grau",
  degrees: "grau",
  radiano: "rad",
  /* tempo */
  seg: "s",
  segundo_s: "segundo",
  segundos: "segundo",
  /* potência */
  porcentagem: "%",
  percentual: "%",
  /* voltas */
  voltas: "volta",
  giro: "volta",
};

/**
 * Converte um valor visual para o número que a função recebe.
 *
 * Retorna `null` quando NÃO dá para converter — e `null` é a resposta
 * honesta: quem chama decide o que fazer (normalmente manter o valor
 * como expressão encaixável, em vez de chutar um número).
 *
 * @param {number|string} valorVisual  o que está escrito no bloco
 * @param {string} unidadeVisual       "cm", "mm", "°", "s"...
 * @param {string} unidadeAlvo          a unidade que a função espera
 */
export function convert(valorVisual, unidadeVisual, unidadeAlvo) {
  const de = resolver(unidadeVisual);
  const para = resolver(unidadeAlvo);

  const valor = paraNumero(valorVisual);
  if (valor === null) return null; // expressão, variável, vazio

  // Sem unidade conhecida dos dois lados o número passa direto.
  if (!de || !para) return valor;

  // Grandezas diferentes não se convertem: 100 cm NÃO são 100 graus.
  if (de.kind !== para.kind) return null;

  return valor * (de.fator / para.fator);
}

/** Converte do valor Python para o valor visual (o caminho inverso). */
export function convertInverso(valorPython, unidadeAlvo, unidadeVisual) {
  const de = resolver(unidadeAlvo);
  const para = resolver(unidadeVisual);

  const valor = paraNumero(valorPython);
  if (valor === null) return null;
  if (!de || !para) return valor;
  if (de.kind !== para.kind) return null;

  // 100 mm -> 100 * (1 / 10) = 10 cm.  Com a razão invertida dava 1000 cm.
  return valor * (de.fator / para.fator);
}

/**
 * Valor pronto para a interface.
 *
 * O arredondamento existe porque a conversão é ponto flutuante: sem ele,
 * `100 mm` virava `10.000000000000002 cm` e o bloco "piscava" sozinho. O
 * sinal é preservado porque a direção vem do número — `gb_move(gb, hub, -100)`
 * tem que continuar sendo "para trás".
 */
export function formatarVisual(valorPython, unidadeAlvo, unidadeVisual, { casas = 6 } = {}) {
  const convertido = convertInverso(valorPython, unidadeAlvo, unidadeVisual);
  const n = paraNumero(convertido);
  if (n === null) return String(valorPython ?? "");
  return String(Number(n.toFixed(casas)));
}

/**
 * Converte o valor de um CAMPO quando a criança troca a unidade no
 * seletor.
 *
 * O campo guarda o valor na unidade da FUNÇÃO; aqui ele é convertido para
 * a unidade que acabou de ser escolhida, para que a tela passe a mostrar a
 * mesma medida de outro jeito — `100 mm` vira `10 cm`, não `100 cm`.
 *
 * Devolve `null` quando não dá para converter (expressão, grandezas
 * diferentes). Nesse caso o valor é devolvido intacto pelo chamador: é
 * melhor mostrar o número sem converter do que mostrar um número errado.
 */
export function converterValorDeUnidade(campo, unidadeNova) {
  const atual = campo?.unitKey;
  if (!atual || !unidadeNova || atual === unidadeNova) return null;

  const convertido = convert(campo.value, atual, unidadeNova);
  return convertido === null ? null : String(convertido);
}

/** Numérico tolerante: aceita "10", "10,5" (vírgula brasileira) e 10. */
export function paraNumero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (valor === null || valor === undefined) return null;

  // Nó de AST não é número: `distancia * 2` tem que continuar expressão.
  if (typeof valor === "object" && valor !== null && typeof valor.type === "string") return null;

  const texto = String(valor).trim().replace(",", ".");
  if (texto === "") return null;
  if (!/^-?\d*\.?\d+(?:[eE]-?\d+)?$/.test(texto)) return null;

  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/** `true` quando o texto é um número simples — logo, campo numérico. */
export function ehNumeroLiteral(valor) {
  return paraNumero(valor) !== null;
}

/**
 * Resolve o nome de uma unidade.
 *
 * A ordem importa: primeiro a forma normalizada ("mm/s"), depois a forma
 * sem acento nem plural ("milímetros" -> "milimetro"), depois os apelidos,
 * e só então a busca por sufixo ("Centímetros por segundo").
 */
function resolver(unidade) {
  if (!unidade) return null;
  const bruto = String(unidade).trim();
  if (!bruto) return null;

  /*
   * 1. Forma técnica colada: "mm/s", "mm / s", "MM/S".
   */
  const semEspaco = bruto.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9%/]/g, "");
  if (UNIT_DEFS[semEspaco]) return UNIT_DEFS[semEspaco];

  /*
   * 2. Texto solto, sem reduzir plural: "milímetros" ainda é "milímetros".
   *
   * A redução de plural vem DEPOIS do casamento por sufixo de propósito.
   * "centímetros por segundo" reduzido vira "centimetro" e casava como
   * comprimento — a velocidade acabava em mm. Procurar o trecho mais longo
   * primeiro é o que separa as duas grandezas.
   */
  const texto = normalizar(bruto, { plural: false });
  if (UNIT_DEFS[texto]) return UNIT_DEFS[texto];

  /*
   * 3. Apelido exato.
   */
  const alvo = UNIT_ALIASES[texto] ?? UNIT_ALIASES[semEspaco];
  if (alvo && UNIT_DEFS[alvo]) return UNIT_DEFS[alvo];

  /*
   * 4. A unidade aparece embutida num texto maior
   *    ("distância em milímetros", "velocidade em cm por segundo").
   *
   * Primeiro as FRASES compostas, porque "centímetros por segundo" contém
   * três palavras que, lidas soltas, apontam para grandezas diferentes:
   * `centimetro` é comprimento e `segundo` é tempo. A frase inteira vale
   * mais que qualquer parte dela — e é o que `velocidade` traz na
   * docstring.
   */
  const frase = resolverFrase(texto);
  if (frase) return frase;

  /*
   * Só apelidos com 3+ letras contam, e vence o MAIS LONGO. Sem o mínimo,
   * a letra `m` casava dentro de "milímetros" e uma velocidade voltava
   * como comprimento — erro silencioso, do tipo que só aparece no robô.
   */
  let melhor = null;
  for (const [apelido, destino] of Object.entries(UNIT_ALIASES)) {
    const chave = normalizar(apelido, { plural: false });
    if (chave.length < 3) continue;
    if (!texto.includes(chave)) continue;
    if (!melhor || chave.length > melhor.chave.length) melhor = { chave, destino };
  }
  if (melhor && UNIT_DEFS[melhor.destino]) return UNIT_DEFS[melhor.destino];

  /*
   * 5. Só agora a redução de plural, para "milímetros" e "graus".
   */
  const simples = normalizar(bruto);
  if (UNIT_DEFS[simples]) return UNIT_DEFS[simples];
  const final = UNIT_ALIASES[simples];
  if (final && UNIT_DEFS[final]) return UNIT_DEFS[final];
  return null;
}

/*
 * Frases de unidade compostas, escritas por inteiro em português.
 *
 * A chave é a frase normalizada. O valor é a unidade canônica, resolvida
 * pelo mesmo `resolver` — uma frase nunca carrega fator próprio, para não
 * haver dois lugares com a matemática da conversão.
 */
const UNIT_FRASES = {
  centimetrosporsegundo: "cm/s",
  milimetrosporsegundo: "mm/s",
  metrosporsegundo: "m/s",
  centimetrospersegundo: "cm/s",
  milimetrospersegundo: "mm/s",
  metrospersegundo: "m/s",
  centimetroporsegundo: "cm/s",
  milimetroporsegundo: "mm/s",
  metroporsegundo: "m/s",
  grauspersegundo: "rad",
};

/** Procura a frase composta mais longa que aparecer no texto. */
function resolverFrase(texto) {
  let melhor = null;
  for (const chave of Object.keys(UNIT_FRASES)) {
    if (!texto.includes(chave)) continue;
    if (!melhor || chave.length > melhor.length) melhor = chave;
  }
  return melhor ? resolver(UNIT_FRASES[melhor]) : null;
}

/** Tira acento, baixa a caixa e remove espaço. */
function normalizar(texto, { plural = true } = {}) {
  const base = String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
  if (!plural) return base;
  if (base.length > 3 && base.endsWith("s") && !base.endsWith("ss")) return base.slice(0, -1);
  return base;
}

/** Unidade padrão de um papel semântico, quando ela existe. */
export function unidadePadrao(papel) {
  switch (papel) {
    case "distance": return "mm";
    case "speed": return "mm/s";
    case "angle": return "grau";
    case "time": return "ms";
    case "power": return "%";
    case "rotation": return "volta";
    default: return null;
  }
}

/**
 * Unidades que fazem sentido oferecer para um papel, da mais natural para
 * a menos. A primeira é a que a função provavelmente espera, então vem
 * pré-selecionada — trocar o dropdown é opt-in, não obrigação.
 */
export function unidadesPara(papel) {
  switch (papel) {
    case "distance": return ["mm", "centimetro", "metro"];
    case "speed": return ["mm/s", "cm/s", "m/s"];
    case "angle": return ["grau", "rad"];
    case "time": return ["ms", "s"];
    case "power": return ["%"];
    case "rotation": return ["volta"];
    default: return [];
  }
}

/** Rótulo curto para a interface ("°", "mm", "cm/s"). */
export function rotuloUnidade(unidade) {
  const def = resolver(unidade);
  return def ? def.rotulo : String(unidade ?? "");
}

/**
 * Nome CANÔNICO de uma unidade escrita por extenso.
 *
 *     "milímetros por segundo"  ->  "mm/s"
 *     "Centímetros"             ->  "cm"
 *
 * É o que permite usar a unidade da docstring direto na conversão, sem a
 * frase inteira sobrar como texto que não casa com nada.
 */
export function resolverUnidade(unidade) {
  const def = resolver(unidade);
  if (!def) return null;

  // A chave mais curta que descreve a mesma unidade é a canônica.
  let melhor = null;
  for (const [chave, entrada] of Object.entries(UNIT_DEFS)) {
    if (entrada !== def) continue;
    if (!melhor || chave.length < melhor.length) melhor = chave;
  }
  return melhor;
}

/** `kind` da unidade (`length`, `angle`, ...), ou `null` se não existe. */
export function tipoUnidade(unidade) {
  const def = resolver(unidade);
  return def ? def.kind : null;
}

export const UNITS = UNIT_DEFS;
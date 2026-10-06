/* ================================================================== */
/* CONSTRUÇÃO DE SCHEMA                                               */
/* ================================================================== */
/*
 * ESTE É O ARQUIVO QUE TRANSFORMA UMA FUNÇÃO PYTHON EM BLOCO.
 *
 * Ele recebe o que a análise devolve da biblioteca (assinatura real,
 * docstring, metadados, valores já usados no programa) e devolve o
 * `FunctionSchema`: a descrição completa de como o bloco se parece e de
 * como volta para o Python.
 *
 * A REGRA QUE IMPORTA
 *
 * O Python é a fonte da verdade. O schema NUNCA inventa um campo que não
 * existe na assinatura, e nunca esconde um argumento que não sabe
 * restaurar. Quando algo não cabe num campo simples, o schema diz
 * `naoRepresentavel` — e a interface sinaliza. Perder código em silêncio
 * é o pior defeito possível numa IDE que promete ir e voltar.
 */

import { classificarCampo, lerMetadados } from "./schema.js";
import { lerDocstring, papelDoCampo, unidadeDoCampo, sentidoDoSinal, opcoesDoCampo, ehBooleano } from "./docstring.js";
import { unidadePadrao, unidadesPara, resolverUnidade } from "./units.js";

/**
 * Monta o schema de uma função.
 *
 * @param {object} entrada
 * @param {object} entrada.simbolo      símbolo vindo de `extractSymbols`
 * @param {string[]} [entrada.linhas]   linhas cruas do arquivo (metadados)
 * @param {any[]}   [entrada.valores]   valores que o programa já passou
 * @param {object}  [entrada.metadados] metadados externos (JSON)
 * @returns {FunctionSchema}
 */
export function construirSchema({
  simbolo,
  linhas = [],
  valores = null,
  metadados = null,
  modulo = "",
} = {}) {
  const fn = simbolo ?? {};
  const params = fn.params ?? [];

  /* ---- Fontes, na prioridade ---- */
  const metaInterno = lerMetadados(linhas);
  const meta = mesclarMetadados(metaInterno, metadados);
  const nomesParams = params.map((p) => p.name);
  const doc = lerDocstring(fn.docstring, { nomesConhecidos: nomesParams });

  /* ---- Campos, na ORDEM da assinatura ---- */
  const campos = params.map((param, indice) => {
    const descricaoDoc = doc.campos?.[param.name]?.descricao ?? "";

    const campo = classificarCampo({
      nome: param.name,
      anotacao: param.annotation,
      descricao: descricaoDoc,
      padrao: param.default,
      metadado: meta,
      valoresUsados: valoresPorIndice(valores, indice, nomesParams, param.name),
      variadic: param.variadic,
      variadicKeyword: param.variadicKeyword,
    });

    /*
     * Complementos que a docstring sabe e a classificação não pega sozinha:
     * um campo que a docstring diz ser booleano, e um que ela lista opções.
     */
    if (descricaoDoc && ehBooleano(descricaoDoc) && campo.tipo !== "boolean") {
      campo.tipo = "boolean";
      campo.fontes.push({ fonte: "docstring", tipo: "boolean" });
    }
    if (descricaoDoc && !campo.opcoes) {
      const opcoes = opcoesDoCampo(descricaoDoc);
      if (opcoes && opcoes.length >= 2) {
        campo.opcoes = opcoes;
        campo.tipo = "enum";
        campo.fontes.push({ fonte: "docstring", tipo: "opcoes", valor: opcoes });
      }
    }

    campo.unidadeVisual = campo.unidadeFuncao;
    campo.opcoesUnidade = campo.papel ? unidadesPara(campo.papel) : [];
    campo.indice = indice;
    campo.posicional = indice;

    /*
     * `gb`, `hub`, a base e os motores são o "parafusaria" da chamada.
     *
     * Some da tela e volta sozinho na geração — a criança nunca precisa
     * ver `gb_move(gb, hub, ...)`. Mas some SÓ quando é seguro: escondido
     * aqui significa que o gerador vai preenchê-lo, e um valor que o
     * programa passa de fora NÃO pode ser escondido.
     */
    campo.oculto = decidirOculto(campo, param, valoresPorIndice(valores, indice, nomesParams, param.name), meta);

    return campo;
  });

  /* ---- O campo que carrega a direção ---- */
  const campoDirecao = escolherCampoDirecao(campos);

  /* ---- O que o bloco mostra ---- */
  const visiveis = campos.filter((c) => !c.oculto);
  const obrigatorios = visiveis.filter((c) => c.opcional === false);
  const opcionais = visiveis.filter((c) => c.opcional === true);

  /* ---- Campos que não cabem num controle simples ---- */
  const naoRepresentaveis = campos.filter((c) => !c.oculto && ehNaoRepresentavel(c));

  const rotulo = meta.rotulo ?? rotuloDe(meta.nome ?? fn.name, doc.resumo);
  const descricao = meta.descricao ?? doc.resumo ?? "";

  return {
    /* ---- identidade ---- */
    modulo: String(modulo ?? ""),
    nome: fn.name ?? "",
    /** Nome com que a função é CHAMADA no arquivo (alias incluso). */
    rotulo,
    descricao,
    docstring: fn.docstring ?? null,
    metadados: meta,

    /* ---- assinatura ---- */
    parametros: params.map((p) => ({
      nome: p.name,
      anotacao: p.annotation ?? null,
      padrao: p.default ?? null,
      variadic: Boolean(p.variadic),
      variadicKeyword: Boolean(p.variadicKeyword),
    })),
    /** Campos que aparecem na tela, na ordem em que vão no Python. */
    campos: visiveis,
    /** Todos os campos, incluindo os escondidos. */
    todosCampos: campos,
    obrigatorios,
    opcionais,
    ocultos: campos.filter((c) => c.oculto),

    /* ---- direção ---- */
    direcao: campoDirecao,

    /* ---- unidade ---- */
    unidadesUsadas: [...new Set(visiveis.map((c) => c.unidadeFuncao).filter(Boolean))],

    /* ---- honestidade ---- */
    naoRepresentaveis,
    /**
     * `true` quando o bloco é genérico porque não se sabe mais do que a
     * assinatura. A interface sinaliza em vez de fingir certeza.
     */
    generico: campos.every((c) => c.oculto || !c.papel) && !meta.nome,
  };
}

/* ------------------------------------------------------------------ */
/* Decisões de apoio                                                   */
/* ------------------------------------------------------------------ */

/**
 * Um campo está escondido?
 *
 * Três condições, todas NECESSÁRIAS — esconder é o caso perigoso, porque
 * um argumento escondido some da tela e tem que voltar no Python:
 *
 *   1. o metadado pediu, ou o nome é claramente de mecanismo (gb, hub);
 *   2. o campo é de OBJETO, não de valor (uma base de robô, não um número);
 *   3. o programa NUNCA passou um valor diferente para ele.
 *
 * A terceira é a que impede desastre: se `gb` muda de linha para linha,
 * esconder o campo faz o Python regerado mandar sempre o mesmo `gb`.
 */
function decidirOculto(campo, param, valorUsado, meta) {
  if (meta.ocultos?.includes(param.name)) return true;

  const eObjeto = campo.papel === "object" || ehNomeDeMecanismo(param.name);
  if (!eObjeto) return false;

  /*
   * ANOTAÇÃO COM OPÇÕES VENCE O NOME.
   *
   * `sensor: Literal["vermelho", "azul"]` tem o nome de uma peça de
   * hardware e o tipo de uma ESCOLHA. Esconder pelo nome tirava da tela um
   * dropdown escrito pelo autor da biblioteca — e o bloco virava um campo
   * de texto solto com um valor inventado. A anotação é informação
   * explícita; o nome é só pista.
   */
  if (campo.opcoes && campo.opcoes.length >= 2) return false;
  if (campo.anotacao) return false;

  /*
   * PARAMETRO COM DEFAULT É CONFIGURAÇÃO, NÃO PARAFUSARIA.
   *
   * `ligar: bool = True` é uma escolha da chamada, não a peça que a
   * biblioteca recebe do robô. Esconder transformaria um argumento com
   * valor próprio em nada, e o Python perderia a diferença entre
   * `ligar=True` e `ligar=False`.
   */
  if (campo.opcional) return false;

  // `gb` que o programa repete com valores diferentes NÃO pode sumir.
  if (valorUsado && typeof valorUsado === "object" && Array.isArray(valorUsado.diferentes)) {
    if (valorUsado.diferentes.size > 1) return false;
  }

  return true;
}

/** Nomes que a Pybricks e o costume usam para a "parafusaria". */
const NOMES_MECANISMO = new Set([
  "gb", "robot", "robo", "hub", "hub_sistema", "sistema", "system",
  "base", "drive", "chassi", "motor", "motor_esquerdo", "motor_direito",
  "left_motor", "right_motor", "motores", "sensor", "color_sensor",
  "distance_sensor", "forca_sensor", "陀螺仪",
]);

function ehNomeDeMecanismo(nome) {
  const n = String(nome ?? "").toLowerCase();
  if (NOMES_MECANISMO.has(n)) return true;
  // `left_motor`, `motor_a`, `hub_principal` — o nome começa pelo mecanismo.
  return /^(gb|hub|motor|motors?|robo|robot|base|drive|chassi|sensor)\b/.test(n);
}

/**
 * Escolhe o campo que decide a DIREÇÃO.
 *
 * A direção vem do SINAL de um valor: `gb_move(gb, hub, -100)` é "para
 * trás 100 mm". Só um campo com `sinal` conhecido serve — sem isso, um
 * ângulo negativo de uma curva não pode virar "esquerda" semliersa lerda.
 *
 * Em empate, vence o primeiro na assinatura, que é a ordem em que o
 * programme-read leu.
 */
function escolherCampoDirecao(campos) {
  const comSinal = campos.filter((c) => !c.oculto && c.sinal && (c.sinal.positivo || c.sinal.negativo));
  if (comSinal.length === 0) return null;

  const numericos = comSinal.filter((c) => c.tipo === "number" && c.papel);
  const escolhido = numericos[0] ?? comSinal[0];

  return {
    campo: escolhido.nome,
    indice: escolhido.indice,
    positivo: escolhido.sinal?.positivo ?? "frente",
    negativo: escolhidaNegativo(escolhido),
    /** Quando o valor é variável/expressão, a direção não é visível. */
    dinamica: false,
  };
}

function escolhidaNegativo(campo) {
  return campo.sinal?.negativo ?? "tras";
}

/**
 * Um campo não cabe num controle simples?
 *
 * Só o que REALMENTE não cabe entra aqui:
 *   - `*args` / `**kwargs`, que é um pacote de argumentos, não um valor;
 *   - um default que é uma EXPRESSÃO (`None`, `x * 2`), que precisa ser
 *     reescrita fielmente e não cabe num campo de texto solto.
 *
 * Um literal (`300`, `True`, `"frente"`) cabe perfeitamente — é só o valor
 * inicial do campo. Confundir literal com nó de AST punha todo argumento
 * opcional na lista de "não representáveis", que é o sinal de que o bloco
 * não sabe fazer o trabalho.
 */
function ehNaoRepresentavel(campo) {
  if (campo.variadic || campo.variadicKeyword) return true;
  return padraoEhExpressao(campo.padrao);
}

/**
 * O default é uma EXPRESSÃO, e não um valor pronto?
 *
 * A forma do valor é o que decide: `{type:"literal", value:300}` é valor;
 * `{type:"callExpression", ...}` ou o texto `None` é expressão.
 */
export function padraoEhExpressao(padrao) {
  if (padrao === null || padrao === undefined) return false;

  if (typeof padrao === "object") {
    if (padrao.type === "literal") return false;
    // Qualquer outro nó de AST é expressão e precisa ser preservada.
    return Boolean(padrao.type);
  }

  if (typeof padrao === "string") {
    // Texto cru: número, True/False e string com aspas são valores.
    if (/^-?\d*\.?\d+$/.test(padrao.trim())) return false;
    if (/^(True|False|None)$/.test(padrao.trim())) return padrao.trim() !== "None";
    if (/^["'].*["']$/.test(padrao.trim())) return false;
    return true;
  }

  return false;
}

/** Texto Python de um default, qualquer que seja a forma. */
export function textoDoPadrao(padrao) {
  if (padrao === null || padrao === undefined) return null;
  if (typeof padrao === "object") {
    if (padrao.type === "literal") return pythonDeLiteral(padrao);
    return padrao.source ?? null;
  }
  return String(padrao);
}

/** `literal` do IR -> texto Python. */
export function pythonDeLiteral(no) {
  if (!no || typeof no !== "object") return String(no ?? "");
  const v = no.value;
  switch (no.literalKind) {
    case "number": return String(v);
    case "string": return JSON.stringify(String(v));
    case "boolean": return v ? "True" : "False";
    case "none": return "None";
    default: return v === null || v === undefined ? "None" : String(v);
  }
}

/* ------------------------------------------------------------------ */
/* Rótulo em português                                                 */
/* ------------------------------------------------------------------ */

/*
 * O rótulo é a PRIMEIRA coisa que a criança lê. Ele não pode ser o nome
 * cru da função (`gb_move`) nem um identificador técnico.
 *
 * A tradução vem do que a função FAZ, e a lista abaixo é só o que existe
 * hoje no catálogo do projeto. Qualquer função fora daqui cai no
 * identificador legível, que ainda é melhor que `gb_xyz`.
 */
const VERBOS = {
  move: "mover", turn: "girar", curve: "curvar", drive: "andar",
  run: "ligar", stop: "parar", reset: "zerar", read: "ler",
  get: "ler", set: "definir", spin: "girar", line: "seguir",
  color: "cor", distance: "distancia", angle: "angulo", speed: "velocidade",
  power: "potencia", time: "tempo", port: "porta", light: "luz",
  sound: "som", beep: "bipar", display: "tela", print: "escrever",
};

/**
 * Rótulo legível para o bloco.
 *
 *   gb_move  -> "mover"
 *   gb_turn  -> "girar"
 *   gb_curve -> "curvar"
 *
 * A regra é: tirar o prefixo da família (`gb_`, `robo_`), separar por
 * `_`, e traduzir o verbo. O que sobrar desqualificado mantém o nome
 * original em vez de virar tradução errada.
 */
export function rotuloDe(nome, resumo = "") {
  const bruto = String(nome ?? "").trim();
  if (!bruto) return "função";

  const semPrefixo = bruto.replace(/^(gb|robo|robot|hub|motor|base)_/, "");
  const partes = semPrefixo.split("_").filter(Boolean);
  if (partes.length === 0) return bruto;

  const traduzidas = partes.map((parte) => VERBOS[parte.toLowerCase()] ?? parte);
  const verbosConhecidos = traduzidas.filter((p, i) => VERBOS[partes[i].toLowerCase()]);

  /*
   * Uma função com UM verbo traduzível e resto técnico vira o verbo:
   * "move_robot_left" -> "mover". Sem verbo conhecido, mantém o nome
   * inteiro — "read_color_sensor" é melhor que "ler sensor".
   */
  if (verbosConhecidos.length > 0 && partes.length <= 2) {
    return verbosConhecidos[0];
  }
  return traduzidas.join(" ");
}

/* ------------------------------------------------------------------ */
/* Metadados                                                           */
/* ------------------------------------------------------------------ */

/**
 * Junta metadado interno (decorator/comentário) com metadado externo.
 *
 * O EXTERNO vence. Quem mantém a configuração central tem mais contexto
 * sobre a sala de aula do que quem escreveu a biblioteca há dois anos —
 * é a fonte mais forte, como manda a prioridade.
 */
function mesclarMetadados(interno, externo) {
  if (!externo) return interno;
  return {
    ...interno,
    ...externo,
    unidades: { ...interno.unidades, ...(externo.unidades ?? {}) },
    papeis: { ...interno.papeis, ...(externo.papeis ?? {}) },
    opcoes: { ...interno.opcoes, ...(externo.opcoes ?? {}) },
    ocultos: [...new Set([...(interno.ocultos ?? []), ...(externo.ocultos ?? [])])],
    sinal: { ...(interno.sinal ?? {}), ...(externo.sinal ?? {}) },
    regras: { ...interno.regras, ...(externo.regras ?? {}) },
    origem: externo.origem ? `externo:${externo.origem}` : interno.origem,
  };
}

/**
 * Valores que o programa já passou para um campo.
 *
 * Quando há mais de um valor diferente, quem chama precisa saber: é o
 * sinal de que o campo NÃO pode ser escondido, porque um único valor
 * fixo no gerador mudaria o programa.
 */
function valoresPorIndice(valores, indice, nomesParams, nome) {
  if (!valores || !Array.isArray(valores)) return null;

  const porNome = valores.find((v) => v?.campo === nome);
  if (porNome) {
    const distintos = new Set((porNome.valores ?? []).map((v) => JSON.stringify(v)));
    return { valores: porNome.valores ?? [], diferentes: distintos };
  }

  const porIndice = valores[indice];
  if (porIndice === undefined) return null;
  const lista = Array.isArray(porIndice) ? porIndice : [porIndice];
  return { valores: lista, diferentes: new Set(lista.map((v) => JSON.stringify(v))) };
}
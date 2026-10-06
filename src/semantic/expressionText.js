/* ================================================================== */
/* EXPRESSÕES: NÓ DE AST -> TEXTO PYTHON                              */
/* ================================================================== */
/*
 * POR QUE ESTE ARQUIVO EXISTE
 *
 *     gb_move(gb, hub, distancia * 2)
 *
 * precisa voltar EXATAMENTE assim. A IR guarda a estrutura, mas o
 * Python original é texto — e é o texto que define o programa.
 *
 * A IR NÃO guarda o trecho original do arquivo: `source` é um SPAN
 * (linha/coluna), não texto. Então não há atalho de "copiar o original";
 * o texto tem que ser remontado, e a remontagem tem que respeitar as
 * MESMAS regras de associação e parêntese do Python.
 *
 * Onde isso importa de verdade:
 *
 *     a - b - c      ->  a - (b - c)   é outro programa
 *     -a ** 2        ->  -(a ** 2)    é outro programa
 *     a if b else c  ->  precisa de parêntese quando é operando
 *
 * A prioridade de precedência aqui é a do Python, declarada na tabela
 * PRECEDENCIA. Parenthesização é feita por essa tabela, não por palpite.
 *
 * Se um dia a IR passar a guardar o texto original, este arquivo passa a
 * ser o CAMINHO FALLBACK (nó montado pela interface, sem arquivo por trás)
 * — e ele continua necessário por isso.
 */

/*
 * Precedência do Python, do mais fraco para o mais forte.
 *
 * Os números seguem o well-known table do Python. O que importa é a
 * ORDEM RELATIVA, não o valor em si.
 */
const PRECEDENCIA = {
  lambda: 1,
 ternario: 2,
  ou: 3,
  e: 4,
  nao: 5,
  comparacao: 6,
  bitwiseOu: 7,
  bitwiseXor: 8,
  bitwiseE: 9,
  deslocamento: 10,
  adicao: 11,
  multiplicacao: 12,
  unario: 13,
  potencia: 14,
  chamada: 15,
  atom: 16,
};

/** Precedência de um operador binário. */
const OPERADORES = {
  "or": PRECEDENCIA.ou,
  "and": PRECEDENCIA.e,
  "<": PRECEDENCIA.comparacao,
  ">": PRECEDENCIA.comparacao,
  "<=": PRECEDENCIA.comparacao,
  ">=": PRECEDENCIA.comparacao,
  "==": PRECEDENCIA.comparacao,
  "!=": PRECEDENCIA.comparacao,
  "in": PRECEDENCIA.comparacao,
  "not in": PRECEDENCIA.comparacao,
  "is": PRECEDENCIA.comparacao,
  "is not": PRECEDENCIA.comparacao,
  "|": PRECEDENCIA.bitwiseOu,
  "^": PRECEDENCIA.bitwiseXor,
  "&": PRECEDENCIA.bitwiseE,
  "<<": PRECEDENCIA.deslocamento,
  ">>": PRECEDENCIA.deslocamento,
  "+": PRECEDENCIA.adicao,
  "-": PRECEDENCIA.adicao,
  "*": PRECEDENCIA.multiplicacao,
  "/": PRECEDENCIA.multiplicacao,
  "//": PRECEDENCIA.multiplicacao,
  "%": PRECEDENCIA.multiplicacao,
  "@": PRECEDENCIA.multiplicacao,
  "**": PRECEDENCIA.potencia,
};

/**
 * Converte um nó de expressão no texto Python correspondente.
 *
 * @param {object} no nó da IR
 * @param {number} [precedenciaMinima] o contexto exige pelo menos isto
 * @returns {string}
 */
export function expressaoParaTexto(no, precedenciaMinima = 0) {
  if (no === null || no === undefined) return "";

  /* ---- Escalar cru: já é texto Python ---- */
  if (typeof no === "string") return no;
  if (typeof no === "number") return String(no);
  if (typeof no === "boolean") return no ? "True" : "False";

  if (typeof no !== "object") return String(no);

  /*
   * `source` num nó é SPAN (linha/coluna), não texto. Só quando vier texto
   * de verdade — o que acontece quando o nó foi montado pela interface —
   * ele vale mais que a remontagem.
   */
  if (typeof no.source === "string" && no.source.trim()) return no.source.trim();

  switch (no.type) {
    case "literal":
      return literalParaTexto(no);

    case "variableReference":
      return String(no.name ?? "");

    case "attribute": {
      const objeto = expressaoParaTexto(no.object ?? no.value, PRECEDENCIA.atom);
      return `${objeto}.${no.attribute ?? ""}`;
    }

    case "binaryOperation":
      return binarioParaTexto(no, precedenciaMinima);

    case "unaryOperation":
      return unarioParaTexto(no, precedenciaMinima);

    case "booleanOperation":
      return booleanoParaTexto(no, precedenciaMinima);

    case "callExpression":
      return chamadaParaTexto(no, precedenciaMinima);

    case "list":
      return `[${(no.items ?? []).map((e) => expressaoParaTexto(e, 0)).join(", ")}]`;

    case "tuple":
      return tuplaParaTexto(no, precedenciaMinima);

    case "dict": {
      const pares = (no.entries ?? no.items ?? []).map((e) => {
        const chave = expressaoParaTexto(e.key, 0);
        const valor = expressaoParaTexto(e.value, 0);
        // `**outro` é spread, e tem dois-pontos no Python.
        return e.key?.type === "unpack" ? `**${valor}` : `${chave}: ${valor}`;
      });
      return comParenteses(`{${pares.join(", ")}}`, PRECEDENCIA.atom, precedenciaMinima);
    }

    case "set":
      return `{${(no.items ?? []).map((e) => expressaoParaTexto(e, 0)).join(", ")}}`;

    case "conditionalExpression": {
      const corpo = expressaoParaTexto(no.consequent ?? no.body, 0);
      const teste = expressaoParaTexto(no.test ?? no.condition, 0);
      const alternativa = expressaoParaTexto(no.alternate ?? no.orelse, 0);
      const texto = `${corpo} if ${teste} else ${alternativa}`;
      return comParenteses(texto, PRECEDENCIA.ternario, precedenciaMinima);
    }

    case "lambda":
      return comParenteses(
        `lambda ${(no.params ?? []).map(paramTexto).join(", ")}: ${expressaoParaTexto(no.body, 0)}`,
        PRECEDENCIA.lambda,
        precedenciaMinima,
      );

    case "fstring": {
      const partes = (no.parts ?? []).map((p) =>
        (typeof p === "string" ? p : `{${expressaoParaTexto(p.value ?? p, 0)}}`));
      return comParenteses(`f"${partes.join("")}"`, PRECEDENCIA.atom, precedenciaMinima);
    }

    case "docstring":
      return `"""${no.text ?? ""}"""`;

    /*
     * Nó sem forma conhecida. Inventar texto aqui produziria Python que
     * compila e faz outra coisa — o pior tipo de bug. A string vazia faz
     * a interface sinalizar, que é o comportamento correto.
     */
    default:
      return no.text ?? "";
  }
}

/* ------------------------------------------------------------------ */
/* Operadores                                                          */
/* ------------------------------------------------------------------ */

/**
 * Operação binária.
 *
 * Python associa à ESQUERDA: `a - b - c` é `(a - b) - c`. Para o operando
 * DIREITO ser reescrito sem erro, ele precisa de parêntese quando tiver a
 * MESMA precedência do operador — daí o `+ 1` à direita e o `+ 1` no
 * mínimo do lado esquerdo para operações não associativas como a subtração.
 */
function binarioParaTexto(no, precedenciaMinima) {
  const op = no.operator ?? "+";
  const nivel = OPERADORES[op] ?? PRECEDENCIA.atom;

  /*
   * `**` associa à DIREITA no Python: `2 ** 3 ** 2` vale 512, e não 64.
   * Dar ao lado direito a MESMA precedência deixa a remontagem do jeito
   * que foi lida — `a ** (b ** c)` passaria a `a ** b ** c`.
   *
   * As demais operações associam à ESQUERDA, e aí o lado direito exige um
   * nível a mais: é o que impede `a - (b - c)` de virar `a - b - c`, que é
   * outro programa.
   */
  const associativoDireita = op === "**";
  const esquerda = expressaoParaTexto(no.left, nivel);
  const direita = expressaoParaTexto(no.right, nivel + (associativoDireita ? 0 : 1));

  return comParenteses(`${esquerda} ${op} ${direita}`, nivel, precedenciaMinima);
}

/** Operação booleana (`and`, `or`). */
function booleanoParaTexto(no, precedenciaMinima) {
  const op = no.operator ?? "and";
  const nivel = OPERADORES[op] ?? PRECEDENCIA.e;

  const esquerda = expressaoParaTexto(no.left, nivel);
  const direita = expressaoParaTexto(no.right, nivel + 1);

  return comParenteses(`${esquerda} ${op} ${direita}`, nivel, precedenciaMinima);
}

/**
 * Operação unária: `not x`, `-x`, `~x`, `+x`.
 *
 * `not` é palavra-chave (precedência 5); os símbolos são unários (13).
 */
function unarioParaTexto(no, precedenciaMinima) {
  const op = no.operator ?? no.op ?? "+";
  const ehNot = op === "not";
  const nivel = ehNot ? PRECEDENCIA.nao : PRECEDENCIA.unario;

  /*
   * `-a ** 2` no Python é `-(a ** 2)`, porque a potencia liga mais forte
   * que o sinal. Escrever o sinal em volta de `a ** 2` mudaria o sinal do
   * resultado — erro que só aparece com números negativos.
   */
  const interno = expressaoParaTexto(no.operand ?? no.value ?? no.argument, nivel + (ehNot ? 0 : 1));

  /*
   * `not x` leva espaço (é palavra-chave); `-x`, `~x` e `+x` não.
   *
   * `- d` é Python válido, mas é código diferente do arquivo da criança:
   * o round-trip tem que devolver o texto que estava lá, e o Python de
   * verdade escreve `-distancia`, não `- distancia`.
   */
  const espaco = ehNot ? " " : "";
  const texto = `${op}${espaco}${interno}`;

  return comParenteses(texto, nivel, precedenciaMinima);
}

/** Chamada de função/método. */
function chamadaParaTexto(no, precedenciaMinima) {
  const alvo = no.calleeText ?? (typeof no.callee === "string" ? no.callee : no.callee?.name ?? "");
  const args = [
    ...(no.arguments ?? []).map((a) => expressaoParaTexto(a, 0)),
    ...(no.keywords ?? []).map((k) => `${k.name}=${expressaoParaTexto(k.value, 0)}`),
  ];
  return comParenteses(`${alvo}(${args.join(", ")})`, PRECEDENCIA.chamada, precedenciaMinima);
}

/** Tupla: precisa de vírgula final com um elemento só. */
function tuplaParaTexto(no, precedenciaMinima) {
  const itens = (no.items ?? no.elements ?? []).map((e) => expressaoParaTexto(e, 0));
  const texto = itens.length === 1 ? `(${itens[0]},)` : `(${itens.join(", ")})`;
  return comParenteses(texto, PRECEDENCIA.atom, precedenciaMinima);
}

/* ------------------------------------------------------------------ */
/* Auxiliares                                                          */
/* ------------------------------------------------------------------ */

/** Literal da IR -> texto Python. */
function literalParaTexto(no) {
  switch (no.literalKind) {
    case "string":
      // `raw` preserva aspas simples quando a criança escreveu assim.
      return no.raw ?? JSON.stringify(String(no.value));
    case "boolean":
      return no.value ? "True" : "False";
    case "none":
      return "None";
    default:
      return String(no.value);
  }
}

function paramTexto(p) {
  if (typeof p === "string") return p;
  const nome = p?.name ?? "";
  return p?.annotation ? `${nome}: ${p.annotation}` : nome;
}

/**
 * Parênteses só quando a precedência exige.
 *
 * Este é o ponto onde um renderizador de expressão costuma errar: colocar
 * parêntese "por segurança" em tudo gera `((a + b) * c)` legível, mas
 * também `a * (b)` onde o Python original não tinha — e o round-trip deixa
 * de ser fiel ao arquivo.
 */
function comParenteses(texto, nivel, exigido) {
  if (nivel < exigido) return `(${texto})`;
  return texto;
}

/** Texto Python de um statement ou expressão solta. */
export function valorParaTexto(no) {
  if (no === null || no === undefined) return "";
  if (typeof no === "string" || typeof no === "number" || typeof no === "boolean") return String(no);
  if (typeof no !== "object") return String(no);
  return expressaoParaTexto(no, 0);
}
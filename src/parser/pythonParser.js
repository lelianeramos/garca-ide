/**
 * PARSER PYTHON TOLERANTE + IR — GARÇA DE BOTAS CODE STUDIO
 * ---------------------------------------------------------
 * Roda 100% no navegador para que a sincronização blocos <-> Python seja
 * instantânea (B02: sem esperar blur; T01: colar e ver os blocos).
 *
 * Não usa casamento de string (N05). Produz uma IR semântica com SPAN em
 * todos os nós e argumentos (Parte 9.3), o que permite patch cirúrgico
 * (Parte 13.4) e destaque código <-> bloco (Parte 14.6).
 *
 * Recuperação de erro (Parte 9.4): se uma linha falha, as outras continuam
 * virando blocos e a linha recebe diagnóstico com linha/coluna (B14).
 */

/* ------------------------------------------------------------------ */
/* Tokenizer                                                           */
/* ------------------------------------------------------------------ */

const PUNCTUATORS = [
  "**=", "//=", ">>=", "<<=", "...",
  "**", "//", ">>", "<<", "<=", ">=", "==", "!=", "->", ":=",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=",
  "+", "-", "*", "/", "%", "@", "&", "|", "^", "~", "<", ">",
  "(", ")", "[", "]", "{", "}", ",", ":", ".", ";", "=",
];

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

/**
 * Tokeniza uma única linha lógica (sem quebras de linha).
 * Devolve { tokens, error }.
 */
export function tokenizeLine(text) {
  const tokens = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (char === " " || char === "\t") { i += 1; continue; }

    // Comentário — descarta o resto
    if (char === "#") {
      tokens.push({ type: "comment", value: text.slice(i), start: i, end: len });
      break;
    }

    // String (com aspas simples, duplas, triplas e f-strings)
    if (char === '"' || char === "'") {
      const triple = text.startsWith(char.repeat(3), i);
      const quote = triple ? char.repeat(3) : char;
      let j = i + quote.length;
      let closed = false;
      while (j < len) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text.startsWith(quote, j)) { j += quote.length; closed = true; break; }
        j += 1;
      }
      if (!closed) {
        return { tokens, error: { message: "unterminated string literal", column: i + 1 } };
      }
      tokens.push({ type: "string", value: text.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // Prefixo de f-string / r-string / b-string
    if (/[fFrRbBuU]/.test(char) && (text[i + 1] === '"' || text[i + 1] === "'")) {
      const quoteChar = text[i + 1];
      const triple = text.startsWith(quoteChar.repeat(3), i + 1);
      const quote = triple ? quoteChar.repeat(3) : quoteChar;
      let j = i + 1 + quote.length;
      let closed = false;
      while (j < len) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text.startsWith(quote, j)) { j += quote.length; closed = true; break; }
        j += 1;
      }
      if (!closed) {
        return { tokens, error: { message: "unterminated string literal", column: i + 1 } };
      }
      tokens.push({ type: "string", value: text.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // Número
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(text[i + 1] || ""))) {
      const match = /^0[xX][0-9a-fA-F_]+|^[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?|^\.[0-9_]+/.exec(text.slice(i));
      const raw = match ? match[0] : char;
      tokens.push({ type: "number", value: raw, start: i, end: i + raw.length });
      i += raw.length;
      continue;
    }

    // Identificador / palavra-chave
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
      const raw = match[0];
      tokens.push({
        type: KEYWORDS.has(raw) ? "keyword" : "name",
        value: raw, start: i, end: i + raw.length,
      });
      i += raw.length;
      continue;
    }

    // Pontuação
    const punct = PUNCTUATORS.find((candidate) => text.startsWith(candidate, i));
    if (punct) {
      tokens.push({ type: "op", value: punct, start: i, end: i + punct.length });
      i += punct.length;
      continue;
    }

    return { tokens, error: { message: "invalid syntax", column: i + 1 } };
  }

  return { tokens, error: null };
}

/* ------------------------------------------------------------------ */
/* Parser de expressões (precedence climbing)                          */
/* ------------------------------------------------------------------ */

const BINARY_LEVELS = [
  { ops: ["or"], kind: "booleanOperation" },
  { ops: ["and"], kind: "booleanOperation" },
  { ops: ["not"], kind: "unaryOperation", unary: true },
  { ops: ["in", "not in", "is", "is not", "<", ">", "<=", ">=", "==", "!="], kind: "comparison" },
  { ops: ["|", "^", "&"], kind: "binaryOperation" },
  { ops: ["<<", ">>"], kind: "binaryOperation" },
  { ops: ["+", "-"], kind: "binaryOperation" },
  { ops: ["*", "/", "//", "%", "@"], kind: "binaryOperation" },
];

class ExpressionParser {
  constructor(tokens, line) {
    this.tokens = tokens.filter((token) => token.type !== "comment");
    this.line = line;
    this.pos = 0;
  }

  peek(offset = 0) { return this.tokens[this.pos + offset] ?? null; }
  next() { return this.tokens[this.pos++] ?? null; }
  at(value) { const token = this.peek(); return Boolean(token) && token.value === value; }
  atAny(values) { const token = this.peek(); return Boolean(token) && values.includes(token.value); }

  eat(value) {
    if (this.at(value)) { this.pos += 1; return true; }
    return false;
  }

  span(startToken, endToken) {
    return {
      startLine: this.line, startColumn: startToken?.start ?? 0,
      endLine: this.line, endColumn: endToken?.end ?? startToken?.end ?? 0,
    };
  }

  parseExpression() { return this.parseLevel(0); }

  /**
   * Item de `with`: `EXPR` ou `EXPR as NOME`.
   *
   * O `as` precisa ser tratado aqui porque a expressão sozinha não para
   * nele — `as` é palavra-chave, e o parser de expressões não sabe que,
   * depois dele, vem o nome do contexto.
   */
  parseWithItem() {
    const context = this.parseLevel(0);
    if (!this.at("as")) return context;
    this.next();
    const alias = this.parseLevel(0);
    return { type: "withItem", context, alias, source: context?.source };
  }

  /*
    TERNÁRIO — `A if COND else B`

    Bug de CORREÇÃO, não de estilo. O parser ignorava o que vinha depois do
    valor: `direcao = 1 if distancia >= 0 else -1` virava um `literal 1` e
    jogava fora a condição e o `-1`. O bloco mostrava `direcao = 1`, o
    Python regerado também, e o robô ia para o lado errado sem nenhum
    aviso. Perda de semântica silenciosa é o pior defeito possível numa
    IDE de bloqueio ↔ texto, porque nada denuncia.

    O ternário é resolvido no FIM do nível mais fraco de precedência (o do
    `or`), e não num nível à parte: é o que faz `a or b if c else d`
    associar como `(a or b) if c else d`, que é como o Python real lê.
  */
  parseTernaryFrom(value) {
    if (!this.at("if")) return value;

    this.next(); // consome "if"
    const test = this.parseLevel(0);
    let alternate = null;

    if (this.at("else")) {
      this.next(); // consome "else"
      // recursivo: `a if b else c if d else e` é `a if b else (c if d else e)`
      alternate = this.parseTernaryFrom(this.parseLevel(0));
    }

    return {
      type: "conditionalExpression",
      test, consequent: value, alternate,
      source: {
        startLine: value.source?.startLine ?? this.line,
        startColumn: value.source?.startColumn ?? 0,
        endLine: this.line,
        endColumn: this.previousToken()?.end ?? 0,
      },
    };
  }

  parseLevel(level) {
    // Último nível: entra a `factor` do Python, que resolve sinal e `**`.
    if (level >= BINARY_LEVELS.length) return this.parseFactor();
    const spec = BINARY_LEVELS[level];

    if (spec.unary) {
      if (this.atAny(spec.ops)) {
        const op = this.next();
        const operand = this.parseLevel(level);
        return {
          type: "unaryOperation", operator: "not", operand,
          source: this.span(op, this.previousToken()),
        };
      }
      return this.parseLevel(level + 1);
    }

    let left = this.parseLevel(level + 1);
    while (true) {
      // operadores compostos de duas palavras
      let operator = null;
      if (this.at("not") && this.peek(1)?.value === "in") { this.next(); this.next(); operator = "not in"; }
      else if (this.at("is") && this.peek(1)?.value === "not") { this.next(); this.next(); operator = "is not"; }
      else if (this.atAny(spec.ops)) operator = this.next().value;
      if (!operator) break;

      const right = this.parseLevel(spec.rightAssoc ? level : level + 1);
      left = {
        type: spec.kind, operator, left, right,
        source: { ...left.source, endLine: right.source?.endLine ?? this.line, endColumn: right.source?.endColumn ?? 0 },
      };
    }

    // O ternário tem a menor precedência de todas: só depois do `or`.
    if (level === 0) left = this.parseTernaryFrom(left);

    return left;
  }

  previousToken() { return this.tokens[this.pos - 1] ?? null; }

  /*
   * `factor` DA GRAMÁTICA DO PYTHON
   *
   *     factor := ("+" | "-" | "~") factor | power
   *     power  := primary ["**" factor]
   *
   * O sinal unário é mais FORA que a potência, então
   *
   *     -a ** 2   é   -(a ** 2)      ->  -4 quando a = 2
   *     (-a) ** 2 é   ((-a) ** 2)    ->   4 quando a = 2
   *
   * São o MESMO símbolo com resultado OPOSTO. O parser antigo tratava
   * `-a ** 2` como `(-a) ** 2`, e o round-trip devolvia o resultado errado
   * da conta que a criança escreveu — e `(-a) ** 2` voltava como
   * `-a ** 2`. Erro silencioso em aritmética é o pior que existe numa
   * IDE que promete devolver o mesmo programa.
   *
   * Por isso `power` só aceita pós-fixos à ESQUERDA: se pedisse sinal, o
   * `-` de `-a` seria engolido antes de o `**` aparecer.
   */
  parseFactor() {
    if (this.atAny(["-", "+", "~"])) {
      const op = this.next();
      const operand = this.parseFactor();
      // -5 vira literal negativo (fica legível no bloco)
      if (op.value === "-" && operand.type === "literal" && typeof operand.value === "number") {
        return { ...operand, value: -operand.value, source: this.span(op, this.previousToken()) };
      }
      return {
        type: "unaryOperation", operator: op.value, operand,
        source: this.span(op, this.previousToken()),
      };
    }
    return this.parsePower();
  }

  /** `power`: pós-fixos e, opcionalmente, `**` com `factor` à direita. */
  parsePower() {
    const base = this.parsePostfix();
    if (!this.at("**")) return base;

    this.next(); // consome "**"
    /*
     * À direita entra `factor`, e não só `power`: é o que faz `2 ** -1`
     * funcionar e `2 ** 3 ** 2` associar à direita, como o Python real.
     */
    const expoente = this.parseFactor();
    return {
      type: "binaryOperation", operator: "**", left: base, right: expoente,
      source: {
        startLine: base.source?.startLine ?? this.line,
        startColumn: base.source?.startColumn ?? 0,
        endLine: expoente.source?.endLine ?? this.line,
        endColumn: expoente.source?.endColumn ?? 0,
      },
    };
  }

  parsePostfix() {
    let node = this.parseAtom();
    while (true) {
      if (this.at(".")) {
        const dot = this.next();
        const nameToken = this.next();
        if (!nameToken) break;
        node = {
          type: "attribute", object: node, attribute: nameToken.value,
          source: { ...node.source, endColumn: nameToken.end },
        };
        continue;
      }
      if (this.at("(")) {
        const open = this.next();
        const { args, keywords } = this.parseArguments();
        const calleeText = describeCallee(node);
        node = {
          type: "callExpression", callee: node, calleeText,
          arguments: args, keywords,
          source: { ...node.source, endColumn: this.previousToken()?.end ?? open.end },
        };
        continue;
      }
      if (this.at("[")) {
        this.next();
        const index = this.parseExpression();
        this.eat("]");
        node = {
          type: "subscript", object: node, index,
          source: { ...node.source, endColumn: this.previousToken()?.end ?? 0 },
        };
        continue;
      }
      break;
    }
    return node;
  }

  parseArguments() {
    const args = [];
    const keywords = [];
    if (this.eat(")")) return { args, keywords };

    while (this.peek()) {
      // argumento nomeado: name = expr  (sem confundir com == )
      const first = this.peek();
      const second = this.peek(1);
      if (first?.type === "name" && second?.value === "=") {
        this.next(); this.next();
        const valueNode = this.parseExpression();
        keywords.push({ name: first.value, value: valueNode, source: this.span(first, this.previousToken()) });
      } else if (first?.value === "**" || first?.value === "*") {
        this.next();
        args.push(this.parseExpression());
      } else {
        args.push(this.parseExpression());
      }
      if (this.eat(",")) continue;
      this.eat(")");
      break;
    }
    return { args, keywords };
  }

  parseAtom() {
    const token = this.peek();
    if (!token) return { type: "pythonExpression", text: "", source: { startLine: this.line, startColumn: 0, endLine: this.line, endColumn: 0 } };

    if (token.type === "number") {
      this.next();
      const value = Number(String(token.value).replace(/_/g, ""));
      return { type: "literal", value, literalKind: "number", source: this.span(token, token) };
    }
    if (token.type === "string") {
      this.next();
      const raw = token.value;
      const inner = raw.replace(/^[fFrRbBuU]*/, "").replace(/^('''|"""|'|")/, "").replace(/('''|"""|'|")$/, "");
      return {
        type: "literal", value: inner, literalKind: "string", raw,
        source: this.span(token, token),
      };
    }
    if (token.value === "True" || token.value === "False") {
      this.next();
      return { type: "literal", value: token.value === "True", literalKind: "boolean", source: this.span(token, token) };
    }
    if (token.value === "None") {
      this.next();
      return { type: "literal", value: null, literalKind: "none", source: this.span(token, token) };
    }
    if (token.type === "name") {
      this.next();
      return { type: "variableReference", name: token.value, source: this.span(token, token) };
    }
    if (token.value === "(") {
      this.next();
      const items = [this.parseExpression()];
      let virgulaFinal = false;
      while (this.eat(",")) {
        // vírgula seguida de `)` é tupla de UM elemento: `(1,)`
        if (this.at(")")) { virgulaFinal = true; break; }
        items.push(this.parseExpression());
      }
      this.eat(")");
      /*
       * `(x)` é só o valor entre parênteses; `(x,)` é uma TUPLA de um
       * elemento. Tratar os dois como o mesmo fez `(1,)` virar `1` no
       * round-trip — e `(1,)` passado para `gb_move` deixa de ser uma
       * tupla para virar um inteiro. A diferença é um caractere no arquivo.
       */
      const ehTupla = items.length > 1 || virgulaFinal;
      return ehTupla
        ? { type: "tuple", items, single: items.length === 1, source: { startLine: this.line, startColumn: token.start, endLine: this.line, endColumn: this.previousToken()?.end ?? 0 } }
        : items[0];
    }
    if (token.value === "[") {
      this.next();
      const items = [];
      if (!this.at("]")) {
        items.push(this.parseExpression());
        while (this.eat(",")) { if (this.at("]")) break; items.push(this.parseExpression()); }
      }
      this.eat("]");
      return { type: "list", items, source: { startLine: this.line, startColumn: token.start, endLine: this.line, endColumn: this.previousToken()?.end ?? 0 } };
    }
    if (token.value === "{") {
      this.next();
      const entries = [];
      if (!this.at("}")) {
        do {
          const key = this.parseExpression();
          if (this.eat(":")) entries.push({ key, value: this.parseExpression() });
          else entries.push({ key, value: null });
        } while (this.eat(","));
      }
      this.eat("}");
      return { type: entries.every((e) => e.value === null) ? "set" : "dict", entries, source: { startLine: this.line, startColumn: token.start, endLine: this.line, endColumn: this.previousToken()?.end ?? 0 } };
    }
    if (token.value === "lambda") {
      this.next();
      const params = [];
      if (!this.at(":")) {
        do { params.push(this.next()?.value); } while (this.eat(","));
      }
      this.eat(":");
      const body = this.parseExpression();
      return { type: "lambda", params, body, source: { startLine: this.line, startColumn: token.start, endLine: this.line, endColumn: this.previousToken()?.end ?? 0 } };
    }

    // Token não esperado — devolve expressão opaca em vez de quebrar tudo
    this.next();
    return { type: "pythonExpression", text: token.value, source: this.span(token, token) };
  }

  /**
   * A expressão ficou sem OPERANDO?
   *
   * `x = 1 +` e `x = = 1` eram aceitos em silêncio: o parser devolvia uma
   * árvore meio vazia, o bloco aparecia, e o indicador dizia "sincronizado".
   * A criança achava que o programa estava pronto e o `SyntaxError` só
   * apareceria no robô.
   *
   * A checagem é na ÁRVORE, não no texto: é a informação que já existe.
   */
  static incompleta(node) {
    if (!node) return true;
    switch (node.type) {
      case "binaryOperation":
        return ExpressionParser.incompleta(node.left) || ExpressionParser.incompleta(node.right);
      case "unaryOperation":
        // O campo é `operand` (é o nome que o construtor usa), não
        // `argument`: com o nome errado, `x = not y` era dado como linha
        // pela metade e a criança perdia um programa válido.
        return ExpressionParser.incompleta(node.operand);
      case "compare":
        return ExpressionParser.incompleta(node.left) || ExpressionParser.incompleta(node.right);
      case "booleanOperation":
        return ExpressionParser.incompleta(node.left) || ExpressionParser.incompleta(node.right);
      case "callExpression":
        return ExpressionParser.incompleta(node.callee)
          || (node.arguments ?? []).some(ExpressionParser.incompleta);
      case "attribute":
        return ExpressionParser.incompleta(node.object);
      case "subscript":
        return ExpressionParser.incompleta(node.object);
      case "ternary":
        return ExpressionParser.incompleta(node.condition)
          || ExpressionParser.incompleta(node.consequent)
          || ExpressionParser.incompleta(node.alternative);
      case "literal":
        return node.value === undefined || node.value === null;
      case "variableReference":
        return !node.name;
      case "tuple":
      case "list":
        return (node.elements ?? []).some(ExpressionParser.incompleta);
      // `pythonExpression` cobre qualquer token que o parser não reconhece —
      // inclusive um `=` que sobrou. Todos são sinal de linha pela metade.
      case "pythonExpression":
        return true;
      default:
        return false;
    }
  }
}

/** Reconstrói o texto pontuado de um callee: hub.imu.heading -> "hub.imu.heading" */
export function describeCallee(node) {
  if (!node) return "";
  if (node.type === "variableReference") return node.name;
  if (node.type === "attribute") return `${describeCallee(node.object)}.${node.attribute}`;
  if (node.type === "subscript") return `${describeCallee(node.object)}[${unparse(node.index)}]`;
  if (node.type === "callExpression") return `${describeCallee(node.callee)}()`;
  return node.text ?? "";
}

/* ------------------------------------------------------------------ */
/* Unparse (IR -> texto Python) — usado por patch e rótulos            */
/* ------------------------------------------------------------------ */

export function unparse(node) {
  if (node === null || node === undefined) return "";
  switch (node.type) {
    case "literal":
      if (node.literalKind === "string") return node.raw ?? JSON.stringify(node.value);
      if (node.literalKind === "boolean") return node.value ? "True" : "False";
      if (node.literalKind === "none") return "None";
      return String(node.value);
    case "variableReference": return node.name;
    case "attribute": return `${unparse(node.object)}.${node.attribute}`;
    case "subscript": return `${unparse(node.object)}[${unparse(node.index)}]`;
    case "callExpression": {
      const args = node.arguments.map(unparse);
      const kwargs = (node.keywords || []).map((kw) => `${kw.name}=${unparse(kw.value)}`);
      return `${describeCallee(node.callee)}(${[...args, ...kwargs].join(", ")})`;
    }
    case "binaryOperation": return `(${unparse(node.left)} ${node.operator} ${unparse(node.right)})`;
    case "comparison": return `(${unparse(node.left)} ${node.operator} ${unparse(node.right)})`;
    case "booleanOperation": return `(${unparse(node.left)} ${node.operator} ${unparse(node.right)})`;
    case "unaryOperation":
      return node.operator === "not" ? `(not ${unparse(node.operand)})` : `(${node.operator}${unparse(node.operand)})`;
    case "list": return `[${node.items.map(unparse).join(", ")}]`;
    case "tuple": {
      const dentro = node.items.map(unparse).join(", ");
      return `(${dentro}${node.single ? "," : ""})`;
    }
    case "dict": return `{${node.entries.map((e) => `${unparse(e.key)}: ${unparse(e.value)}`).join(", ")}}`;
    case "set": return `{${node.entries.map((e) => unparse(e.key)).join(", ")}}`;
    case "lambda": return `lambda ${node.params.join(", ")}: ${unparse(node.body)}`;
    case "conditionalExpression":
      // `A if COND else B` — o `else` ausente é um Python inválido, mas
      // devolvemos algo legível em vez de string vazia silenciosa.
      return node.alternate
        ? `(${unparse(node.consequent)} if ${unparse(node.test)} else ${unparse(node.alternate)})`
        : `(${unparse(node.consequent)} if ${unparse(node.test)} else None)`;
    case "pythonExpression": return node.text ?? "";
    default: return node.text ?? "";
  }
}

/* ------------------------------------------------------------------ */
/* Parser de estrutura (statements por indentação)                     */
/* ------------------------------------------------------------------ */

/**
 * Divide uma lista de tokens por VÍRGULAS DE PRIMEIRO NÍVEL.
 *
 * `a, b = f(1, 2)` divide em dois: o `f(1, 2)` é uma chamada, e a vírgula
 * dela é argumento, não separador. Sem isso, os argumentos viravam alvos.
 */
/**
 * Lê a anotação de tipo de um parâmetro, como texto.
 *
 * `float`, `int`, `Literal["frente", "tras"]`, `Distance` — o texto é o
 * que interessa, e a informação semântica (número, enum, medida) é decidida
 * depois, na camada semântica. Os colchetes de `Literal[...]` são
 * respeitados para que a vírgula dentro deles não feche a anotação.
 */
function lerAnotacao(parser) {
  const partes = [];
  let colchete = 0;
  let parenteses = 0;

  /*
   * Termina em `=`, `,` ou `)` no nível de fora. O `Literal["a", "b"]`
   * continua por causa do colchete: a vírgula dentro dele não encerra.
   */
  while (parser.peek()) {
    const token = parser.peek();
    const fecha = colchete === 0 && parenteses === 0;
    if (fecha && (token.value === "," || token.value === "=" || token.value === ")")) break;
    if (token.value === "[") colchete += 1;
    if (token.value === "]") colchete -= 1;
    if (token.value === "(") parenteses += 1;
    if (token.value === ")") parenteses -= 1;
    partes.push(parser.next().value);
  }
  return partes.join("") || null;
}

function splitTopLevel(tokens) {
  const partes = [];
  let atual = [];
  let profundidade = 0;
  for (const token of tokens) {
    if (token.value === "(" || token.value === "[" || token.value === "{") profundidade += 1;
    if (token.value === ")" || token.value === "]" || token.value === "}") profundidade -= 1;
    if (token.value === "," && profundidade === 0) {
      partes.push(atual);
      atual = [];
      continue;
    }
    atual.push(token);
  }
  partes.push(atual);
  return partes;
}

const COMPOUND_HEADS = ["if", "elif", "else", "for", "while", "def", "class", "try", "except", "finally", "with", "async", "match", "case"];

/** Mede a indentação em colunas (tab = 4). */
export function indentOf(line) {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns += 1;
    else if (char === "\t") columns += 4;
    else break;
  }
  return columns;
}

/** Junta continuação de linhas (parênteses/aspas abertas, barra no fim). */
function joinLogicalLines(sourceLines) {
  const logical = [];
  let buffer = null;

  /*
   * DOCSTRING DE VÁRIAS LINHAS.
   *
   * Uma docstring é a fonte semântica mais rica que existe sem metadado:
   * ela diz a unidade, o que o sinal significa e o que cada argumento faz.
   * O tokenizador trabalha linha a linha, então a abertura `"""` ficava sem
   * fechamento e a linha inteira era descartada com "unterminated string" —
   * a docstring (e toda a informação dela) simplesmente sumia.
   *
   * A string tripla é unida antes da análise normal e entregue como um
   * único token de texto, que o parser entende como `docstring`.
   */
  let emDocstring = false;
  let delimitadorDocstring = "";

  sourceLines.forEach((raw, index) => {
    const lineNo = index + 1;

    if (emDocstring) {
      const fecha = raw.indexOf(delimitadorDocstring);
      if (fecha === -1) {
        buffer = buffer ? { ...buffer, text: `${buffer.text}\n${raw}` } : { text: raw, line: lineNo, endLine: lineNo, indent: indentOf(raw), depth: 0, isDocstring: true };
        buffer.endLine = lineNo;
        return;
      }
      emDocstring = false;
      const antes = fecha === 0 ? "" : raw.slice(0, fecha);
      const depois = raw.slice(fecha + delimitadorDocstring.length).trim();
      logical.push({
        text: `${buffer?.text ?? ""}${antes}`.trim(),
        line: buffer?.line ?? lineNo,
        endLine: lineNo,
        indent: indentOf(raw),
        isDocstring: true,
      });
      if (depois) {
        logical.push({ text: depois, line: lineNo, endLine: lineNo, indent: indentOf(raw) });
      }
      buffer = null;
      return;
    }

    const abre = raw.match(/("""|\'\'\')/);
    if (abre && !raw.slice(abre.index + abre[0].length).includes(abre[0])) {
      delimitadorDocstring = abre[0];
      if (raw.indexOf(delimitadorDocstring, abre.index + delimitadorDocstring.length) === -1) {
        emDocstring = true;
        buffer = { text: raw.slice(abre.index), line: lineNo, endLine: lineNo, indent: indentOf(raw), depth: 0, isDocstring: true };
        return;
      }
    }

    if (buffer) {
      buffer.text += ` ${raw.trim()}`;
      buffer.endLine = lineNo;
      buffer.depth += depthDelta(raw);
      if (buffer.depth <= 0 && !/\\$/.test(raw.trim())) {
        logical.push(buffer);
        buffer = null;
      }
      return;
    }
    if (!raw.trim()) return;
    if (raw.trim().startsWith("#")) {
      logical.push({ text: raw, line: lineNo, endLine: lineNo, indent: indentOf(raw), comment: true });
      return;
    }
    const depth = depthDelta(raw);
    if (depth > 0 || /\\$/.test(raw.trim())) {
      buffer = { text: raw.replace(/\\\s*$/, ""), line: lineNo, endLine: lineNo, indent: indentOf(raw), depth };
      return;
    }
    logical.push({ text: raw, line: lineNo, endLine: lineNo, indent: indentOf(raw) });
  });
  if (buffer) logical.push(buffer);
  return logical;
}

function depthDelta(text) {
  let depth = 0;
  let inString = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") { i += 1; continue; }
      if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'") { inString = char; continue; }
    if (char === "#") break;
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
  }
  return depth;
}

/**
 * Parseia uma linha lógica em um nó de IR de statement.
 * Nunca lança: devolve { node } ou { node: null, error }.
 */
export function parseStatement(logical) {
  const text = logical.text.trim();
  const line = logical.line;
  const indent = logical.indent;
  const baseSource = { startLine: line, startColumn: indent, endLine: logical.endLine ?? line, endColumn: indent + text.length };

  if (logical.comment) {
    return { node: { type: "comment", text, source: baseSource }, error: null };
  }

  /*
   * DOCSTRING já unida por `joinLogicalLines`. Ela não passa pelo
   * tokenizador de propósito: o tokenizador é linha-a-linha e só enxerga
   * triplas na mesma linha. Aqui o texto vem inteiro, com as quebras
   * preservadas, que é o que a análise semântica precisa ler.
   */
  if (logical.isDocstring) {
    const bruto = String(logical.text ?? "");
    const conteudo = bruto.replace(/^("""|\'\'\')/, "");
    const linhas = conteudo.split("\n").map((l) => l.trim()).filter(Boolean);
    return { node: { type: "docstring", text: conteudo, lines: linhas, source: baseSource }, error: null };
  }

  const { tokens, error } = tokenizeLine(text);
  if (error) {
    return { node: null, error: { ...error, line, column: indent + error.column } };
  }

  const first = tokens[0];
  const parser = new ExpressionParser(tokens, line);

  /* ---- import / from ... import ---- */
  if (first?.value === "import") {
    parser.next();
    const names = [];
    do {
      let name = parser.next()?.value ?? "";
      while (parser.at(".")) { parser.next(); name += `.${parser.next()?.value ?? ""}`; }
      let alias = null;
      if (parser.eat("as")) alias = parser.next()?.value ?? null;
      names.push({ name, alias, source: baseSource });
    } while (parser.eat(","));
    return { node: { type: "import", names, source: baseSource }, error: null };
  }

  if (first?.value === "from") {
    parser.next();
    let module = parser.next()?.value ?? "";
    while (parser.at(".")) { parser.next(); module += `.${parser.next()?.value ?? ""}`; }
    parser.eat("import");
    const names = [];
    if (parser.at("(")) parser.next();
    do {
      const name = parser.next()?.value ?? "";
      let alias = null;
      if (parser.eat("as")) alias = parser.next()?.value ?? null;
      names.push({ name, alias, source: baseSource });
    } while (parser.eat(","));
    parser.eat(")");
    return { node: { type: "importFrom", module, names, source: baseSource }, error: null };
  }

  /* ---- def / class ---- */
  if (first?.value === "def" || first?.value === "class") {
    const kind = parser.next().value;
    const name = parser.next()?.value ?? "";
    const params = [];
    if (kind === "def" && parser.eat("(")) {
      /*
       * ASSINATURA COM ANOTAÇÃO DE TIPO.
       *
       * `def mover(distancia: float, velocidade: int = 300)` produzia DOIS
       * parâmetros: a anotação era lida como o nome seguinte. A assinatura
       * ficava errada — `mover` "recebia" um argumento chamado `float` — e
       * qualquer bloco construído a partir dela ficava errado junto.
       *
       * A anotação é lida até o `=` ou a vírgula, preservada como texto, e
       * `Literal["a", "b"]` fica inteira. É a informação que o conversor
       * precisa para escolher o controle visual.
       */
      while (parser.peek() && !parser.at(")")) {
        // `*args` e `**kwargs` da biblioteca, não parâmetros da função.
        if (parser.at("*") || parser.at("**")) {
          /*
           * `*args` e `**kwargs` são da biblioteca, não parâmetros da função.
           * O tokenizer emite `*` e `**` separados, então a estrela é
           * consumida e o nome vem em seguida — sem isso, `*` virava um
           * parâmetro chamado "asterisco" e o nome virava OUTRO.
           */
          const estrelas = parser.next().value;
          const nomeVar = parser.next()?.value ?? "args";
          params.push({
            name: nomeVar,
            variadic: estrelas === "*",
            variadicKeyword: estrelas === "**",
            default: null,
          });
          parser.eat(",");
          continue;
        }
        const nameToken = parser.next();
        let annotation = null;
        if (parser.eat(":")) annotation = lerAnotacao(parser);
        let defaultValue = null;
        if (parser.eat("=")) defaultValue = parser.parseExpression();
        if (nameToken?.type === "name") {
          params.push({
            name: nameToken.value, annotation, default: defaultValue,
            source: { startLine: line, startColumn: nameToken.start, endLine: line, endColumn: nameToken.end },
          });
        }
        parser.eat(",");
      }
      parser.eat(")");
    }
    if (!parser.at(":")) {
      return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
    }
    return {
      node: {
        type: kind === "def" ? "function" : "classDefinition",
        name, params, block: true, source: baseSource,
      },
      error: null,
    };
  }

  /* ---- for / while / if / elif / else / try / except / with ---- */
  if (first && COMPOUND_HEADS.includes(first.value)) {
    const head = parser.next().value;

    if (head === "else" || head === "finally") {
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: head === "else" ? "elseBranch" : "finallyBranch", block: true, source: baseSource }, error: null };
    }

    if (head === "for") {
      const targets = [];
      do { targets.push(parser.next()?.value ?? ""); } while (parser.eat(","));
      parser.eat("in");
      const iterable = parser.parseExpression();
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: "loop", kind: "for", targets, iterable, block: true, source: baseSource }, error: null };
    }

    if (head === "while") {
      const test = parser.parseExpression();
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: "loop", kind: "while", test, block: true, source: baseSource }, error: null };
    }

    if (head === "if" || head === "elif") {
      const test = parser.parseExpression();
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: "condition", kind: head, test, block: true, source: baseSource }, error: null };
    }

    if (head === "try") {
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: "tryStatement", block: true, source: baseSource }, error: null };
    }

    if (head === "except") {
      let exception = null;
      if (!parser.at(":")) exception = parser.parseExpression();
      let alias = null;
      if (parser.eat("as")) alias = parser.next()?.value ?? null;
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: "exceptBranch", exception, alias, block: true, source: baseSource }, error: null };
    }

    if (head === "with") {
      /*
       * `with EXPR as NOME` — o `as` é a parte que faltava.
       *
       * O item era lido como `parser.parseExpression()`, que consome
       * `open('a') as f` até o fim da linha e deixa o cursor no `:` sem
       * esperar — daí o "expected ':'" numa linha perfeitamente correta.
       * Como `as` é palavra-chave, ele também não podia ser tratado como
       * nome comum.
       */
      const items = [parser.parseWithItem()];
      while (parser.eat(",")) items.push(parser.parseWithItem());
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: "withStatement", items, block: true, source: baseSource }, error: null };
    }

    if (head === "async") {
      // async def / async for / async with — repassa removendo o prefixo
      return parseStatement({ ...logical, text: text.replace(/^async\s+/, "") });
    }

    if (head === "match" || head === "case") {
      const subject = parser.parseExpression();
      if (!parser.at(":")) return { node: null, error: { line, column: indent + text.length, message: "expected ':'" } };
      return { node: { type: head === "match" ? "matchStatement" : "caseBranch", subject, block: true, source: baseSource }, error: null };
    }
  }

  /*
   * DOCSTRING — a primeira string do corpo de uma função ou classe.
   *
   * É a fonte semântica mais rica que existe sem metadado: diz a unidade
   * de um parâmetro, o que o positivo significa, e o que cada argumento
   * faz. Sem ela, o conversor só tem o nome do parâmetro.
   *
   * A string precisa ser TIRADA do corpo: deixar a docstring como
   * statement fazia o Python regerado perder o texto e a anotação.
   */
  if (first?.type === "string") {
    const token = parser.next();
    const bruto = String(token.text ?? token.value ?? "");
    const m = bruto.match(/^[rRbBuUfF]*("""|\'\'\'|"|\')([\s\S]*?)\1$/);
    const conteudo = m ? m[2] : bruto;
    const linhas = conteudo.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      node: { type: "docstring", text: conteudo, lines: linhas, quote: m ? m[1] : '"', source: baseSource },
      error: null,
    };
  }

  /* ---- statements simples ---- */
  if (first?.value === "return") {
    parser.next();
    const value = parser.peek() ? parser.parseExpression() : null;
    return { node: { type: "return", value, source: baseSource }, error: null };
  }
  if (first?.value === "yield") {
    /*
     * `yield` é palavra-chave, mas não havia regra para ela. Sem esta, o
     * `yield 1` caía como expressão solta, o conversor não reconhecia e o
     * corpo da função virava `pass` — o gerador perdia o que produzia.
     */
    parser.next();
    const value = parser.peek() ? parser.parseExpression() : null;
    return { node: { type: "yield", value, source: baseSource }, error: null };
  }
  if (first?.value === "break") { parser.next(); return { node: { type: "break", source: baseSource }, error: null }; }
  if (first?.value === "continue") { parser.next(); return { node: { type: "continue", source: baseSource }, error: null }; }
  if (first?.value === "pass") { parser.next(); return { node: { type: "pass", source: baseSource }, error: null }; }
  if (first?.value === "raise") {
    parser.next();
    const value = parser.peek() ? parser.parseExpression() : null;
    return { node: { type: "raise", value, source: baseSource }, error: null };
  }
  if (first?.value === "del") {
    parser.next();
    const target = parser.parseExpression();
    return { node: { type: "delete", target, source: baseSource }, error: null };
  }
  if (first?.value === "global" || first?.value === "nonlocal") {
    parser.next();
    const names = [];
    do { names.push(parser.next()?.value ?? ""); } while (parser.eat(","));
    return { node: { type: first.value, names, source: baseSource }, error: null };
  }

  /* ---- atribuição / augmented / expressão ---- */
  const scan = scanAssignment(tokens);
  if (scan === "augmented") {
    const targetTokens = takeUntilAugmented(tokens);
    const opToken = tokens.find((t) => /^[+\-*/%@&|^]|\/\/|\*\*/.test(t.value) && t.value.endsWith("=")) ?? tokens[targetTokens.length];
    const targetParser = new ExpressionParser(targetTokens, line);
    const target = targetParser.parseExpression();
    const valueParser = new ExpressionParser(tokens.slice(tokens.indexOf(opToken) + 1), line);
    const value = valueParser.parseExpression();
    return {
      node: { type: "augmentedAssignment", operator: opToken.value, target, value, source: baseSource },
      error: null,
    };
  }
  if (scan === "assign") {
    const eqIndex = tokens.findIndex((token) => token.value === "=");
    const targetParser = new ExpressionParser(tokens.slice(0, eqIndex), line);
    /*
     * DESEMPACOTAMENTO: `a, b = 1, 2`.
     *
     * Só o primeiro alvo era lido, e `a, b = 1, 2` virava `a = 1` — o `b`
     * sumia do programa sem aviso. Quando há vírgula nos alvos, eles são
     * lidos um a um até o `=`; sem vírgula, é o caso comum de sempre.
     */
    const temVirgula = tokens.slice(0, eqIndex).some((token) => token.value === ",");
    const targets = [];
    if (temVirgula) {
      for (const parte of splitTopLevel(tokens.slice(0, eqIndex))) {
        if (!parte.length) continue;
        targets.push(new ExpressionParser(parte, line).parseExpression());
      }
    } else {
      targets.push(targetParser.parseExpression());
    }
    const direita = tokens.slice(eqIndex + 1);
    // `x = 1 +` e `x = = 1`: a linha está pela metade e precisa dizer isso.
    if (!direita.length) {
      return { node: null, error: { line, column: indent + text.length, message: "expected expression after '='" } };
    }
    let value;
    if (temVirgula) {
      /*
       * `a, b = 1, 2` — a direita é uma TUPLA, mesmo sem parênteses.
       * Ler só a primeira fazia `b` sumir do valor, e `a, b = 1` estoura
       * em tempo de execução. Os elementos continuam sendo expressões
       * independentes, cada uma com a sua própria árvore.
       */
      const elementos = splitTopLevel(direita)
        .filter((parte) => parte.length)
        .map((parte) => new ExpressionParser(parte, line).parseExpression());
      value = { type: "tuple", elements: elementos, parenthesized: false, source: baseSource };
    } else {
      value = new ExpressionParser(direita, line).parseExpression();
    }
    /*
     * VALOR PELA METADE.
     *
     * `x = 1 +` e `x = = 1` passavam sem aviso: a árvore vinha incompleta,
     * o bloco aparecia, o indicador dizia "sincronizado", e o SyntaxError
     * só apareceria no robô. Agora a linha incompleta é dita aqui, com a
     * posição, em vez de virar um programa que não roda.
     */
    if (ExpressionParser.incompleta(value)) {
      const onde = value?.source?.startColumn ?? indent + text.length;
      return { node: null, error: { line, column: onde, message: "incomplete expression" } };
    }
    return { node: { type: "assignment", targets, value, source: baseSource }, error: null };
  }

  const expression = parser.parseExpression();
  if (expression.type === "callExpression") {
    return { node: { type: "expressionStatement", expression, source: baseSource }, error: null };
  }
  return { node: { type: "expressionStatement", expression, source: baseSource }, error: null };
}

function scanAssignment(tokens) {
  let depth = 0;
  for (const token of tokens) {
    if (["(", "["].includes(token.value)) depth += 1;
    else if ([")", "]"].includes(token.value)) depth -= 1;
    if (depth === 0) {
      if (token.value === "=" ) return "assign";
      if (/^(\/\/=|\*\*=|[+\-*/%@&|^]=)$/.test(token.value)) return "augmented";
      if (token.value === ":" ) return null; // anotacao — trata como expressao
    }
  }
  return null;
}

function takeUntilAugmented(tokens) {
  const out = [];
  for (const token of tokens) {
    if (/^(\/\/=|\*\*=|[+\-*/%@&|^]=)$/.test(token.value)) break;
    out.push(token);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Árvore por indentação                                               */
/* ------------------------------------------------------------------ */

/**
 * Parse tolerante do programa inteiro.
 * @returns {{ ir: Array, diagnostics: Array, valid: boolean, partial: boolean }}
 */
export function parseProgram(code) {
  const source = String(code ?? "").replace(/\r\n?/g, "\n");
  const sourceLines = source.split("\n");
  const logicalLines = joinLogicalLines(sourceLines);

  const diagnostics = [];
  const flat = [];
  const root = { type: "program", body: [], source: { startLine: 1, startColumn: 0, endLine: sourceLines.length, endColumn: 0 } };
  const stack = [{ indent: -1, node: root }];

  for (const logical of logicalLines) {
    const { node, error } = parseStatement(logical);

    if (error) {
      diagnostics.push({
        severity: "error", line: error.line, column: error.column,
        endLine: error.line, endColumn: (error.column ?? 1) + 4,
        code: error.message, message: error.message,
      });
      continue; // B14: as outras linhas continuam
    }
    if (!node) continue;

    // Indentação inesperada
    while (stack.length > 1 && logical.indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;

    if (logical.indent > stack[stack.length - 1].indent && !parent.block && parent.type !== "program") {
      diagnostics.push({
        severity: "error", line: logical.line, column: logical.indent + 1,
        endLine: logical.line, endColumn: logical.indent + logical.text.trim().length,
        code: "unexpected indent", message: "unexpected indent",
      });
    }

    node.indent = logical.indent;
    node.body = node.body ?? [];
    parent.body.push(node);
    flat.push(node);

    if (node.block) stack.push({ indent: logical.indent, node });
  }

  // "expected an indented block" — cabeça composta sem corpo
  for (const node of flat) {
    if (node.block && node.body.length === 0 && !["elseBranch", "finallyBranch", "exceptBranch"].includes(node.type)) {
      diagnostics.push({
        severity: "error", line: node.source.endLine, column: 1,
        endLine: node.source.endLine, endColumn: 1,
        code: "expected an indented block", message: "expected an indented block",
      });
    }
  }

  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);

  return {
    ir: root,
    flat,
    diagnostics,
    lines: sourceLines,
    valid: diagnostics.filter((d) => d.severity === "error").length === 0,
    partial: diagnostics.length > 0 && flat.length > 0,
  };
}

export default parseProgram;

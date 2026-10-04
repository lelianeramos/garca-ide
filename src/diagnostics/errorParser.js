/**
 * DIAGNÓSTICOS EM PORTUGUÊS — GARÇA DE BOTAS CODE STUDIO
 * ------------------------------------------------------
 * Anexo B: nenhuma mensagem técnica crua chega ao usuário.
 * Parte 17.2: erro sempre com Arquivo / Linha / Coluna / Causa / Sugestão.
 *
 * "Erro é informação, não bloqueio" (Parte 1.5). Um erro nunca apaga blocos
 * nem gera null — apenas sublinha a linha e explica (B01, B14).
 */

/** Tradução das mensagens do ast.parse() e do parser tolerante interno. */
const TRANSLATIONS = [
  {
    test: /expected ':'|expected ‘:’/i,
    cause: 'Falta ":" no final da instrução.',
    suggestion: 'Adicione ":" após a condição do "if", "for", "while", "def" ou "class".',
  },
  {
    test: /unexpected indent/i,
    cause: "Esta linha tem uma indentação inesperada.",
    suggestion: "Remova os espaços no começo da linha ou coloque-a dentro do bloco anterior.",
  },
  {
    test: /unindent does not match/i,
    cause: "A indentação desta linha não corresponde ao bloco anterior.",
    suggestion: "Use sempre 4 espaços. Não misture tab com espaço.",
  },
  {
    test: /expected an indented block/i,
    cause: "Adicione uma linha indentada dentro deste bloco.",
    suggestion: "Escreva o que o bloco faz com 4 espaços no começo, ou use \"pass\".",
  },
  {
    test: /(\(|\[|\{).*was never closed|was never closed/i,
    cause: "Há um parêntese, colchete ou chave que não foi fechado.",
    suggestion: "Feche com \")\", \"]\" ou \"}\" na mesma linha.",
  },
  {
    test: /unterminated string/i,
    cause: "O texto entre aspas não foi fechado.",
    suggestion: 'Coloque aspas iguais no início e no fim: "texto".',
  },
  {
    test: /invalid syntax/i,
    cause: "A instrução está incompleta ou fora de ordem.",
    suggestion: "Verifique se faltou um operador, um parêntese ou um dois-pontos.",
  },
  {
    test: /invalid decimal literal/i,
    cause: "Este número está escrito de forma inválida.",
    suggestion: 'Use ponto para decimais no Python: 3.14 (na interface você pode digitar 3,14).',
  },
  {
    test: /unexpected character after line continuation/i,
    cause: "Há um caractere depois da barra de continuação.",
    suggestion: 'A "\\" precisa ser o último caractere da linha.',
  },
  {
    test: /EOL while scanning string literal/i,
    cause: "O texto entre aspas não foi fechado nesta linha.",
    suggestion: 'Feche as aspas antes do fim da linha.',
  },
  {
    test: /invalid tab-space combination|tabs? .{0,20}spaces/i,
    cause: "A linha mistura tabulação com espaços.",
    suggestion: "Converta as tabulações em 4 espaços.",
  },
  {
    test: /cannot assign to|invalid assignment target/i,
    cause: "Não é possível atribuir um valor a isto.",
    suggestion: "O lado esquerdo do \"=\" precisa ser uma variável.",
  },
  {
    test: /duplicate argument/i,
    cause: "O mesmo argumento aparece duas vezes na função.",
    suggestion: "Deixe cada parâmetro uma única vez.",
  },
  {
    test: /'return' outside function/i,
    cause: '"return" está fora de uma função.',
    suggestion: 'Use "return" somente dentro de um "def".',
  },
  {
    test: /'break' outside loop/i,
    cause: '"break" está fora de um laço.',
    suggestion: 'Use "break" somente dentro de "for" ou "while".',
  },
  {
    test: /'continue' not properly in loop/i,
    cause: '"continue" está fora de um laço.',
    suggestion: 'Use "continue" somente dentro de "for" ou "while".',
  },
  {
    test: /keyword can't be an expression|invalid keyword argument/i,
    cause: "O nome do argumento é inválido.",
    suggestion: "Use um nome de variável antes do \"=\", sem aspas.",
  },
  {
    test: /positional argument follows keyword argument/i,
    cause: "Um argumento sem nome veio depois de um argumento nomeado.",
    suggestion: "Coloque primeiro os argumentos sem nome (motor.run(300)) e depois os nomeados (wait=True).",
  },
  {
    test: /non-default argument follows default argument/i,
    cause: "Um parâmetro obrigatório veio depois de um parâmetro com valor padrão.",
    suggestion: 'Coloque os parâmetros com "= valor" no fim da lista.',
  },
  {
    test: /closing parenthesis/i,
    cause: "O fechamento não corresponde à abertura.",
    suggestion: 'Se abriu com "(", feche com ")".',
  },
];

/** Erros de execução/tempo de análise semântica. */
const SEMANTIC_TRANSLATIONS = [
  {
    test: /NameError: name '([\w]+)' is not defined/i,
    cause: (match) => `Não encontrei "${match[1]}".`,
    suggestion: (match, similar) =>
      similar ? `Você quis dizer "${similar}"?` : "Crie a variável antes de usá-la.",
  },
  {
    test: /ModuleNotFoundError.*?'([\w.]+)'|No module named '([\w.]+)'/i,
    cause: (match) => `Não existe o arquivo ${(match[1] || match[2]).split(".").pop()}.py neste projeto.`,
    suggestion: "Crie o arquivo no explorador ou corrija o nome no import.",
  },
  {
    test: /ImportError: cannot import name '([\w]+)'/i,
    cause: (match) => `O módulo existe, mas não define "${match[1]}".`,
    suggestion: "Confira o nome da função no arquivo de origem.",
  },
  {
    test: /AttributeError.*?'([\w]+)' object has no attribute '([\w]+)'/i,
    cause: (match) => `"${match[1]}" não tem o método "${match[2]}".`,
    suggestion: (match, similar) =>
      similar ? `Você quis dizer "${similar}"?` : "Veja o autocomplete depois do ponto.",
  },
  {
    test: /TypeError.*?(\d+) positional arguments?/i,
    cause: "O número de argumentos não confere.",
    suggestion: "Confira a assinatura mostrada no autocomplete.",
  },
  {
    test: /IndentationError/i,
    cause: "A indentação desta linha está errada.",
    suggestion: "Use múltiplos de 4 espaços.",
  },
];

/**
 * Traduz um diagnóstico técnico para português.
 * @param {{message:string, line:number, column:number, severity?:string, code?:string}} diagnostic
 * @param {object} extra { file, similar }
 */
export function explain(diagnostic, extra = {}) {
  const message = String(diagnostic?.message ?? diagnostic?.code ?? "");
  const file = extra.file;

  for (const rule of SEMANTIC_TRANSLATIONS) {
    const match = rule.test.exec(message);
    if (!match) continue;
    return format({
      file,
      line: diagnostic.line,
      column: diagnostic.column,
      severity: diagnostic.severity ?? "error",
      cause: typeof rule.cause === "function" ? rule.cause(match) : rule.cause,
      suggestion: typeof rule.suggestion === "function" ? rule.suggestion(match, extra.similar) : rule.suggestion,
      raw: message,
    });
  }

  for (const rule of TRANSLATIONS) {
    if (!rule.test.test(message)) continue;
    return format({
      file,
      line: diagnostic.line,
      column: diagnostic.column,
      severity: diagnostic.severity ?? "error",
      cause: typeof rule.cause === "function" ? rule.cause(message) : rule.cause,
      suggestion: typeof rule.suggestion === "function" ? rule.suggestion(message) : rule.suggestion,
      raw: message,
    });
  }

  // Mensagem desconhecida: mostra o texto original, mas formatado com contexto.
  return format({
    file,
    line: diagnostic.line,
    column: diagnostic.column,
    severity: diagnostic.severity ?? "error",
    cause: message || "Erro desconhecido no código.",
    suggestion: extra.similar ? `Você quis dizer "${extra.similar}"?` : "",
    raw: message,
  });
}

/** Monta o texto de 5 linhas exigido pela Parte 17.2. */
function format({ file, line, column, severity, cause, suggestion, raw }) {
  const parts = [];
  if (file) parts.push(`Arquivo:  ${file}`);
  if (line) parts.push(`Linha:    ${line}${column ? `    Coluna: ${column}` : ""}`);
  if (cause) parts.push(`Causa:    ${cause}`);
  if (suggestion) parts.push(`Sugestão: ${suggestion}`);
  return {
    severity,
    line: line ?? 1,
    column: column ?? 1,
    file: file ?? null,
    cause: cause ?? "",
    suggestion: suggestion ?? "",
    raw: raw ?? "",
    text: parts.join("\n"),
    /** versão curta de uma linha, para a régua/tooltip */
    short: cause || raw || "Erro no código",
  };
}

/**
 * Sugere a correção mais próxima dentro de uma lista de nomes válidos.
 * Baseado em similaridade (mesma ideia do difflib, cutoff 0.84 — Parte 16.1.10).
 */
export function suggestName(name, candidates, cutoff = 0.84) {
  if (!name || !candidates?.length) return null;
  let best = null;
  let bestScore = 0;
  const target = String(name).toLowerCase();

  for (const candidate of candidates) {
    const score = similarity(target, String(candidate).toLowerCase());
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore >= cutoff ? best : null;
}

/** Similaridade de Ratcliff/Obershelp (mesma métrica do difflib.SequenceMatcher). */
export function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const total = a.length + b.length;
  return (2 * matchingCharacters(a, b)) / total;
}

function matchingCharacters(a, b) {
  if (!a || !b) return 0;
  let bestStart = 0; let bestA = 0; let bestSize = 0;
  for (let startA = 0; startA < a.length; startA += 1) {
    for (let startB = 0; startB < b.length; startB += 1) {
      let size = 0;
      while (
        startA + size < a.length &&
        startB + size < b.length &&
        a[startA + size] === b[startB + size]
      ) size += 1;
      if (size > bestSize) { bestSize = size; bestA = startA; bestStart = startB; }
    }
  }
  if (bestSize === 0) return 0;
  return (
    bestSize +
    matchingCharacters(a.slice(0, bestA), b.slice(0, bestStart)) +
    matchingCharacters(a.slice(bestA + bestSize), b.slice(bestStart + bestSize))
  );
}

/** Nomes de erro extraídos de uma mensagem, para casar com sugestões. */
export function extractUnknownName(message) {
  const match = /name '([\w]+)' is not defined|has no attribute '([\w]+)'/.exec(String(message ?? ""));
  return match?.[1] ?? match?.[2] ?? null;
}

export default { explain, suggestName, similarity, extractUnknownName };

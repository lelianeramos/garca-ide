/* ================================================================== */
/* LEITURA DE DOCSTRING                                               */
/* ================================================================== */
/*
 * POR QUE ISTO EXISTE
 *
 * Uma docstring escrita por quem criou a biblioteca é a fonte semântica
 * mais rica que existe sem metadado. Ela diz o que o bloco não tem como
 * saber sozinho:
 *
 *     """Move o robô em linha reta.
 *
 *     Args:
 *         distancia: quanto o robô anda, em milímetros.
 *                    positivo para frente, negativo para trás.
 *         velocidade: em milímetros por segundo.
 *     """
 *
 * Dela saem três coisas que o catálogo sozinho nunca teria:
 *   1. a UNIDADE do campo        ("milímetros")
 *   2. o SIGNIFICADO DO SINAL    ("positivo = frente")
 *   3. o PAPEL do campo          ("velocidade" -> speed)
 *
 * Isto NÃO é regex como parser. A leitura é feita por SEÇÃO e por CAMPO,
 * no estilo Google/NumPy/Sphinx: quando a docstring segue uma convenção
 *_debugue, a convenção é respeitada campo a campo. Frase solta não gera
 * campo nenhum — no máximo uma pista fraca, marcada como tal.
 */

/* Seções de argumentos, nas convenções que aparecem em biblioteca real. */
const SECOES_ARGS = [
  "args", "arguments", "argumentos", "parametros", "parâmetros",
  "parameters", "params", "signature", "assinatura",
];

const SECOES_RETORNO = ["returns", "return", "retorna", "retorno", "yields"];

/* Sinais linguísticos de "aqui começa a lista de campos". */
/*
 * Palavras que abrem uma NOTA, não um campo. Têm dois-pontos como as
 * outras, então sem esta lista "Nota: use com cuidado." viraria um
 * argumento chamado `Nota` e apareceria no bloco como se fosse da função.
 */
const NAO_E_CAMPO = new Set([
  "nota", "notas", "note", "notes", "atencao", "cuidado", "cuidados",
  "importante", "exemplo", "examples", "observacao", "observacoes",
  "aviso", "dica", "retorno", "uso", "veja", "ver", "todo", "detalhe",
  "description", "descricao", "descricoes",
]);

const MARCA_CAMPO = [
  "args", "arguments", "argumentos", "parâmetros", "parametros",
  "parameters", "params", "fields", "campos", "opcoes", "opções",
];

/**
 * Lê a docstring de uma função e devolve o que se pode saber sem executar.
 *
 * `nomesConhecidos` são os parâmetros reais da função. Eles resolvem a
 * ambiguidade entre "campo" e "frase": um nome que bate com um parâmetro é
 * campo, mesmo escrito com maiúscula; sem essa checagem, a frase
 * "Cuidado: pode colidir." virava um campo chamado `Cuidado`.
 *
 * @param {{text?: string, lines?: string[]}|null|string} docstring
 * @param {{nomesConhecidos?: string[]}} [opcoes]
 * @returns {{
 *   resumo: string,
 *   campos: Record<string, CampoDoc>,
 *   secoes: string[],
 * }}
 */
export function lerDocstring(docstring, { nomesConhecidos = [] } = {}) {
  const linhas = normalizarLinhas(docstring);
  const vazio = { resumo: "", campos: {}, secoes: [] };
  const conhecidos = new Set(nomesConhecidos.map((n) => String(n).replace(/^\*+/, "")));

  if (linhas.length === 0) return vazio;

  const { resumo, corpo, secoes } = separarSecoes(linhas, conhecidos);

  const campos = {};
  for (const linha of corpo) {
    const campo = lerLinhaCampo(linha, campos);
    if (campo) Object.assign(campos, campo);
  }

  return { resumo, campos: casarComParametros(campos, conhecidos), secoes };
}

/**
 * Reescreve as chaves dos campos para o NOME REAL do parâmetro.
 *
 * A docstring escreve `Distancia:` com maiúscula e `velocidade:` sem; se a
 * chave ficasse como apareceu, a busca por `distancia` não acharia nada e o
 * bloco perderia a unidade e o sentido do sinal. Casar sem diferenciar caixa
 * é o que une a documentação à assinatura.
 */
function casarComParametros(campos, conhecidos) {
  if (conhecidos.size === 0) return campos;

  const canonicos = new Map();
  for (const nome of conhecidos) canonicos.set(nome.toLowerCase(), nome);

  const saida = {};
  for (const [chave, campo] of Object.entries(campos)) {
    const real = canonicos.get(chave.toLowerCase()) ?? chave;
    saida[real] = { ...campo, nome: real };
  }
  return saida;
}

/** Aceita string solta, objeto com `lines` ou objeto com `text`. */
function normalizarLinhas(docstring) {
  if (!docstring) return [];
  if (typeof docstring === "string") {
    return docstring.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  if (Array.isArray(docstring.lines) && docstring.lines.length) {
    return docstring.lines.map((l) => String(l).trim()).filter(Boolean);
  }
  const texto = String(docstring.text ?? "");
  return texto.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Separa o resumo (antes da primeira seção) do corpo documentado.
 *
 * Sem isto, a linha "Move o robô em linha reta." seria lida como se fosse
 * a descrição de um campo chamado "Move" — que é o tipo de ruído que faz
 * um catálogo inventar控件 que não existem.
 */
function separarSecoes(linhas, conhecidos = new Set()) {
  const resumo = [];
  const corpo = [];
  const secoes = [];
  let dentroDeSecao = false;
  let secaoAtual = "";

  for (const linha of linhas) {
    const titulo = tituloSecao(linha);

    if (titulo) {
      /*
       * "Args:" e "Returns:" são cabeçalhos e a seção vale DEPOIS deles.
       *
       * Um título que aparece no MEIO do corpo encerra a seção anterior:
       * `Returns: nada` escrito logo depois dos argumentos e retorno, nao mais
       * um argumento chamado `Returns` — e `lenhaTitulo` devolve o título
       * já normalizado, então comparar direto é seguro.
       */
      secoes.push(titulo);
      secaoAtual = titulo;
      dentroDeSecao = SECOES_ARGS.includes(titulo);
      continue;
    }

    if (dentroDeSecao) {
      corpo.push(linha);
      continue;
    }

    // Sem seção declarada, uma linha "campo:" ainda abre lista de campos.
    if (temMarcaDeCampo(linha)) {
      dentroDeSecao = true;
      secaoAtual = "campos";
      corpo.push(linha);
      continue;
    }

    /*
     * Docstring SEM seção declarada é comum: muita biblioteca escreve
     *
     *     Move o robô.
     *     distancia: em milímetros.
     *     velocidade: em mm/s.
     *
     * Sem este ramo o catálogo não achava NENHUM campo e a função caía no
     * genérico — que é o que o projeto quer evitar. A regra é deliberada:
     * uma linha vira campo quando TEM dois-pontos, nome limpo no começo e
     * não é frase corrida. Frase continua no resumo.
     */
    if (!dentroDeSecao && pareceCampoSolto(linha, conhecidos)) {
      dentroDeSecao = true;
      secaoAtual = "campos";
      corpo.push(linha);
      continue;
    }

    resumo.push(linha);
  }

  return { resumo: resumo.join(" ").trim(), corpo, secoes };
}

/** `true` para "Args:", "Parâmetros", "Returns" (com ou sem dois-pontos). */
function tituloSecao(linha) {
  const limpa = linha.replace(/:+\s*$/, "").toLowerCase().trim();
  const todas = [...SECOES_ARGS, ...SECOES_RETORNO];
  if (!todas.includes(limpa)) return null;
  return limpa;
}

/**
 * `true` para uma linha que documenta UM campo sem seção declarada.
 *
 * Exige nome de identificador ANTES do dois-pontos e texto depois. É o que
 * separa "distancia: em milímetros" (campo) de "Move o robô: devagar."
 * (frase) — os dois têm dois-pontos, só um tem nome de campo na frente.
 */
function pareceCampoSolto(linha, conhecidos = new Set()) {
  const m = String(linha).match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\S.*)$/);
  if (!m) return false;

  const nome = m[1];
  const minusculo = SECOES_ARGS.includes(nome.toLowerCase());
  if (minusculo) return false;
  if (SECOES_RETORNO.includes(nome.toLowerCase())) return false;
  if (NAO_E_CAMPO.has(normalizarTexto(nome))) return false;

  // Bate com um parâmetro real? Então é campo, ponto final.
  if (conhecidos.has(nome)) return true;

  /*
   * Sem correspondência, exige identificador MINÚSCULO. É a convenção do
   * Python e separa campo de frase de forma barata e sem lista de stopwords:
   * `distancia:` passa, `Cuidado:` e `Atenção:` não.
   */
  return /^[a-z_][a-z0-9_]*$/.test(nome);
}

/** `true` quando a linha abre/continua uma lista de campos. */
function temMarcaDeCampo(linha) {
  const m = String(linha).match(/^([A-Za-z_][A-Za-z0-9_]*|\*{1,2}[A-Za-z_][A-Za-z0-9_]*)\s*:/);
  if (!m) return false;
  return MARCA_CAMPO.includes(m[1].toLowerCase());
}

/**
 * Lê UMA linha da seção de campos e devolve o que ela acrescenta.
 *
 * A forma reconhecida é `nome: descrição`. A continuação (indentação ou
 * linhas seguintes) é tratada por quem chama, empilhando em `campos`.
 */
function lerLinhaCampo(linha, campos) {
  const m = String(linha).match(/^(\*{0,2}[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
  if (!m) {
    /*
     * Sem "nome:", esta linha é CONTINUAÇÃO do campo anterior. Anexar é o
     * que faz "positivo para frente" (na linha seguinte) chegar ao campo
     * `distancia` em vez de virar lixo solto.
     */
    const anterior = Object.keys(campos).pop();
    if (!anterior) return null;
    if (/^[A-Z]{2,}\w*:/.test(linha)) return null; // já é uma subseção
    campos[anterior].descricao = [campos[anterior].descricao, linha].filter(Boolean).join(" ").trim();
    return { [anterior]: campos[anterior] };
  }

  const nome = m[1].replace(/^\*+/, "");
  const descricao = String(m[2] ?? "").trim();

  /*
   * "Nota:" e "Exemplo:" têm a mesma forma de "distancia:". Dentro da
   * seção de argumentos, uma nota é texto sobre os campos, não um campo —
   * e tratá-la como campo colocaria `Nota` no bloco.
   */
  const chave = nome.toLowerCase();
  if (NAO_E_CAMPO.has(normalizarTexto(nome))) return null;
  if (SECOES_ARGS.includes(chave) || SECOES_RETORNO.includes(chave)) return null;

  const existente = campos[nome];
  const campo = existente
    ? { ...existente, descricao: [existente.descricao, descricao].filter(Boolean).join(" ").trim() }
    : { nome, descricao, linhas: [linha] };

  return { [nome]: campo };
}

/* ------------------------------------------------------------------ */
/* INTERPRETAÇÃO DO QUE A DESCRIÇÃO DIZ                                */
/* ------------------------------------------------------------------ */

/*
 * Estas leituras são sobre a FALA, não sobre a estrutura do código: a
 * docstring é linguagem natural e não tem como ser analisada sintaticamente
 * sem um parser de português. O que se faz é procurar os sinalizadores que
 * as bibliotecas usam de verdade e marcar o resultado como "inferido", com
 * a origem guardada — assim a prioridade entre fontes continua explícita.
 */

/** Palavras que indicam distância, em qualquer grafia. */
const PALAVRAS_DISTANCIA = ["distancia", "distance", "comprimento", "tamanho", "alcance", "recuo"];

/** Sinais de velocidade. */
const PALAVRAS_VELOCIDADE = ["velocidade", "speed", "rapidez", "ritmo"];

/** Sinais de ângulo. */
const PALAVRAS_ANGULO = ["angulo", "angle", "giro", "rotacao", "voltagem", "heading"];

/** Sinais de tempo. */
const PALAVRAS_TEMPO = ["tempo", "time", "duracao", "espera", "pausa", "atraso", "delay"];

/** Sinais de potência. */
const PALAVRAS_POTENCIA = ["potencia", "power", "forca", "esforco", "torque", "intensidade"];

/** Sinais de porta. */
const PALAVRAS_PORTA = ["porta", "port"];

/**
 * Papel semântico sugerido pela descrição de um campo.
 *
 * A prioridade aqui é: nome do campo > palavra na descrição. O nome é o
 * que o programador escolheu de propósito; a frase é pistas.
 */
export function papelDoCampo(nome, descricao = "") {
  const n = normalizarTexto(nome);
  const d = normalizarTexto(descricao);

  if (PALAVRAS_PORTA.some((p) => n === p || n.endsWith(p))) return "port";
  if (PALAVRAS_DISTANCIA.some((p) => n.includes(p) || d.includes(p))) return "distance";
  if (PALAVRAS_VELOCIDADE.some((p) => n.includes(p) || d.includes(p))) return "speed";
  if (PALAVRAS_ANGULO.some((p) => n.includes(p) || d.includes(p))) return "angle";
  if (PALAVRAS_TEMPO.some((p) => n.includes(p) || d.includes(p))) return "time";
  if (PALAVRAS_POTENCIA.some((p) => n.includes(p) || d.includes(p))) return "power";
  return null;
}

/**
 * Unidade de um campo, lida da própria descrição.
 *
 * Procura a unidade DEPOIS de um marcador de unidade ("em", "medida em",
 * "na unidade"), porque "em" é a palavra que a pessoa realmente usa:
 * "distância em milímetros". Sem o marcador, a busca aceitaria a primeira
 * palavra do texto e erraria com frequência.
 */
export function unidadeDoCampo(descricao = "") {
  const texto = normalizarTexto(descricao);
  if (!texto) return null;

  /*
   * Captura TUDO depois do marcador, não só a primeira palavra.
   *
   *     "em milímetros por segundo"  ->  precisa devolver a frase inteira
   *
   * Pegar só "milímetros" fazia uma velocidade virar comprimento — e a
   * conversão depois mandava 2 cm/s para o robô como se fossem 2 cm. Quem
   * decide se a frase inteira é uma unidade válida é `units.js`.
   */
  const marcador = texto.match(/(?:em|medida em|medido em|unidade(?: de)?|expresso em)\s+([^.,;]+)/);
  if (marcador) return marcador[1].trim();

  return null;
}

/**
 * O que o SINAL significa.
 *
 *     "positivo para frente, negativo para trás"
 *     "negativo move para trás, positivo move para frente"
 *     "use -1 para girar à direita"
 *
 * A leitura é feita por CLÁUSULA, não por uma expressão regular gigante.
 * A razão é prática: entre a polaridade e o rumo quase sempre há uma
 * palavra a mais ("negativo MOVE para trás"), e um padrão único erra
 * justamente quando a frase é natural. Separando em trechos e perguntando
 * "este trecho diz positivo? diz qual rumo?", cada caso cai em cima.
 *
 * O retorno traz os rótulos na ordem (negativo, positivo). Sem resposta,
 * é `null` — e o bloco mostra o número puro, que é a escolha honesta
 * quando não se sabe o significado.
 */
export function sentidoDoSinal(descricao = "") {
  const texto = normalizarTexto(descricao);
  if (!texto) return null;

  const negativo = rotuloDeRumo(texto, "negativ");
  const positivo = rotuloDeRumo(texto, "positiv");

  if (!negativo && !positivo) return null;
  return { negativo, positivo };
}

/**
 * O rumo dito na cláusula que carrega a POLARIDADE.
 *
 * Cada rumo possível tem as formas que o português realmente usa, com e
 * sem acento. Quem escreve "para tras" sem acento não pode ser ignorado.
 */
const RUMOS = [
  { texto: "tras", rotulo: "tras" },
  { texto: "re", rotulo: "tras" },
  { texto: "para tras", rotulo: "tras" },
  { texto: "de costas", rotulo: "tras" },
  { texto: "frente", rotulo: "frente" },
  { texto: "para frente", rotulo: "frente" },
  { texto: "a frente", rotulo: "frente" },
  { texto: "avancar", rotulo: "frente" },
  { texto: "avanco", rotulo: "frente" },
  { texto: "adiante", rotulo: "frente" },
  { texto: "direita", rotulo: "direita" },
  { texto: "para a direita", rotulo: "direita" },
  { texto: "a direita", rotulo: "direita" },
  { texto: "horario", rotulo: "horario" },
  { texto: "sentido horario", rotulo: "horario" },
  { texto: "esquerda", rotulo: "esquerda" },
  { texto: "para a esquerda", rotulo: "esquerda" },
  { texto: "a esquerda", rotulo: "esquerda" },
  { texto: "antiorario", rotulo: "antiorario" },
  { texto: "sentido antiorario", rotulo: "antiorario" },
];

function rotuloDeRumo(texto, polaridade) {
  for (const clausula of clauses(texto)) {
    if (!clausula.includes(polaridade)) continue;

    let melhor = null;
    for (const rumo of RUMOS) {
      if (!clausula.includes(rumo.texto)) continue;
      // O mais específico vence: "para tras" tem que ganhar de "tras".
      if (!melhor || rumo.texto.length > melhor.comprimento) {
        melhor = { rotulo: rumo.rotulo, comprimento: rumo.texto.length };
      }
    }
    if (melhor) return melhor.rotulo;
  }
  return null;
}

/**
 * Divide a descrição em trechos independentes.
 *
 * A quebra é por pontuação E por " e ". Sem o " e ", a frase
 * "positivo move para frente e negativo move para trás" cairia inteira num
 * trecho só e o primeiro rumo encontrado venceria os dois.
 */
function clauses(texto) {
  return texto
    .split(/[,;.\n]|\s+e\s+/g)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** `true` quando a descrição diz que o valor é um booleano. */
export function ehBooleano(descricao = "") {
  const d = normalizarTexto(descricao);
  return /\b(booleano|boolean|true ou false|verdadeiro ou falso|sim ou nao)\b/.test(d);
}

/**
 * Valores aceitos, quando a docstring lista um conjunto.
 *
 *     "use 'frente', 'tras' ou 'lateral'"
 *     "escolha entre: para frente, para trás"
 *
 * Sem lista explícita, retorna `null`. Inventar opções a partir do nome do
 * parâmetro é exatamente o tipo de chute que a IDE não pode fazer.
 */
export function opcoesDoCampo(descricao = "") {
  const texto = String(descricao ?? "");
  const entre = texto.match(/entre\s*[:\-]?\s*(.+)$/i);
  const use = texto.match(/\buse\s+(.+)$/i);
  const fonte = entre?.[1] ?? use?.[1] ?? null;
  if (!fonte) return null;

  const valores = [];
  const quoted = fonte.match(/["'`]([^"'`]+)["'`]/g);
  if (quoted && quoted.length >= 2) {
    for (const q of quoted) valores.push(q.replace(/["'`]/g, ""));
  } else {
    for (const parte of fonte.split(/,|\s+ou\s+/i)) {
      const limpa = parte.trim().replace(/[.;]$/, "");
      if (limpa && limpa.length <= 24) valores.push(limpa);
    }
  }
  return valores.length >= 2 ? valores : null;
}

/** Texto minúsculo, sem acento, para comparação. */
function normalizarTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
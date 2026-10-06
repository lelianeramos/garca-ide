/* ================================================================== */
/* IR DE CHAMADA SEMÂNTICA                                             */
/* ================================================================== */
/*
 * ESTE É O CORAÇÃO DA IDE: onde `gb_move(gb, hub, -100)` vira
 *
 *     mover  [para trás]  [100]  [mm]
 *
 * e volta. Os dois sentidos são feitos aqui, no MESMO lugar, porque é a
 * única forma de garantir que going e coming usam exatamente as mesmas
 * regras. Se fossem dois lugares, o round-trip abriria espaço para a
 * diferença aparecer — e ela sempre aparece.
 *
 * TRÊS VALORES, NÃO UM
 *
 *     valorVisual     o que está escrito     "10"
 *     unidadeVisual   o que está escolhido   "cm"
 *     valorEnviado    o que vai ao Python    "100"
 *
 * Guardar os três explicitamente é o que fecha o ciclo. Reduzir a dois
 * (valor + unidade) obriga a reconstruir um dos três toda vez, e aí nasce
 * o bug de conversão dupla.
 *
 * EXPRESSÕES NÃO SÃO NÚMEROS
 *
 *     gb_move(gb, hub, distancia)
 *     gb_move(gb, hub, distancia * 2)
 *
 * Nos dois casos o valor visual NÃO é um número, é texto de expressão. A
 * direção, nesse caso, é INDETERMINADA — e o bloco mostra a variável sem
 * inventar "para frente". Um `-1` no início é a única coisa que se pode
 * afirmar sobre `distancia * 2`, e isso não chega para dizer o sentido.
 */

import { convert, formatarVisual, paraNumero, rotuloUnidade, unidadesPara } from "./units.js";
import { textoDoPadrao } from "./functionSchema.js";
import { alvoDeChamada, formaDeEscrita } from "./moduleResolver.js";
import { valorParaTexto } from "./expressionText.js";

/* ------------------------------------------------------------------ */
/* Python -> IR semântico                                              */
/* ------------------------------------------------------------------ */

/**
 * Constrói o IR semântico de uma chamada a partir do nó da AST.
 *
 * @param {object} node        nó `callExpression` do IR
 * @param {FunctionSchema} schema
 * @param {object} contexto    { aliases, forma, valoresPadrao }
 * @returns {SemanticCall|null}
 */
export function chamadaParaIR(node, schema, contexto = {}) {
  if (!node || !schema) return null;

  const alvo = textoDoAlvo(node);
  const normalizado = alvoDeChamada(alvo, contexto.aliases ?? {});
  const posicoes = posicoesDosArgumentos(node, schema);

  const argumentos = schema.todosCampos.map((campo) => {
    const posicao = posicoes.get(campo.nome);

    /* ---- Sem valor: usa o default da assinatura ---- */
    if (!posicao) {
      return {
        nome: campo.nome,
        campo: campo.nome,
        presente: false,
        /*
         * `ausente` é distinto de `padrao` de propósito: `ausente` some da
         * geração, `padrao` é escrito quando a função precisa dele. Confundir
         * os dois acrescentaria argumentos que a criança não escreveu.
         */
        forma: "ausente",
        texto: null,
        padrao: textoDoPadrao(campo.padrao),
        visivel: !campo.oculto,
      };
    }

    const item = posicao.item;
    const texto = textoDoValor(item.value);

    /* ---- Valor literal: cabe em campo simples ---- */
    const numerico = paraNumero(texto);

    return {
      nome: campo.nome,
      campo: campo.nome,
      presente: true,
      forma: item.forma ?? "posicional",
      /** O texto EXATO do Python, para o round-trip ser fiel. */
      texto,
      literal: numerico,
      valor: item.value ?? null,
      visivel: !campo.oculto,
    };
  });

  return {
    tipo: "semanticCall",
    modulo: normalizado?.modulo ?? schema.modulo ?? "",
    funcao: schema.nome,
    /** Nome como aparece no arquivo, incluindo alias. */
    nomeNoArquivo: alvo,
    forma: formaDeEscrita(alvo, contexto.aliases ?? {}),
    argumentos,
    /** Campos que não couberam num controle e precisam de aviso. */
    naoRepresentaveis: schema.naoRepresentaveis.map((c) => c.nome),
  };
}

/* ------------------------------------------------------------------ */
/* IR semântico -> Python                                              */
/* ------------------------------------------------------------------ */

/**
 * Gera o Python de uma chamada a partir do IR semântico.
 *
 * A ordem aqui é a ordem da assinatura — sempre. Os ocultos entram na
 * posição original, e é por isso que `gb`, que é o primeiro parâmetro,
 * sai como primeiro argumento mesmo estando escondido na tela.
 */
export function irParaChamada(ir, schema, opcoes = {}) {
  if (!ir) return "";

  const nome = opcoes.forcarNome ?? ir.nomeNoArquivo ?? ir.funcao ?? schema?.nome ?? "";

  /*
   * A forma de escrita é a que o ARQUIVO usava.
   *
   * `mover(gb, hub, 100)` tem que continuar `mover(...)` e virar
   * `gb_move(...)`: as duas são a mesma função, mas para quem está lendo o
   * arquivo são programas diferentes — `mover` pode estar importado com
   * outro alias em outro lugar. Reescrever o nome é inventar.
   */
  const args = [];

  for (const campo of schema?.todosCampos ?? []) {
    const argumento = (ir.argumentos ?? []).find((a) => a.nome === campo.nome);
    const texto = valorParaPython(argumento, campo, opcoes);

    if (texto === null) continue;

    /*
     * Posicional é o padrão, mas keyword preserva o que a criança (ou o
     * autor) escreveu. `gb_move(gb, hub, 100, velocidade=300)` volta
     * IGUAL, e não como quatro posicionais.
     */
    if (argumento?.forma === "keyword") {
      args.push(`${campo.nome}=${texto}`);
    } else {
      args.push(texto);
    }
  }

  return `${nome}(${args.join(", ")})`;
}

/**
 * O texto Python de UM argumento.
 *
 * Devolve `null` quando o campo não pode ser escrito — e aí a interface
 * sabe que precisa sinalizar, em vez de gerar `mover(, 100)`.
 */
function valorParaPython(argumento, campo, opcoes) {
  /* ---- Campo escondido: o gerador preenche sozinho ---- */
  if (campo.oculto) {
    const valor = opcoes.ocultos?.[campo.nome];
    if (valor === undefined) {
      /*
       * Sem valor conhecido, NÃO se inventa. Um `gb` que não se sabe qual
       * é é um bloco que muda o programa ao ser gerado — e a regra do
       * projeto é nunca fazer isso em silêncio.
       */
      return null;
    }
    return valor;
  }

  if (!argumento) {
    /*
     * Ausente no Python E ausente na assinatura opcional: fica de fora.
     *
     * Escrever o default aqui "completaria" a chamada, mas isso muda o
     * arquivo da criança: `gb_move(gb, hub, 100)` passaria a ser
     * `gb_move(gb, hub, 100, 300)`. O default pertence à FUNÇÃO e ela já o
     * aplica; repetir no texto é inventar código.
     */
    return null;
  }

  if (argumento.forma === "padrao" && argumento.padrao !== undefined) {
    return argumento.padrao;
  }

  /*
   * Campo com unidade: o valor visual tem que ser CONVERTIDO antes de
   * sair. `10 cm` vira `100`, e não a string "10 cm".
   */
  if (campo.unidadeVisual && campo.unidadeVisual !== campo.unidadeFuncao) {
    const convertido = convert(argumento.texto ?? argumento.literal, campo.unidadeVisual, campo.unidadeFuncao);
    if (convertido !== null) return String(convertido);
  }

  return argumento.texto ?? null;
}

/* ------------------------------------------------------------------ */
/* IR semântico -> estado de bloco                                    */
/* ------------------------------------------------------------------ */

/**
 * Prepara os valores que o bloco vai MOSTRAR.
 *
 * É o passo em que o Python vira a tela. Cada campo recebe:
 *
 *     valorVisual     texto que aparece no input
 *     unidadeVisual   unidade que aparece no dropdown
 *     direcao         rótulo de direção, quando o campo carrega sinal
 *     tipo            qual controle usar
 *
 * A DIREÇÃO sai do sinal do número, nunca do nome do campo:
 *
 *     gb_move(gb, hub,  100)  ->  "frente",  100
 *     gb_move(gb, hub, -100)  ->  "tras",    100
 *
 * O valor que a criança EDITA é o MÓDULO. É isso que faz trocar
 * "frente" para "tras" aplicar o sinal certo: não há campo de direção
 * separado que possa dessincronizar do número.
 */
export function irParaCampos(ir, schema) {
  if (!ir || !schema) return [];

  return schema.campos.map((campo) => {
    const argumento = (ir.argumentos ?? []).find((a) => a.nome === campo.nome);
    const bruto = argumento?.texto ?? textoDoPadrao(campo.padrao) ?? "";

    /* ---- Campo de direção: o número vira rótulo ---- */
    if (schema.direcao && schema.direcao.campo === campo.nome && campo.sinal) {
      return campoDeDirecao(campo, bruto);
    }

    /* ---- Campo com unidade ---- */
    if (campo.unidadeFuncao) {
      const numero = paraNumero(bruto);
      if (numero !== null) {
        const unidadeVisual = campo.unidadeVisual ?? campo.unidadeFuncao;
        return {
          nome: campo.nome,
          tipo: campo.tipo,
          papel: campo.papel,
          /** O que a criança vê. */
          valorVisual: formatarVisual(numero, campo.unidadeFuncao, unidadeVisual),
          /** O que o Python recebe. */
          valorEnviado: numero,
          unidadeVisual,
          unidadeFuncao: campo.unidadeFuncao,
          opcoesUnidade: unidadesPara(campo.papel),
          opcoes: campo.opcoes ?? null,
          opcional: campo.opcional,
          descricao: campo.descricao,
        };
      }
    }

    /* ---- Número puro, sem unidade ---- */
    const numero = paraNumero(bruto);
    if (numero !== null && campo.tipo === "number") {
      return {
        nome: campo.nome,
        tipo: "number",
        papel: campo.papel,
        valorVisual: String(numero),
        valorEnviado: numero,
        unidadeVisual: null,
        unidadeFuncao: campo.unidadeFuncao ?? null,
        opcoesUnidade: [],
        opcoes: null,
        opcional: campo.opcional,
        descricao: campo.descricao,
      };
    }

    /* ---- Texto, variável ou expressão ---- */
    return {
      nome: campo.nome,
      tipo: campo.tipo,
      papel: campo.papel,
      /*
       * Expressão NÃO vira caixa de texto fechada: ela continua TEXTO que
       * pode receber um bloco encaixado. A distinção entre "a criança
       * digitou uma variável" e "isto é uma expressão" não é feita aqui —
       * é feita pelo socket, que aceita as duas coisas.
       */
      valorVisual: bruto,
      valorEnviado: bruto,
      unidadeVisual: null,
      unidadeFuncao: campo.unidadeFuncao ?? null,
      opcoesUnidade: [],
      opcoes: campo.opcoes ?? null,
      opcional: campo.opcional,
      expressao: numero === null,
      descricao: campo.descricao,
    };
  });
}

/**
 * Campo que carrega a direção.
 *
 * O número é separado em (magnitude, sentido):
 *
 *     100  ->  { direcao: "frente",  valorVisual: "100" }
 *     -100 ->  { direcao: "tras",    valorVisual: "100" }
 *
 * Guardar o MÓDULO é o que evita o bug clássico: se o bloco guardasse
 * `-100` e o rótulo "frente", trocar a direção não mudaria nada no Python.
 */
function campoDeDirecao(campo, bruto) {
  const numero = paraNumero(bruto);
  const expressao = numero === null;

  const positivo = campo.sinal?.positivo ?? "frente";
  const negativo = campo.sinal?.negativo ?? "tras";

  const direcao = expressao ? null : numero < 0 ? negativo : positivo;
  const modulo = expressao ? bruto : String(Math.abs(numero));

  return {
    nome: campo.nome,
    tipo: campo.tipo,
    papel: campo.papel,
    /** Texto do input: só o módulo, o sinal mora no rótulo. */
    valorVisual: modulo,
    /** O que volta para o Python já com o sinal aplicado. */
    valorEnviado: expressao ? bruto : numero,
    /** Rótulo do dropdown de direção. */
    direcao,
    direcoes: [positivo, negativo],
    /** `true` quando o valor é variável/expressão e a direção é indefinida. */
    direcaoIndefinida: expressao,
    unidadeVisual: campo.unidadeVisual ?? campo.unidadeFuncao,
    unidadeFuncao: campo.unidadeFuncao,
    opcoesUnidade: unidadesPara(campo.papel),
    opcoes: campo.opcoes ?? null,
    opcional: campo.opcional,
    expressao,
    descricao: campo.descricao,
  };
}

/**
 * Aplica a direção escolhida sobre o valor do campo.
 *
 * Este é o caminho de VOLTA da edição: a criança troca "frente" por "tras"
 * e o valor tem que virar negativo. Se o valor é expressão, não se toca —
 * e a direção fica indefinida, em vez de fingir.
 *
 * @returns {{ valor: string, expressao: boolean }}
 */
export function aplicarDirecao(campo, direcaoEscolhida, valorAtual) {
  const positivo = campo.direcoes?.[0] ?? "frente";
  const negativo = campo.direcoes?.[1] ?? "tras";

  const numero = paraNumero(valorAtual);
  if (numero === null) {
    // Variável ou expressão: o sinal não pode ser aplicado.
    return { valor: String(valorAtual ?? ""), expressao: true };
  }

  /*
   * O valor devolvido é o que a DIREÇÃO ESCOLHIDA pede, não o oposto.
   *
   * O código anterior devolvia `-Math.abs(...)` sempre que os sinais não
   * batiam, e isso quebrava o caminho "trás -> frente": pedir "frente"
   * sobre `-100` devolvia `-100` de novo, então o dropdown voltava para
   * trás sem a criança ter clicado duas vezes. A troca é pelo sinal-alvo,
   * que é a única coisa que importa.
   */
  const querNegativo = direcaoEscolhida === negativo;
  const valorFinal = querNegativo ? -Math.abs(numero) : Math.abs(numero);

  return { valor: String(valorFinal), expressao: false };
}

/* ------------------------------------------------------------------ */
/* Suporte à leitura da AST                                           */
/* ------------------------------------------------------------------ */

/**
 * Casa cada campo da assinatura com o argumento que o recebeu.
 *
 * Percorre a chamada uma vez, na ordem, guardando posição por NOME.
 * O nome é a chave porque é o que sobrevive ao round-trip: o Python
 * aceitou `velocidade=300` e `gb` na posição 0, e são coisas diferentes
 * que não podem se confundir.
 */
function posicoesDosArgumentos(node, schema) {
  const mapa = new Map();

  /*
   * Nomeados PRIMEIRO.
   *
   * `gb_move(gb, hub, 100, velocidade=300)` tem quatro argumentos: dois
   * posicionais e um nomeado, e o nomeado NÃO é o terceiro posicional. Se
   * os posicionais fossem lidos primeiro, `velocidade` receberia o valor de
   * `100` e o `300` do nomeado ficaria sem dono — e o round-trip trocaria
   * os dois no Python.
   */
  for (const k of node?.keywords ?? []) {
    if (k?.name) mapa.set(k.name, { item: { value: k.value, forma: "keyword" }, indice: -1 });
  }

  const posicionais = (schema?.parametros ?? []).filter((p) => !p.variadic && !p.variadicKeyword);
  for (const [indice, item] of (node?.arguments ?? []).entries()) {
    const alvo = posicionais[indice];
    if (alvo && !mapa.has(alvo.nome)) {
      mapa.set(alvo.nome, { item: { value: item, forma: "posicional" }, indice });
    }
  }

  return mapa;
}

/** Texto do alvo da chamada (`gb_move`, `movimento.gb_move`). */
function textoDoAlvo(node) {
  if (!node) return "";
  if (typeof node.calleeText === "string") return node.calleeText;
  if (typeof node.functionName === "string") return node.functionName;
  if (typeof node.callee === "string") return node.callee;
  if (node.callee?.name) return node.callee.name;
  return "";
}

/**
 * Texto Python de um valor da AST.
 *
 * Literal vira literal. Qualquer outra coisa vira o texto que já existe no
 * nó — a AST guarda o Python original, e reinventar aqui seria o caminho
 * para perder `distancia * 2`.
 */
function textoDoValor(no) {
  if (no === null || no === undefined) return "";
  if (typeof no === "string" || typeof no === "number" || typeof no === "boolean") return String(no);

  /*
   * `expressionText` é quem sabe remontar `distancia * 2`, `-a ** 2` e
   * `(1,)` sem errar parêntese. Duplicar essa lógica aqui faria os dois
   * caminhos divergirem — e a divergência aparece como Python diferente do
   * arquivo, que é o defeito que o projeto não pode ter.
   */
  return valorParaTexto(no);
}
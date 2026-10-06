/**
 * SOCKETS — o coração da IDE bidirecional.
 * ---------------------------------------
 * Até aqui, toda expressão Python virava TEXTO dentro de um parâmetro:
 * `value: "(erro * KP_STRAIGHT)"`. A árvore era montada por
 * `expressionToBlock()` e imediatamente desfeita por `conditionText()`,
 * que chamava `spec.py(params)` e devolvia uma string. O resultado era
 * expressões invisíveis dentro de caixas de texto — exatamente o defeito
 * que a criança não pode ver e o professor não pode corrigir.
 *
 * Aqui o socket passa a guardar o BLOCO, não o texto:
 *
 *   { blockId: "var_set",
 *     params: { name: "correcao",
 *               value: { blockId: "op_multiply",      // <- bloco aninhado
 *                        params: { left:  { blockId: "var_report", ... },
 *                                 right: { blockId: "var_report", ... } } } } }
 *
 * Três decisões de projeto que valem registrar:
 *
 *  1. A forma do dado é a própria AST de blocos — a mesma que já existe no
 *     workspace. Não há "modo socket" separado: um bloco encaixado e um
 *     bloco solto têm o MESMO formato, o que faz serialização, undo/redo,
 *     localStorage e reconciliação funcionarem sem código extra.
 *
 *  2. `resolveParams()` é o ponto único de conversão bloco -> texto. Ele
 *     roda antes de `spec.py(params)`, o que significa que os 134 blocos
 *     do catálogo passam a aceitar sockets aninhados SEM que ninguém tenha
 *     de reescrever suas 134 funções `py`.
 *
 *  3. Um param continua aceitando um valor primitivo (número, texto,
 *     booleano). Isso é o "modo rápido": digitar 50 e dar Enter não vira
 *     bloco, e a criança não paga o custo de um clique para usar um
 *     número. A promoção texto -> bloco acontece quando o texto é uma
 *     EXPRESSÃO, não um literal (ver `promoteTextToBlock`).
 */

/* ------------------------------------------------------------------ */
/* Reconhecimento de valor                                              */
/* ------------------------------------------------------------------ */

/**
 * Um valor de parâmetro é um bloco encaixado quando é um objeto com
 * `blockId`. A checagem é estrutural, não por lista de ids: assim um
 * bloco novo do catálogo funciona nos sockets sem registration.
 */
export function isBlockValue(value) {
  return Boolean(value) && typeof value === "object" && typeof value.blockId === "string";
}

/** Empacota um bloco como valor de socket (uso dos testes e da UI). */
export function asBlockValue(block) {
  return block;
}

/* ------------------------------------------------------------------ */
/* Tipos de socket                                                     */
/* ------------------------------------------------------------------ */

/**
 * Categoria de um bloco para fins de encaixe.
 *
 *   statement  — ocupa pilha (comando). NÃO cabe em socket de expressão.
 *   reporter   — devolve valor. Cabe em expressão, número e texto.
 *   boolean    — devolve sim/não. Cabe em socket de condição/booleano.
 *   cap        — statement que fecha a pilha (return, break).
 */
export function kindOfBlock(blockOrSpec) {
  /*
    Aceita um BLOCO (tem `blockId`) ou uma ESPECIFICAÇÃO do catálogo (tem
    `shape`). Antes só o primeiro caminho existia, e passar a especificação
    caía no `return "reporter"` do fim — ou seja, toda validação de encaixe
    feita com a spec dizia que qualquer coisa era reporter, e um bloco em C
    "encaixava" em socket de expressão.
  */
  const spec = (blockOrSpec && typeof blockOrSpec === "object" && (blockOrSpec.blockId || blockOrSpec.shape))
    ? blockOrSpec
    : null;
  if (spec && spec.shape) {
    if (spec.shape === "boolean") return "boolean";
    if (spec.shape === "cap") return "cap";
    if (spec.shape === "reporter") return "reporter";
    if (spec.shape === "hat" || spec.shape === "c-block" || spec.shape === "stack") return "statement";
  }
  /*
   * Shape desconhecido ou bloco inexistente: tratamos como STATEMENT, que é
   * o tipo que não cabe em lugar nenhum. O fallback antigo era "reporter",
   * e reporter é justamente o que ENCAIXA — então um erro de catálogo
   * (shape digitado errado) virava permissão silenciosa de encaixar o
   * bloco onde ele não deveria. Falhar fechado é mais seguro do que
   * falhar permissivo: no pior caso a criança vê o encaixe recusado e
   * avisa; no outro, ela solta um bloco em C dentro de uma expressão e o
   * Python gerado deixa de fazer sentido sem nenhum aviso.
   */
  return "statement";
}

/**
 * O que um socket aceita. Derivado do TIPO declarado no catálogo, e não
 * do shape do bloco encaixado — assim a regra fica escrita num lugar só
 * (o catálogo) e o validador não precisa conhecer 134 blocos.
 */
export function socketAccepts(paramSpec) {
  switch (paramSpec?.type) {
    case "number":
      return new Set(["number", "reporter"]);
    case "text":
      return new Set(["text", "reporter"]);
    /*
      BOOLEANO SÓ EM CONDITION (item #4, regra do usuário).

      `expression` aceita repórter; `condition` aceita booleano E repórter,
      porque em Python um `True` também pode ser testado. Socket NUMÉRICO
      não aceita booleano: o Pybricks não soma `True` com `velocidade`, e
      deixar encaixar seria prometer uma coisa que o robô não faz.

      Consequência honesta: um operador de comparação que o PYTHON produz
      numa atribuição (`x = a < b`) aparece desenhado, porque conteúdo que
      veio do arquivo nunca é rejeitado. A restrição vale para o que a
      criança ARRASTA — é aí que ela precisa da regra.
    */
    case "condition":
      return new Set(["boolean", "reporter"]);
    case "variable":
      return new Set(["reporter"]);
    case "expression":
      return new Set(["reporter"]);
    case "port":
    case "select":
    case "enum":
    case "boolean":
    default:
      return new Set(); // socket de valor literal: não aceita bloco
  }
}

/**
 * Um bloco encaixado serve a este socket?
 *
 * `exprBlock` é a especificação do bloco candidato. A checagem é
 * estrutural (o que o socket aceita) e não por nome de bloco, que é o que
 * o usuário pediu: "Boolean só pode encaixar em socket boolean/condition.
 * Statement não pode encaixar dentro de reporter."
 */
export function canDropInto(paramSpec, exprBlock) {
  if (!exprBlock) return false;
  const accepts = socketAccepts(paramSpec);
  if (accepts.size === 0) return false;
  const kind = kindOfBlock(exprBlock);
  if (kind === "statement" || kind === "cap") return false;
  return accepts.has(kind);
}

/* ------------------------------------------------------------------ */
/* Resolução: bloco -> texto Python                                   */
/* ------------------------------------------------------------------ */

/**
 * Converte (recursivamente) o valor de um parâmetro no texto que o Python
 * precisa ver.
 *
 * É aqui que a recursão vira linear: `op_multiply` tem `left` e `right`
 * que podem ser blocos, e o bloco da esquerda pode ter os dele. Cada nível
 * pede o Python do filho e o pai o embute.
 *
 * @param {*} value valor cru do parâmetro
 * @param {(block: object) => string} toPython gerador do bloco filho
 * @returns {string} texto pronto para intercalar no Python
 */
export function resolveValue(value, toPython) {
  if (isBlockValue(value)) return toPython(value);

  if (Array.isArray(value)) {
    /*
      DOIS TIPOS DE LISTA, e o critério é se há BLOCO dentro.
      ───────────────────────────────────────────────────────────────
        • lista COM bloco -> é a lista de argumentos de uma chamada:
          precisa virar o texto `a, b, c` que o Python lê. É o único uso
          de "juntar com vírgula" que existe no código.

        • lista SEM bloco -> é ESTRUTURA de dados, e a estrutura é
          preservada.

      A segunda regra é mais larga do que era, e de propósito. Antes só
      "lista de objetos simples" era preservada, e qualquer lista de valores
      simples virava `"gb, hub"`. Isso destruiu a assinatura de todo bloco
      semântico:

          semantic.ocultos   ["gb","hub"]              -> "gb, hub"
          fields[N].options  [["frente","frente"], …] -> "frente, frente"

      Com a informação achatada, o gerador percorria a string caractere a
      caractere, não achava valor para `gb`, e a chamada saía como
      `gb_move()` — sem `gb`, sem `hub` e sem distância. Erro silencioso
      numa IDE que promete ir e voltar.

      `def f(x, y=300)` voltava como `def f(x, y)` pelo mesmo motivo, e
      continua voltando certo: agora toda lista sem bloco é estrutura.
    */
    const items = value.map((item) => resolveValue(item, toPython));
    const temBloco = value.some((item) => isBlockValue(item));
    return temBloco ? items.join(", ") : items;
  }

  if (value === null || value === undefined) return "";

  if (typeof value === "object") {
    /*
      Objeto que NÃO é bloco: a estrutura é preservada e os blocos de
      dentro são resolvidos.

      Isto não é um detalhe. Os parâmetros estruturados de uma função
      (`parameters: [{ name, annotation, default }]`) são uma lista de
      objetos cujo `default` pode ser um bloco. Serializar tudo em JSON
      aqui fazia o `=300` sumir da assinatura — que era exatamente o item
      #12 do pedido, e um bug de round-trip silencioso.

      Arrays continuam virando lista separada por vírgula, porque é assim
      que um socket de argumentos de chamada precisa ser lido pelo Python.
    */
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, toPython);
    return out;
  }

  if (typeof value === "boolean") return value ? "True" : "False";

  return String(value);
}

/**
 * Devolve uma cópia dos params com todos os blocos aninhados já
 * resolvidos para texto. É este objeto que chega em `spec.py()`.
 */
export function resolveParams(block, toPython) {
  const source = block?.params ?? {};
  const out = {};
  for (const [name, value] of Object.entries(source)) {
    out[name] = resolveValue(value, toPython);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Promoção: texto -> bloco (item 13 / decisão "texto vira bloco")      */
/* ------------------------------------------------------------------ */

/**
 * Converte o texto digitado num socket em árvore de blocos — mas só
 * quando o texto é de fato uma EXPRESSÃO.
 *
 * A decisão de projeto foi: texto vira bloco ao sair do campo. O risco
 * conhecido é de tipo ("50" pode ser número ou texto). A mitigação é não
 * adivinhar: o TIPO do socket decide.
 *
 *   socket number       -> "50" vira literal 50
 *   socket number       -> "erro * 2" vira árvore da expressão
 *   socket expression   -> "erro * 2" vira árvore
 *   socket expression   -> "50" vira literal 50 (número conhecido)
 *   socket text         -> "erro * 2" vira TEXTO, porque o socket é de texto
 *
 * @param {string} text o que a criança digitou
 * @param {object} paramSpec tipo declarado do socket
 * @param {(node: object) => object|null} exprToBlock converte um nó da IR
 * @param {(value: any, paramSpec: object) => any} literal constró literais
 * @returns {*} o valor pronto para o parâmetro
 */
export function promoteTextToBlock(text, paramSpec, exprToBlock, literal) {
  const raw = String(text ?? "").trim();
  if (!raw) return literal("", paramSpec);

  // 1. socket de texto é TEXTO por definição: promover seria inventar tipo.
  if (paramSpec?.type === "text") return raw;

  // 2. número puro em qualquer socket numérico/expressão: vai direto.
  const asNumber = Number(raw.replace(",", "."));
  if (raw !== "" && Number.isFinite(asNumber) && /^-?\d+([.,]\d+)?$/.test(raw)) {
    if (paramSpec?.type === "number" || paramSpec?.type === "expression") return asNumber;
  }

  // 3. tipos que NÃO aceitam bloco: o texto é o valor, ponto final.
  if (paramSpec?.type === "port" || paramSpec?.type === "select" || paramSpec?.type === "enum") return raw;
  if (paramSpec?.type === "variable") return raw;

  // 4. número, expressão e condição aceitam árvore.
  //
  //    Socket NUMÉRICO também aceita, e essa é a decisão que evita o pior
  //    resultado possível: `velocidade` digitando `erro * 2` num campo que
  //    só sabia(number) e devolvia NaN. Um NaN silencioso no Python é pior
  //    que python-only — o robô recebe lixo e nada denuncia.
  const tree = exprToBlock(raw);
  if (tree) return tree;

  // 5. não deu para estruturar.
  if (paramSpec?.type === "number") {
    // Número de verdade já foi tratado no passo 2. Aqui é texto em lugar de
    // número: fica o texto VISÍVEL para a criança corrigir, em vez de 0.
    return raw;
  }

  // 6. nunca se perde o que a criança escreveu.
  return raw;
}

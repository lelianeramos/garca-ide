/* ================================================================== */
/* ADAPTADOR: SCHEMA SEMÂNTICO -> BLOCO DO CATÁLOGO                     */
/* ================================================================== */
/*
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * A camada semântica NÃO conhece o catálogo de blocos, e o catálogo não
 * conhece a camada semântica. Este arquivo é a costura entre as duas —
 * e só ele conhece as duas.
 *
 * Motivo prático: o catálogo tem 134 blocos estáticos que a interface já
 * sabe desenhar. Reescrever isso para gerar blocos a partir de schema
 * seria refazer a engine de layout, os sockets e a geometria. Em vez
 * disso, o schema vira o MESMO formato de campo que `custom_call` já
 * usa, e passa a renderizar com o mesmo caminho de código.
 *
 * O que muda em relação ao `custom_call` cru:
 *
 *   - o campo de DIREÇÃO (dropdown "para frente"/"para trás");
 *   - a UNIDADE visível (dropdown mm/cm/m) com conversão de verdade;
 *   - os ENUMS vindos de `Literal[...]`;
 *   - os argumentos técnicos ESCONDIDOS;
 *   - os opcionais atrás da engrenagem.
 *
 * O que NÃO muda: os sockets continuam aceitando bloco encaixado. Um
 * campo numérico com `unit` não deixa de ser socket — é o mesmo elemento
 * com um seletor do lado.
 */

import { rotuloUnidade } from "./units.js";
import { rotuloDe } from "./functionSchema.js";

/**
 * Converte um `SemanticCall` + `FunctionSchema` nos campos que o
 * renderizador de blocos entende.
 *
 * @param {object} ir       IR semântico da chamada
 * @param {object} schema   FunctionSchema
 * @returns {Array} lista de campos no formato do catálogo
 */
export function camposParaBloco(ir, schema) {
  if (!ir || !schema) return [];

  return schema.campos.map((campo) => {
    const argumento = (ir.argumentos ?? []).find((a) => a.nome === campo.nome);

    /*
     * A FORMA do argumento (`keyword` ou `posicional`) vai para o campo.
     *
     * Sem isso, `gb_move(gb, hub, 100, velocidade=300)` voltava como
     * `gb_move(gb, hub, 100, 300)`. Os dois chamam a mesma função com os
     * mesmos valores — mas não são o mesmo texto, e quem lê o arquivo pode
     * estar contando com o nome explícito. Round-trip é devolver o que
     * estava lá, não uma forma equivalente.
     */
    const forma = argumento?.forma === "keyword" ? "keyword" : "posicional";

    /*
     * AUSENTE no Python é informação, e precisa sobreviver.
     *
     * `girar_luz(hub, 45)` não passa `ligar`. Sem marcar isso, o gerador
     * escrevia `True` (o default do booleano) e a chamada voltava
     * `girar_luz(hub, 45, True)` — inventando um argumento que a criança
     * não escreveu. Preencher default é papel da FUNÇÃO, não do bloco.
     */
    /*
     * `presente` é o dado; `ausente` é só uma leitura mais fácil de
     *WEiter.
     *
     * O campo guarda o VERDADEIRO, não o complemento. Um booleano `false`
     * é um valor legítimo, e negá-lo por coerção seria o mesmo erro de
     * tratar "não informado" como "False": o Python receberia um
     * argumento que a chamada não tinha.
     */
    const ausente = argumento?.presente === false;

    /* ---- Campo de DIREÇÃO: dropdown + módulo ---- */
    if (schema.direcao?.campo === campo.nome) {
      return { ...campoDirecaoParaBloco(campo, argumento, schema), forma, ausente };
    }

    /* ---- Campo com UNIDADE: número + seletor de unidade ---- */
    if (campo.unidadeFuncao) {
      return { ...campoUnidadeParaBloco(campo, argumento), forma, ausente };
    }

    /* ---- ENUM vindo de Literal[...] ou da docstring ---- */
    if (campo.tipo === "enum" && campo.opcoes?.length >= 2) {
      return {
        name: campo.nome,
        label: rotuloDoCampo(campo),
        type: "select",
        value: String(argumento?.texto ?? ""),
        options: campo.opcoes.map((o) => [String(o), String(o)]),
        forma, ausente,
        ...extraDeCampo(campo),
      };
    }

    /* ---- BOOLEANO ---- */
    if (campo.tipo === "boolean") {
      return {
        name: campo.nome,
        label: rotuloDoCampo(campo),
        type: "boolean",
        value: textoDeBooleano(argumento?.texto ?? ""),
        forma, ausente,
        ...extraDeCampo(campo),
      };
    }

    /* ---- PORTA: A, B, C, D, E, F ---- */
    if (campo.tipo === "port") {
      return {
        name: campo.nome,
        label: rotuloDoCampo(campo),
        type: "port",
        value: String(argumento?.texto ?? "A"),
        options: [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"], ["F", "F"]],
        forma, ausente,
        ...extraDeCampo(campo),
      };
    }

    /* ---- TEXTO ---- */
    if (campo.tipo === "text") {
      return {
        name: campo.nome,
        label: rotuloDoCampo(campo),
        type: "text",
        value: String(argumento?.texto ?? ""),
        forma, ausente,
        ...extraDeCampo(campo),
      };
    }

    /*
     * NÚMERO sem unidade.
     *
     * O tipo é `expression`, e NÃO `number`: o campo aceita tanto um
     * número digitado quanto uma VARIÁVEL ou uma expressão como
     * `distancia * 2`. Um campo numérico travado em número perderia o
     * encaixe, que é metade do valor da IDE.
     */
    return {
      name: campo.nome,
      label: rotuloDoCampo(campo),
      type: "expression",
      value: String(argumento?.texto ?? ""),
      forma, ausente,
      ...extraDeCampo(campo),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Campos especiais                                                    */
/* ------------------------------------------------------------------ */

/**
 * Campo de direção.
 *
 * O dropdown traz os rótulos que a DOCSTRING usou, não palavras fixas:
 * quem escreveu "negativo gira para a esquerda" vê "esquerda"; quem
 * escreveu "negativo move para trás" vê "trás".
 *
 * O campo guarda `sign` além do valor. O valor é o MÓDULO (sempre
 * positivo na tela) e `sign` é -1 ou 1; a soma é feita na hora de gerar
 * o Python. Sem essa separação, trocar o dropdown teria que reescrever o
 * número, e é aí que nasce o bug de sinal.
 */
function campoDirecaoParaBloco(campo, argumento, schema) {
  const positivo = schema.direcao.positivo;
  const negativo = schema.direcao.negativo;

  const bruto = String(argumento?.texto ?? "");
  const numero = Number(bruto);

  const ehNumero = bruto.trim() !== "" && Number.isFinite(numero);
  const negativoAgora = ehNumero && numero < 0;

  return {
    name: campo.nome,
    label: rotuloDoCampo(campo),
    type: "direction",
    /** Rótulo visível do dropdown. */
    direction: ehNumero ? (negativoAgora ? negativo : positivo) : null,
    options: [[positivo, positivo], [negativo, negativo]],
    /** O que a criança vê: o módulo, sem sinal. */
    value: ehNumero ? String(Math.abs(numero)) : bruto,
    /** -1 ou 1; `null` quando o valor é expressão (direção indefinida). */
    sign: ehNumero ? (negativoAgora ? -1 : 1) : null,
    unit: campo.unidadeFuncao ? rotuloUnidade(campo.unidadeFuncao) : null,
    ...extraDeCampo(campo),
  };
}

/**
 * Campo com unidade.
 *
 * `unit` é o rótulo curto ("mm", "cm/s") que o renderizador já sabe
 * mostrar, e `unitOptions` é a lista completa para o seletor. O valor
 * guardado é o que a função espera (mm), porque é o que volta ao Python
 * sem novo cálculo no caminho de ida.
 */
function campoUnidadeParaBloco(campo, argumento) {
  const bruto = String(argumento?.texto ?? "");
  const numero = Number(bruto);
  const ehNumero = bruto.trim() !== "" && Number.isFinite(numero);

  const opcoes = (campo.opcoesUnidade ?? []).map((u) => [rotuloUnidade(u), u]);

  return {
    name: campo.nome,
    label: rotuloDoCampo(campo),
    /*
     * `unit` e não `expression`: é o tipo que faz o renderizador colar o
     * seletor de unidade ao lado do socket. O controle `unit` reaproveita o
     * socket de expressão por dentro, então bloco encaixado, variável e
     * `distancia * 2` continuam funcionando igual.
     *
     * Sem opções não há seletor, e aí `expression` é o tipo certo — um
     * `<select>` de uma opção só seria um botão morto na tela.
     */
    type: opcoes.length >= 2 ? "unit" : "expression",
    value: ehNumero ? String(numero) : bruto,
    unit: rotuloUnidade(campo.unidadeFuncao),
    /**
     * A unidade ESCOLHIDA, pela chave canônica ("mm", "cm/s").
     *
     * O `unit` acima é o RÓTULO para a tela ("mm/s"); este é o que a
     * conversão precisa. Guardar os dois é o que permite trocar a unidade
     * mostrada sem perder a unidade que a função espera.
     */
    unitKey: campo.unidadeVisual ?? campo.unidadeFuncao,
    unitOptions: opcoes,
    ...extraDeCampo(campo),
  };
}

/** Metadados que o renderizador sabe mostrar sem saber nada de schema. */
function extraDeCampo(campo) {
  const extra = {};
  if (campo.opcional) extra.optional = true;
  if (campo.descricao) extra.help = campo.descricao;
  return extra;
}

/* ------------------------------------------------------------------ */
/* Rótulos em português                                                */
/* ------------------------------------------------------------------ */

/**
 * Traduz o nome do argumento para o rótulo que aparece no bloco.
 *
 * `distancia` vira "distância"; `velocidade_max` vira "velocidade máxima".
 * É a mesma regra do `ptFunctionLabel` do renderizador, que já existe
 * para os blocos de função — aqui é reaproveitada em vez de duplicada.
 */
export function rotuloDoCampo(campo) {
  const nome = String(campo?.nome ?? "");
  return rotuloDePalavra(nome) || nome;
}

const SUFIXOS = {
  max: "máxima",
  min: "mínima",
  media: "média",
  alvo: "alvo",
  atual: "atual",
  inicial: "inicial",
};

/** `velocidade_max` -> "velocidade máxima". */
function rotuloDePalavra(nome) {
  const partes = String(nome).split("_").filter(Boolean);
  if (partes.length === 0) return "";

  const traduzidas = partes.map((parte, i) => {
    if (i > 0 && SUFIXOS[parte]) return SUFIXOS[parte];
    return ACENTOS[parte] ?? parte;
  });

  return traduzidas.join(" ");
}

/*
 * Tabela de tradução dos nomes de argumento mais comuns do projeto.
 *
 * Ela existe porque o NOME do argumento é o que a criança lê primeiro, e
 * `distancia` sem acento é的区别 visível entre um bloco acabado e um
 * despejado do parser.
 */
const ACENTOS = {
  distancia: "distância",
  angulo: "ângulo",
  rotacao: "rotação",
  direcao: "direção",
  posicao: "posição",
  velocidade: "velocidade",
  potencia: "potência",
  tempo: "tempo",
  porta: "porta",
  cor: "cor",
  tamanho: "tamanho",
  numero: "número",
  media: "média",
  esquerda: "esquerda",
  direita: "direita",
  frente: "frente",
  tras: "trás",
  re: "ré",
};

/* ------------------------------------------------------------------ */
/* Bloco pronto                                                        */
/* ------------------------------------------------------------------ */

/**
 * Monta o bloco completo do catálogo a partir da chamada.
 *
 * O bloco resultante usa `custom_call` — o bloco genérico que já existe —
 * com os campos JÁ calculados. Não existe um `gb_move` no catálogo, e é
 * essa a garantia exigida pelo projeto: a inteligência vem do SCHEMA, não
 * de um caso especial por nome de função.
 */
export function blocoParaChamada(ir, schema, { opcoes = {} } = {}) {
  const campos = camposParaBloco(ir, schema);

  return {
    blockId: "custom_call",
    /*
     * `semantic` fica DENTRO de `params`, e não ao lado.
     *
     * O bloco é criado por `makeBlock(blockId, params, …)`, que só recebe
     * os parâmetros — qualquer coisa colocada ao lado é descartada. Com o
     * `semantic` fora, a geração do Python caía no caminho genérico e
     * devolvia `gb_move(distancia=100)`, sem `gb`, sem `hub` e com nome em
     * todo argumento: três coisas erradas de uma vez, e nenhuma visível.
     */
    params: {
      label: opcoes.rotulo ?? schema.rotulo ?? rotuloDe(schema.nome),
      function: ir?.nomeNoArquivo ?? schema.nome,
      module: schema.modulo ?? "",
      fields: campos,
      semantic: {
        funcao: schema.nome,
        modulo: schema.modulo,
        ocultos: schema.ocultos.map((c) => c.nome),
        camposVisiveis: campos.map((c) => c.name),
        unidades: Object.fromEntries(
          schema.campos.filter((c) => c.unidadeFuncao).map((c) => [c.nome, c.unidadeFuncao]),
        ),
        naoRepresentaveis: schema.naoRepresentaveis.map((c) => c.nome),
      },
    },
  };
}

/** `true` quando o texto do Python é um booleano. */
function textoDeBooleano(texto) {
  const t = String(texto ?? "").trim();
  if (t === "True" || t === "true") return true;
  if (t === "False" || t === "false") return false;
  return true; // Python: parâmetro bool não informado vale True no padrão do bloco
}
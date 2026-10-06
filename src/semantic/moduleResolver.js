/* ================================================================== */
/* RESOLUÇÃO DE MÓDULOS E ALIASES                                      */
/* ================================================================== */
/*
 * POR QUE ISTO EXISTE
 *
 * Uma chamada no Python pode chegar ao bloco por três caminhos diferentes:
 *
 *     from movimento import gb_move
 *     gb_move(gb, hub, 100)          -> caminho A
 *
 *     from movimento import gb_move as mover
 *     mover(gb, hub, 100)            -> caminho B (mesma função, outro nome)
 *
 *     import movimento
 *     movimento.gb_move(gb, hub, 100)  -> caminho C (atributo)
 *
 * São a MESMA função e o mesmo bloco. O bloco não pode mostrar "função
 * desconhecida" só porque a criança escreveu `import` de outro jeito.
 *
 * Além disso, o bloco precisa devolver o Python na MESMA FORMA em que foi
 * lido. Se o arquivo usa `mover(gb, hub, 100)`, o Python regerado tem que
 * dizer `mover(gb, hub, 100)` — reescrever para `gb_move` mudaria o
 * programa da criança e quebraria outras chamadas.
 *
 * E o mais importante: quando o arquivo da biblioteca muda, os blocos já
 * colocados na tela têm que refletir a mudança sozinhos. Por isso todo
 * módulo registrado guarda uma ASSINATURA do conteúdo (ver `assinaturaDe`).
 */

/* ------------------------------------------------------------------ */
/* Identidade de um alvo de chamada                                    */
/* ------------------------------------------------------------------ */

/**
 * Descreve o alvo de uma chamada de forma NORMALIZADA.
 *
 * O mesmo nome escrito de jeitos diferentes produz a mesma identidade,
 * porque `from x import y as z` e `import x` + `x.y` levam ao mesmo lugar.
 *
 * @returns {{modulo: string, funcao: string, chave: string}|null}
 */
export function alvoDeChamada(alvo, aliases = {}) {
  if (!alvo || typeof alvo !== "string") return null;

  const bruto = String(alvo).trim();
  if (!bruto) return null;

  /*
   * Caminho C e B juntos: `movimento.gb_move` pode ser o uso direto do
   * atributo, ou o alias de `from movimento import gb_move as X`.
   *
   * O alias tem precedência quando bate com o nome inteiro, porque é a
   * informação explícita do arquivo.
   */
  const peloAlias = Object.prototype.hasOwnProperty.call(aliases, bruto) ? aliases[bruto] : null;
  if (peloAlias) return alvoDeChamada(peloAlias, {});

  if (bruto.includes(".")) {
    const partes = bruto.split(".");
    const funcao = partes.pop();
    const modulo = partes.join(".");
    return { modulo, funcao, chave: `${modulo}.${funcao}` };
  }

  /*
   * Nome solto sem alias: pode ser uma função do próprio arquivo do
   * usuário (que não é de biblioteca nenhuma). Registrado com módulo
   * vazio, porque isso é informação — não é a mesma coisa que "não sei".
   */
  return { modulo: "", funcao: bruto, chave: bruto };
}

/**
 * Decide como a chamada tem que ser ESCrita de volta no Python.
 *
 * `forma` é a informação que não pode ser inventada na hora de gerar: o
 * arquivo pode ter usado alias, atributo ou nome direto, e trocar isso
 * muda o programa.
 *
 * @returns {"alias"|"atributo"|"direto"}
 */
export function formaDeEscrita(chamada, aliases = {}) {
  const texto = String(chamada ?? "").trim();
  if (!texto) return "direto";
  if (texto.includes(".")) return "atributo";

  const resolvido = aliases[texto];
  if (resolvido && resolvido.includes(".")) return "alias";
  return "direto";
}

/* ------------------------------------------------------------------ */
/* Registro de módulos                                                 */
/* ------------------------------------------------------------------ */

/**
 * Guarda as funções conhecidas por módulo e responde "quem é essa
 * chamada?".
 *
 * A chave é `modulo.funcao`, que é a mesma para os três caminhos de
 * import. Isso é o que faz o bloco ser o mesmo não importa como o Python
 * foi escrito.
 */
export function criarRegistroModulos() {
  /** @type {Map<string, {modulo: string, funcoes: Map<string, FunctionSchema>}>} */
  const modulos = new Map();

  return {
    /**
     * Publica (ou substitui) as funções de um módulo.
     *
     * Substituir inteiro, e não mesclar, é o que faz a atualização por
     * mudança de assinatura funcionar: se a biblioteca removeu um
     * argumento, o schema antigo não pode sobrar pendurado.
     */
    registrar(modulo, funcoes = []) {
      const mapa = new Map();
      for (const fn of funcoes) {
        if (!fn || !fn.name) continue;
        mapa.set(fn.name, fn);
      }
      modulos.set(String(modulo), { modulo: String(modulo), funcoes: mapa });
      return this;
    },

    /** Remove um módulo (arquivo apagado). */
    remover(modulo) {
      modulos.delete(String(modulo));
      return this;
    },

    /** Funções de um módulo, como array. */
    funcoesDe(modulo) {
      return [...(modulos.get(String(modulo))?.funcoes.values() ?? [])];
    },

    /** Todos os módulos registrados. */
    modulos() {
      return [...modulos.keys()];
    },

    /** `true` quando o módulo está conhecido. */
    temModulo(modulo) {
      return modulos.has(String(modulo));
    },

    /**
     * Procura a função de uma chamada.
     *
     * A busca é pelo par (modulo, funcao) e, se o módulo não estiver no
     * registro, por QUALQUER módulo que tenha uma função com esse nome.
     * O segundo passo é o que salva o `gb_move` usado sem import nenhum —
     * comum quando o arquivo da biblioteca já foi importado em outro ponto.
     *
     * Devolve `null` quando não há. `null` é informação útil: o chamador
     * sinaliza o fallback em vez de fingir que sabe.
     */
    resolver(alvo, aliases = {}) {
      const alvoNorm = alvoDeChamada(alvo, aliases);
      if (!alvoNorm) return null;

      if (alvoNorm.modulo) {
        const direta = modulos.get(alvoNorm.modulo)?.funcoes.get(alvoNorm.funcao);
        if (direta) return { ...direta, modulo: alvoNorm.modulo, origem: "modulo" };
      }

      for (const [modulo, pacote] of modulos) {
        const achada = pacote.funcoes.get(alvoNorm.funcao);
        if (achada) return { ...achada, modulo, origem: "busca" };
      }

      return null;
    },

    /**
     * Nomes que a criança pode digitar para chamar cada função.
     *
     * Serve ao autocompletar e, principalmente, ao painel de blocos: o
     * nome que aparece é o do arquivo, não um nome interno.
     */
    nomesConhecidos() {
      const nomes = new Set();
      for (const pacote of modulos.values()) {
        for (const nome of pacote.funcoes.keys()) nomes.add(nome);
      }
      return [...nomes];
    },
  };
}

/* ------------------------------------------------------------------ */
/* Assinatura de conteúdo                                              */
/* ------------------------------------------------------------------ */

/**
 * Assinatura barata do conteúdo de um arquivo.
 *
 * É o que decide se um módulo precisa ser reprocessado. Sem isto, cada
 * tecla digitada reanalisaria a biblioteca inteira; com isto, só o arquivo
 * que mudou é refeito.
 *
 * Não é criptografia nem checksum de segurança: é uma impressão digital
 * para comparação. O tamanho entra junto porque troca de um caractere que
 * mantém o mesmo texto é justamente o caso que a comparação precisa pegar.
 */
export function assinaturaDe(conteudo) {
  const texto = String(conteudo ?? "");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
    h2 = (h2 ^ (h2 << 13)) >>> 0;
  }

  return `${texto.length}:${h1.toString(36)}:${h2.toString(36)}`;
}

/**
 * Decide se um módulo precisa ser reprocessado.
 *
 * Três sinais, na ordem em que eliminam trabalho:
 *   1. arquivo diferente            -> mudou
 *   2. mesmo conteúdo               -> NÃO mudou (o caso comum)
 *   3. mesmo conteúdo, mtime novo  -> NÃO mudou (toque sem edição)
 *
 * O passo 3 importa porque salvar sem editar é comum no editor, e
 * reprocessar a biblioteca nesse caso seria desperdício.
 */
export function precisaReprocessar(anterior, atual) {
  if (!anterior) return true;
  if (!atual) return true;
  if (anterior.arquivo !== atual.arquivo) return true;

  const assinatura = assinaturaDe(atual.conteudo);
  if (anterior.assinatura !== assinatura) return true;

  // Mesmo conteúdo: nada a fazer, mesmo que o disco tenha mudado de hora.
  return false;
}

/**
 * Rastreia arquivos de biblioteca e diz o que precisa ser reprocessado.
 *
 * `registrar` é idempotente: registrar o mesmo conteúdo duas vezes não
 * marca nada para reprocessar. É o que impede o ciclo de atualização de
 * ficar reescrevendo blocos para sempre.
 */
export function criarRastreadorArquivos() {
  const vistos = new Map();

  return {
    /**
     * @returns {{modulo: string, mudou: boolean, anterior: object|null}}
     */
    registrar(arquivo, conteudo) {
      const chave = String(arquivo);
      const atual = { arquivo: chave, conteudo, assinatura: assinaturaDe(conteudo) };
      const anterior = vistos.get(chave) ?? null;
      const mudou = precisaReprocessar(anterior, atual);
      vistos.set(chave, atual);
      return { modulo: chave, mudou, anterior };
    },

    /** `true` quando este arquivo já foi visto com este conteúdo. */
    conhecido(arquivo, conteudo) {
      const anterior = vistos.get(String(arquivo));
      return Boolean(anterior) && anterior.assinatura === assinaturaDe(conteudo);
    },

    esquecer(arquivo) {
      vistos.delete(String(arquivo));
    },

    tamanho() {
      return vistos.size;
    },
  };
}
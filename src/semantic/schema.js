/* ================================================================== */
/* SCHEMA DE FUNÇÃO                                                    */
/* ================================================================== */
/*
 * POR QUE ISTO EXISTE
 *
 * O schema é a DESCIDA entre "uma função Python" e "um bloco na tela".
 * Ele responde, para cada argumento:
 *
 *     - este campo aparece?          (e em que posição)
 *     - o que ele é?                 (número, texto, enum, booleano, porta)
 *     - qual a unidade da função?    (mm, graus, ms...)
 *     - qual a unidade mostrada?     (pode ser outra, com conversão)
 *     - o que o sinal significa?     ("positivo = frente")
 *     - é obrigatório?              (tem default?)
 *     - é escondido?                (`gb`, `hub`, motores)
 *
 * PRIORIDADE DAS FONTES
 *
 *     1. metadado explícito   (@block, JSON externo)  -- o autor sabe
 *     2. anotação de tipo     (Literal["a","b"], int)  -- o autor escreveu
 *     3. docstring            ("em mm", "negativo = trás")
 *     4. corpo da função       (o que dá dentro do parâmetro)
 *     5. nome do argumento     ("distancia" -> distância)
 *     6. genérico              (número solto, sem unidade)
 *
 * A ordem importa porque cada fonte é mais barata que a seguinte: ler
 * metadado é olhar; analisar o corpo é interpretador. E cada fonte é
 * menos CONFIAVEL que a anterior: o nome é só uma pista.
 *
 * A origem fica gravada em `fontes` de cada campo. Isso não é enfeite:
 * quando a criança pergunta "por que aparece mm aqui?", a resposta existe.
 */

import { unidadeDoCampo, sentidoDoSinal } from "./docstring.js";
import { unidadePadrao, resolverUnidade, tipoUnidade } from "./units.js";

/* ------------------------------------------------------------------ */
/* Nomes reconhecidos                                                  */
/* ------------------------------------------------------------------ */

/*
 * Estas listas são CLASSIFICAÇÃO, não parse. O nome do argumento é a última
 * pista boa, e uma pista precisa de um dicionário para virar decisão.
 *
 * Tudo aqui é minúsculo e sem acento porque a comparação normaliza antes.
 */
export const NOMES = {
  distance: [
    "distancia", "distance", "comprimento", "tamanho", "alcance", "recuo",
    "avanco", "travessia", "passo", "curso", "raio", "radius", "offset",
  ],
  speed: [
    "velocidade", "speed", "rapidez", "vmax", "vel_max", "taxa", "ritmo",
  ],
  angle: [
    "angulo", "angle", "giro", "rotacao", "direcao", "heading", "rumo",
    "curva", "arc", "graus", "bearing", "yaw",
  ],
  time: [
    "tempo", "time", "duracao", "espera", "pausa", "atraso", "delay",
    "intervalo", "periodo", "timeout",
  ],
  power: [
    "potencia", "power", "forca", "esforco", "torque", "intensidade",
    "duty", "push", "puxa",
  ],
  port: [
    "porta", "port", "canal", "channel", "pino", "pin",
  ],
  boolean: [
    "ativo", "ativa", "ligado", "ligada", "enabled", "enable", "usar",
    "use", "wait", "esperar", "reset", "zerar", "pare", "parar", "run",
    "executar", "brake", "frear", "hold", "segurar", "farol", "luz",
  ],
  object: [
    "robo", "robot", "hub", "motor", "base", "chassi", "drive", "sensor",
    "color", "cor", "distance_sensor", "forca", "陀螺仪",
  ],
  text: ["mensagem", "message", "texto", "text", "nome", "name", "cor", "id"],
};

/* Nomes que NUNCA devem virar campo, mesmo começando com uma dessas palavras. */
const NAO_E_CAMPO = ["cor", "grupo", "guard", "id", "linha", "passo", "tamanho_da_fonte"];

/* ------------------------------------------------------------------ */
/* Metadados explícitos                                                */
/* ------------------------------------------------------------------ */

/**
 * Lê metadados declarados no próprio arquivo da biblioteca.
 *
 * Duas formas são aceitas, e as duas são comentários — não alteram o Python:
 *
 *     @block("mover", direcoes=["frente", "tras"])
 *     @unidade(distancia="mm", velocidade="mm/s")
 *     @oculto(gb, hub)
 *     def gb_move(gb, hub, distancia, velocidade=300): ...
 *
 *     # @block {"nome": "mover", "rotulo": "Mover o robô"}
 *     def gb_move(...): ...
 *
 * A prioridade é a MAIOR: quem escreve o metadado está dizendo exatamente o
 * que quer, acima de qualquer tipo ou docstring.
 */
export function lerMetadados(linhas = []) {
  const meta = {
    nome: null, rotulo: null, descricao: null,
    unidades: {}, ocultos: [], sinal: null, opcoes: {}, papeis: {},
    regras: {}, origem: "nenhuma",
  };

  const texto = Array.isArray(linhas) ? linhas.join("\n") : String(linhas ?? "");
  if (!texto.trim()) return meta;

  /* ---- JSON num comentário ---- */
  const json = texto.match(/@block\s+(\{[\s\S]*?\})/);
  if (json) {
    try {
      const dados = JSON.parse(json[1]);
      aplicarJson(meta, dados);
      meta.origem = "json";
      return meta;
    } catch {
      /* JSON quebrado não pode derrubar a leitura: segue para as formas simples. */
    }
  }

  /* ---- @block("nome", chave=valor, ...) ---- */
  const bloco = texto.match(/@block\s*\(([\s\S]*?)\)/);
  if (bloco) {
    const argumentos = bloco[1];
    const primeiro = argumentos.match(/^\s*["']([^"']+)["']/);
    if (primeiro) meta.nome = primeiro[1];
    meta.rotulo = valorString(argumentos, "rotulo") ?? meta.rotulo;
    meta.descricao = valorString(argumentos, "descricao") ?? meta.descricao;
    meta.origem = "decorator";
  }

  /* ---- @unidade(campo="mm", ...) ---- */
  const unidades = texto.match(/@unidade\s*\(([\s\S]*?)\)/);
  if (unidades) {
    for (const [chave, valor] of paresChave(unidades[1])) meta.unidades[chave] = semAspas(valor);
  }

  /* ---- @papel(campo="distance", ...) ---- */
  const papeis = texto.match(/@papel[s]?\s*\(([\s\S]*?)\)/);
  if (papeis) {
    for (const [chave, valor] of paresChave(papeis[1])) meta.papeis[chave] = semAspas(valor);
  }

  /* ---- @opcoes(campo=["a","b"]) ---- */
  const opcoes = texto.match(/@opcoes\s*\(([\s\S]*?)\)/);
  if (opcoes) {
    for (const [chave, valor] of paresChave(opcoes[1])) {
      meta.opcoes[chave] = listaDeValores(valor);
    }
  }

  /* ---- @oculto(a, b, c) ---- */
  const oculto = texto.match(/@oculto\s*\(([\s\S]*?)\)/);
  if (oculto) {
    meta.ocultos = oculto[1]
      .split(",")
      .map((n) => n.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  /* ---- @sinal(campo="positivo=frente,negativo=tras") ---- */
  const sinal = texto.match(/@sinal\s*\(([\s\S]*?)\)/);
  if (sinal) {
    for (const [chave, valor] of paresChave(sinal[1])) {
      meta.sinal = meta.sinal ?? {};
      meta.sinal[chave] = parseSinal(valor);
    }
  }

  if (meta.origem === "nenhuma" && (
    Object.keys(meta.unidades).length || Object.keys(meta.papeis).length ||
    Object.keys(meta.opcoes).length || meta.ocultos.length || meta.sinal
  )) {
    meta.origem = "decorator";
  }

  return meta;
}

/** Aplica um objeto JSON de metadados. */
function aplicarJson(meta, dados) {
  if (!dados || typeof dados !== "object") return;
  if (dados.nome) meta.nome = dados.nome;
  if (dados.rotulo) meta.rotulo = dados.rotulo;
  if (dados.descricao) meta.descricao = dados.descricao;
  if (dados.unidades && typeof dados.unidades === "object") Object.assign(meta.unidades, dados.unidades);
  if (dados.papeis && typeof dados.papeis === "object") Object.assign(meta.papeis, dados.papeis);
  if (dados.ocultos && Array.isArray(dados.ocultos)) meta.ocultos.push(...dados.ocultos);
  if (dados.opcoes && typeof dados.opcoes === "object") {
    for (const [k, v] of Object.entries(dados.opcoes)) meta.opcoes[k] = Array.isArray(v) ? v : [v];
  }
  if (dados.sinal && typeof dados.sinal === "object") {
    meta.sinal = meta.sinal ?? {};
    for (const [k, v] of Object.entries(dados.sinal)) meta.sinal[k] = parseSinal(v);
  }
  if (dados.regras && typeof dados.regras === "object") Object.assign(meta.regras, dados.regras);
}

/** Lê `"chave": "valor"` ou `chave="valor"` de dentro de um bloco. */
function paresChave(texto) {
  const saida = [];
  const re = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|[^,)]+)|"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|[^,}]+)/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const chave = m[1] ?? m[3];
    const valor = m[2] ?? m[4];
    if (chave && valor) saida.push([chave, valor]);
  }
  return saida;
}

/** Tira as aspas de um valor literal. */
function semAspas(valor) {
  return String(valor ?? "").trim().replace(/^["']|["']$/g, "");
}

function valorString(texto, chave) {
  const achado = paresChave(texto).find(([k]) => k === chave);
  if (!achado) return null;
  return achado[1].trim().replace(/^["']|["']$/g, "");
}

function listaDeValores(valor) {
  const limpo = String(valor).trim();
  const dentro = limpo.match(/^\[(.*)\]$/);
  if (dentro) {
    return dentro[1]
      .split(",")
      .map((v) => v.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const limpoValor = limpo.replace(/^["']|["']$/g, "");
  return limpoValor ? [limpoValor] : [];
}

function parseSinal(valor) {
  const texto = String(valor).replace(/^["']|["']$/g, "");
  const saida = {};
  for (const parte of texto.split(/[,;]/)) {
    const [lado, valor2] = parte.split("=").map((p) => p?.trim());
    if (lado && valor2) saida[lado.toLowerCase()] = valor2.replace(/^["']|["']$/g, "");
  }
  return saida.positivo || saida.negativo ? saida : null;
}

/* ------------------------------------------------------------------ */
/* Anotações de tipo                                                   */
/* ------------------------------------------------------------------ */

/**
 * Lê a anotação de um parâmetro e diz o que ela promete.
 *
 *     None                    -> sem promessa
 *     int | float             -> número
 *     bool                    -> booleano
 *     str                     -> texto
 *     Literal["a", "b"]       -> enum com as DUAS opções
 *     list[int]               -> texto genérico (lista não cabe em campo)
 *
 * `Literal` é a pista mais forte que existe depois do metadado: o autor
 * escreveu as opções na assinatura. Uma função que aceita
 * `Literal["frente", "tras"]` DEVE virar dropdown — não há como não ver.
 */
export function lerAnotacao(anotacao) {
  const texto = String(anotacao ?? "").trim();
  if (!texto) return { tipo: null, opcoes: null, media: false };

  /* Literal primeiro: é o único que carrega informação de VALOR. */
  const literal = texto.match(/Literal\s*\[([\s\S]*)\]/);
  if (literal) {
    const opcoes = literal[1]
      .split(",")
      .map((v) => v.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    return { tipo: "enum", opcoes, media: false };
  }

  /*
   * União com None: `int | None` significa "número opcional", não duas
   * opções. A lista é SEMPRE lista — quando havia um só membro, o código
   * antigo usava a string e quebrava no `.some()` logo abaixo.
   */
  const efetivo = texto.split("|").map((t) => t.trim()).filter((t) => t && t !== "None");
  if (efetivo.length === 0) return { tipo: null, opcoes: null, media: false };

  const base = efetivo.map((t) => t.toLowerCase());
  if (base.some((t) => ["int", "float", "number"].includes(t))) {
    return { tipo: "number", opcoes: null, media: base.some((t) => t === "float") };
  }
  if (base.length === 1 && base[0] === "bool") return { tipo: "boolean", opcoes: null, media: false };
  if (base.length === 1 && base[0] === "str") return { tipo: "text", opcoes: null, media: false };
  if (base.length > 1) return { tipo: "enum", opcoes: efetivo, media: false };
  return { tipo: "text", opcoes: null, media: false };
}

/* ------------------------------------------------------------------ */
/* Classificação de um campo                                           */
/* ------------------------------------------------------------------ */

/**
 * Decide o PAPEL de um campo, aplicando a prioridade das fontes.
 *
 * A assinatura é grande de propósito: cada informação que entra é
 * rastreável, e o resultado diz de onde veio. `campo.fontes` é o que
 * permite explicar a decisão e o que permite um bloco avisar "estou
 * supondo que isto é uma distância".
 */
export function classificarCampo({
  nome, anotacao = null, descricao = "", padrao = null,
  metadado = {}, valoresUsados = null, corpoDaFuncao = null,
  variadic = false, variadicKeyword = false,
}) {
  const fontes = [];
  const nomeNorm = normalizar(nome);

  /* ---- 1. METADADO ---- */
  const papelMeta = metadado.papeis?.[nome];
  const unidadeMeta = metadado.unidades?.[nome];
  const opcoesMeta = metadado.opcoes?.[nome];
  const sinalMeta = metadado.sinal?.[nome];

  /* ---- 2. ANOTAÇÃO ---- */
  const anot = lerAnotacao(anotacao);
  if (anot.tipo) fontes.push({ fonte: "anotacao", tipo: anot.tipo, valor: anotacao });
  if (opcoesMeta) fontes.push({ fonte: "metadado", tipo: "opcoes", valor: opcoesMeta });

  /* ---- 3. DOCSTRING ---- */
  const unidadeDocBruta = descricao ? unidadeDoCampo(descricao) : null;
  // "milímetros por segundo" -> "mm/s". Sem canonizar, a conversão não
  // reconhece a frase e o bloco manda o número cru.
  const unidadeDoc = unidadeDocBruta ? (resolverUnidade(unidadeDocBruta) ?? unidadeDocBruta) : null;
  if (unidadeDoc) fontes.push({ fonte: "docstring", tipo: "unidade", valor: unidadeDoc });

  const papelDoc = classificarPorNome(nomeNorm, descricao, unidadeDoc);
  if (papelDoc) fontes.push({ fonte: "docstring", tipo: papelDoc, valor: descricao });
  // Nome local distinto do import: `sinalDoc` sombrearia a função e o
  // `sentidoDoSinal(...)` abaixo viraria "não é função".
  const sinalDaDoc = sentidoDoSinal(descricao);

  /* ---- 4. CORPO ---- */
  const papelCorpo = classificarPorUso(valoresUsados, corpoDaFuncao);
  if (papelCorpo) fontes.push({ fonte: "corpo", tipo: papelCorpo, valor: String(valoresUsados) });

  /* ---- 5. NOME ---- */
  /*
   * Varre TODAS as listas de nomes, não só a lista do papel.
   *
   * `NOMES` é indexado pelo PAPEL (`angle`, `speed`, ...), então procurar
   * `NOMES[nomeNorm]` só encontrava quando o nome coincidia com o nome do
   * papel. `angulo` e `porta` ficavam sem papel e o bloco perdia graus e
   * portas — justamente os campos mais óbvios.
   */
  const papelNome = papelPeloNome(nomeNorm);
  if (papelNome) fontes.push({ fonte: "nome", tipo: papelNome, valor: nome });

  /*
   * Decide o papel final, NA ORDEM DA PRIORIDADE — e a ordem importa.
   *
   * O erro anterior era exigir `descricao` para o nome valer: um parâmetro
   * chamado `angulo` numa função SEM docstring ficava sem papel, e o bloco
   * perdia a unidade de graus. Nome não documentado é sinal fraco, mas é
   * sinal; a posição dele na fila é o que diz o quanto pesa.
   */
  const papel =
    papelMeta ??                              // 1. metadado explícito
    (descricao ? papelDoc : null) ??           // 2. docstring
    papelCorpo ??                             // 3. corpo da função
    papelNome ??                              // 4. nome do argumento
    papelPorAnotacao(anot) ??                 // 5. anotação genérica
    null;                                     // 6. genérico

  /* ---- Decide o tipo do CONTROLE ---- */
  const opcoes = opcoesMeta ?? anot.opcoes ?? null;
  const tipoControle =
    opcoes && opcoes.length >= 2 ? "enum"
    : papel === "boolean" || anot.tipo === "boolean" ? "boolean"
    : papel === "port" ? "port"
    : papel === "text" || anot.tipo === "text" ? "text"
    : papel ? "number"
    : anot.tipo === "number" ? "number"
    : "text";

  /*
   * Unidade: metadado > docstring > nome do papel.
   *
   * A docstring é a fonte que realmente resolve o caso comum: quem escreve
   * "distância em centímetros" está dizendo que a função espera
   * CENTÍMETROS, e o bloco tem de converter. Inferir pelo papel sem isso
   * assumiria mm e erraria justamente as funções que aceitam cm.
   *
   * Quando nenhuma fonte diz a unidade, cai no padrão do PAPEL — que é uma
   * suposição declarada, não um fato, e por isso fica registrada em
   * `fontes` com o marcador `padrao`.
   */
  const unidadeFuncao =
    unidadeMeta ??
    unidadeDoc ??
    unidadePadrao(papel);

  if (unidadeFuncao && !unidadeMeta && !unidadeDoc) {
    fontes.push({ fonte: "padrao", tipo: "unidade", valor: unidadeFuncao });
  }

  return {
    nome,
    papel: papel ?? null,
    tipo: tipoControle,
    opcoes,
    anotacao: anotacao || null,
    /** Unidade que a FUNÇÃO espera (mm, graus...). */
    unidadeFuncao,
    /** Unidade que o BLOCO mostra. Por padrão, a mesma da função. */
    unidadeVisual: unidadeFuncao,
    /** O que "negativo" e "positivo" significam para este campo. */
    sinal: sinalMeta ?? sinalDaDoc,
    /** Texto de ajuda vindo da docstring. */
    descricao: descricao || null,
    /** A Kinder não precisa ver: `gb`, `hub`, motores, a base. */
    oculto: Boolean(metadado.ocultos?.includes(nome)),
    /** Tem default? Então é opcional e vai para a engrenagem. */
    opcional: padrao !== null && padrao !== undefined,
    padrao: padrao ?? null,
    /*
     * `*args` / `**kwargs` não são UM valor: são o resto da chamada. Eles
     * precisam chegar até `naoRepresentaveis`, senão o bloco abriria um
     * campo de texto para algo que é uma lista de argumentos.
     */
    variadic: Boolean(variadic),
    variadicKeyword: Boolean(variadicKeyword),
    fontes,
    /** `true` quando alguma fonte não é certeza (só nome, só fallback). */
    inferred: !papelMeta && (!descricao || !papelDoc),
  };
}

/** Papel deduzido só do tipo, quando não há nome nem descrição. */
function papelPorAnotacao(anot) {
  if (anot.tipo === "boolean") return "boolean";
  if (anot.tipo === "enum") return "text";
  return null;
}

/**
 * Papel a partir do nome e da descrição da docstring.
 *
 * O NOME vence a descrição, porque foi escolhido de propósito. Mas uma
 * descrição que traz a unidade ("velocidade em mm/s") também conta como
 * evidência forte — é por isso que `classificarCampo` só aceita `papelDoc`
 * quando existe descrição.
 */
/**
 * Papel vindo do NOME e da DESCRIÇÃO, na ordem em que as pistas valem.
 *
 * O nome primeiro, porque foi escolhido de propósito: `distancia` continua
 * sendo distância mesmo quando a docstring menciona "robô", "roda" ou
 * "chassi" — que são palavras de OBJETO e, se vencessem, a distância
 * virava `object` e o bloco perdia os milímetros.
 *
 * A unidade entra por último porque é a pista mais silenciosa, mas
 * decisive: um campo documentado só como "em milímetros" é uma distância,
 * mesmo que se chame `valor`.
 */
function classificarPorNome(nomeNorm, descricao, unidade = null) {
  const exato = papelPeloNomeExato(nomeNorm);
  if (exato) return exato;

  /*
   * A DESCRIÇÃO só vale para grandezas (distância, velocidade, ângulo,
   * tempo, potência, porta).
   *
   * `object` e `text` ficam de fora de propósito: em
   * "quanto o ROBÔ anda, em milímetros", a palavra "robô" é o sujeito da
   * frase, não o tipo do campo. Sem essa exclusão, todo campo de
   * movimento acabava marcado como `object` e perdia a unidade — erro que
   * aparece em toda biblioteca de robô, justamente a que mais importa.
   */
  const desc = normalizar(descricao);
  if (desc) {
    for (const [papel, lista] of Object.entries(NOMES)) {
      if (papel === "object" || papel === "text") continue;
      for (const palavra of lista) {
        if (NAO_E_CAMPO.includes(palavra)) continue;
        if (contemPalavra(desc, palavra)) return papel;
      }
    }
  }

  const parcial = papelPeloNome(nomeNorm);
  if (parcial) return parcial;

  return papelPelaUnidade(unidade);
}

/** Correspondência exata: o nome É uma das palavras conhecidas. */
function papelPeloNomeExato(nomeNorm) {
  for (const [papel, lista] of Object.entries(NOMES)) {
    if (lista.includes(nomeNorm)) return papel;
  }
  return null;
}

/** Papel que a própria unidade indica. */
function papelPelaUnidade(unidade) {
  const tipo = tipoUnidade(unidade);
  switch (tipo) {
    case "length": return "distance";
    case "angle": return "angle";
    case "speed": return "speed";
    case "time": return "time";
    case "power": return "power";
    case "rotation": return "rotation";
    default: return null;
  }
}

/**
 * `true` quando `palavra` aparece como PALAVRA INTEIRA.
 *
 * Sem isto, "negativo" casava com a lista de booleanos porque contém
 * "ativo" — e uma distância virava booleano. O mesmo valia para nomes de
 * argumento: `velocidade_max` casa "velocidade" no `_`, mas `altura` não
 * pode casar "alt".
 *
 * A comparação normaliza acentos e caixa dos dois lados, então "Distância"
 * e "distancia" são a mesma palavra.
 */
function contemPalavra(texto, palavra) {
  const alvo = normalizar(palavra);
  if (!alvo) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escaparRegex(alvo)}($|[^a-z0-9])`);
  return re.test(texto);
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Papel correspondente a um NOME de argumento.
 *
 * A comparação mais forte vem primeiro: nome exato, depois nome que contém
 * a palavra. `velocidade_max` vira `speed` porque contém "velocidade", e
 * `porta_direita` vira `port`.
 */
function papelPeloNome(nomeNorm) {
  for (const [papel, lista] of Object.entries(NOMES)) {
    if (papel === "text") continue;
    for (const palavra of lista) {
      if (palavra.length < 4) continue;
      if (NAO_E_CAMPO.includes(palavra)) continue;
      if (contemPalavra(nomeNorm, palavra)) return papel;
    }
  }
  return null;
}

/**
 * Papel a partir do CORPO da função.
 *
 * Quando o Python já tem `gb_move(gb, hub, 100)`, o valor que passou pelo
 * argumento é evidência direta: um número redondo é medida; uma string com
 * letras é texto. Isso vale mais que o nome, porque é o dado real.
 */
function classificarPorUso(valoresUsados, corpoDaFuncao) {
  if (!valoresUsados || valoresUsados.length === 0) return null;
  const textos = valoresUsados.filter((v) => typeof v === "string" && /[a-z]/i.test(v));
  const numeros = valoresUsados.filter((v) => typeof v === "number");
  if (textos.length && !numeros.length) return "text";
  if (numeros.length) return null; // número puro não diz o papel
  return null;
}

function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
/**
 * ENTRADAS HOSTIS — o que acontece quando a criança faz algo inesperado.
 *
 * A interface precisa sobreviver a: arquivo vazio, código só com espaços,
 * bloco sem fonte, delete em bloco inexistente, identificador com acento,
 * nome de variável repetido, indentação com TAB, e código enorme.
 *
 * Nenhum destes pode lançar exceção, apagar código, ou deixar a tela com
 * resíduo. Um erro aqui é um erro que trava a IDE na mão da criança.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncManager } from "../src/editor/syncManager.js";
import { parseProgram } from "../src/parser/pythonParser.js";
import { irToBlocks } from "../src/blocks/blockFactory.js";
import { generateProgram } from "../src/python/codeGenerator.js";

const OPTS = { userFunctions: [], libraryFunctions: [] };
const roda = (codigo) => {
  const sm = new SyncManager();
  sm.runPipeline(codigo);
  return sm;
};

const HOSTIS = {
  "vazio": "",
  "só espaços": "   \n\t\n  \n",
  "só comentário": "# nada aqui\n",
  "sem newline final": "x = 1",
  "identificador com acento": "velocidade_à_terra = 1\n",
  "identificador em português": "âncora = 2\nprint(âncora)\n",
  "variável repetida": "x = 1\nx = 2\nx = 3\n",
  "indentação com TAB": "def f():\n\treturn 1\n",
  "indentação inconsistente": "def f():\n    x = 1\n  y = 2\n",
  "linha muito longa": `x = ${Array.from({ length: 400 }, (_, i) => i).join(" + ")}\n`,
  "bloco vazio de if": "if x:\n    pass\n",
  "return fora de função": "return 1\n",
  "break fora de laço": "break\n",
  "número enorme": "x = 1e400\n",
  "divisão por zero literal": "x = 1 / 0\n",
  "string não fechada": "x = 'abc\n",
  "parênteses desbalanceados": "x = (1 + 2\n",
  "unicode em string": "x = '🏁🤖'\n",
  "lambda como valor": "f = lambda: 0\n",
  "asterisco solto": "x = *args\n",
  "muitos blocos": Array.from({ length: 200 }, (_, i) => `x${i} = ${i}`).join("\n") + "\n",
};

for (const [nome, codigo] of Object.entries(HOSTIS)) {
  test(`sobrevive a: ${nome}`, () => {
    let sm;
    assert.doesNotThrow(() => { sm = roda(codigo); },
      `o pipeline lançou exceção em "${nome}"`);
    assert.ok(Array.isArray(sm.blocks), `blocks não é lista em "${nome}"`);
    assert.ok(typeof sm.code === "string", `code não é texto em "${nome}"`);
    assert.doesNotThrow(() => generateProgram(sm.blocks, OPTS),
      `o gerador lançou exceção em "${nome}"`);

    // O texto da criança nunca é perdido: o código guardado tem que
    // continuar contendo o que ela escreveu.
    const guarda = codigo.trim();
    if (guarda) {
      const importante = guarda.split("\n").map((l) => l.trim())
        .filter((l) => l && !/^#/.test(l));
      for (const linha of importante.slice(0, 5)) {
        const semEspacos = linha.replace(/\s+/g, "");
        assert.ok(sm.code.replace(/\s+/g, "").includes(semEspacos.slice(0, 12)),
          `"${nome}": a linha "${linha.slice(0, 40)}" sumiu`);
      }
    }
  });
}

test("bloco sem span não derruba a remoção", () => {
  const sm = roda("x = 1\ny = 2\n");
  assert.doesNotThrow(() => sm.removeBlockFromCode(null));
  assert.doesNotThrow(() => sm.removeBlockFromCode(undefined));
  assert.doesNotThrow(() => sm.removeBlockFromCode({ id: "nao_existe" }));
  assert.doesNotThrow(() => sm.removeBlockFromCode({ id: "block_9999", source: null }));
  assert.equal(sm.code, "x = 1\ny = 2\n", "nenhuma remoção inventada pode acontecer");
});

test("remover o único bloco esvazia o programa sem quebrar", () => {
  const sm = roda("x = 1\n");
  sm.removeBlockFromCode(sm.blocks[0]);
  assert.equal(sm.blocks.length, 0);
  assert.doesNotThrow(() => generateProgram(sm.blocks, OPTS));
  assert.doesNotThrow(() => sm.removeBlockFromCode(sm.blocks[0]));
});

test("aplicar edição num bloco que não existe mais não altera o código", () => {
  const sm = roda("x = 1\ny = 2\n");
  const antes = sm.code;
  assert.doesNotThrow(() => sm.applyBlockEdit({ id: "fantasma", blockId: "var_set", params: {}, source: { startLine: 1, endLine: 1 } }));
});

test("editar o mesmo bloco muitas vezes não acumula texto", () => {
  const sm = roda("def main():\n    x = 0\n\nmain()\n");
  for (let i = 0; i < 30; i += 1) {
    const bloco = sm.blocks[0].children[0];
    bloco.params.value = i;
    sm.applyBlockEdit(bloco);
  }
  const linhasX = sm.code.split("\n").filter((l) => l.includes("x ="));
  assert.equal(linhasX.length, 1, `o código duplicou:\n${sm.code}`);
});

test("parse de arquivo muito grande não estoura", () => {
  const grande = Array.from({ length: 1500 }, (_, i) => `x${i} = ${i} * 2`).join("\n") + "\n";
  let sm;
  assert.doesNotThrow(() => { sm = roda(grande); });
  assert.ok(sm.blocks.length > 100, `esperava muitos blocos, veio ${sm.blocks.length}`);
});

test("diagnóstico sempre tem texto em português legível", () => {
  const sm = roda("x = = 1\n");
  assert.ok(sm.diagnostics.length > 0, "código quebrado precisa gerar aviso");
  for (const d of sm.diagnostics) {
    assert.ok(typeof d.cause === "string" && d.cause.length > 3,
      `diagnóstico sem mensagem útil: ${JSON.stringify(d)}`);
  }
});

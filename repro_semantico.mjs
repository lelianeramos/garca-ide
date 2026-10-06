import { SyncManager } from "./src/editor/syncManager.js";
import { parseProgram } from "./src/parser/pythonParser.js";
import { irToBlocks } from "./src/blocks/blockFactory.js";
import { generateProgram } from "./src/python/codeGenerator.js";
import { blockInnerHtml } from "./src/blocks/blockRenderer.js";

const libs = [{
  file_id: "lib1", path: "libraries/movimento.py", name: "movimento.py",
  module_name: "movimento",
  content: `def gb_move(gb, hub, distancia, velocidade=300):
    """Move o robô em linha reta.

    distancia:
        Distância em milímetros.
        Positivo = frente. Negativo = ré.

    velocidade:
        Velocidade em mm/s.
    """
    gb.straight(distancia, velocidade)


def gb_turn(gb, hub, angulo, velocidade=300):
    """Gira o robô."""
    gb.turn(angulo, velocidade)
`,
}];

const codigo = `from libraries.movimento import gb_move, gb_turn

def main():
    gb_move(gb, hub, 100)
    gb_move(gb, hub, -150)
    gb_turn(gb, hub, 90)
    gb_move(gb, hub, distancia_alvo)
    gb_move(gb, hub, distancia_alvo * 2)

main()
`;

const sm = new SyncManager();
sm.setLibraryFiles(libs);
sm.runPipeline(codigo);
console.log("estado:", sm.state, "| diagnosticos:", sm.diagnostics.length);
for (const d of sm.diagnostics.slice(0,3)) console.log("  ", d.cause ?? d.message);

const achatar = (b, out=[]) => { for (const x of b) { out.push(x); achatar(x.children,out); } return out; };
console.log("\n=== BLOCOS ATUAIS ===");
for (const b of achatar(sm.blocks)) {
  console.log(`  ${b.blockId}: ${JSON.stringify(b.params).slice(0,170)}`);
}
console.log("\n=== PYTHON REGENERADO ===");
console.log(generateProgram(sm.blocks, { userFunctions: [], libraryFunctions: [] }));

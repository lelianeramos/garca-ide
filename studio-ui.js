/**
 * STUDIO-UI — entrada do frontend
 * -------------------------------
 * REGRA R01 / B20 / N16: o arquivo de entrada do frontend NUNCA se chama
 * app.js nem app.mjs. A Vercel interpreta qualquer arquivo de nome genérico
 * na raiz como função serverless Node e executa o frontend no servidor, onde
 * `document` não existe:
 *
 *   ReferenceError: document is not defined
 *       at $ (file:///var/task/garca-studio/app.mjs:344:27)
 *
 * Este módulo não toca em `document` no escopo de topo. Todo acesso ao DOM
 * acontece dentro de `boot()`, disparado quando o documento já existe.
 * Assim, mesmo que seja importado fora do navegador, ele apenas exporta a
 * função e termina sem erro.
 */

import { start } from "./src/bootstrap.js";

const hasDom = typeof window !== "undefined" && typeof document !== "undefined";

function launch() {
  try {
    start();
  } catch (error) {
    // Falha de inicialização nunca deixa a tela em branco sem explicação
    console.error("[Garça Studio] falha ao iniciar:", error);
    if (hasDom) {
      const banner = document.createElement("div");
      banner.className = "boot-error";
      banner.setAttribute("role", "alert");
      banner.innerHTML =
        "<strong>Não foi possível iniciar a interface.</strong>" +
        "<p>Verifique se <code>block-engine.js</code>, <code>vendor/compiler.js</code> e a pasta <code>src/</code> foram publicados.</p>" +
        "<pre></pre>";
      banner.querySelector("pre").textContent = String(error?.message ?? error);
      document.body?.prepend(banner);
    }
  }
}

if (hasDom) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", launch, { once: true });
  } else {
    launch();
  }
}

export { launch };

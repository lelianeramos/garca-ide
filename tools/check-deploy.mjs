/**
 * VERIFICADOR DE DEPLOY — Parte 29 (F10) / N22
 * --------------------------------------------
 * "Não declarar nenhuma etapa concluída sem testar."
 *
 * Roda localmente ANTES do deploy e confere os itens que já quebraram a
 * publicação na Vercel. Cada checagem imprime PASSA/FALHA e o script termina
 * com código 1 se qualquer item crítico falhar.
 *
 * Uso:  npm run vercel:doctor
 */

import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const resultados = [];
let criticas = 0;

function registrar(grupo, item, ok, detalhe = "", critico = true) {
  resultados.push({ grupo, item, ok, detalhe, critico });
  if (!ok && critico) criticas += 1;
}

const ler = async (rel) => readFile(join(ROOT, rel), "utf8").catch(() => null);
const existe = (rel) => existsSync(join(ROOT, rel));
const tamanho = async (rel) => (await stat(join(ROOT, rel)).catch(() => null))?.size ?? -1;

async function main() {
  /* ---------------------------------------------------------------- */
  /* B20 — o erro que derrubou o deploy na Vercel                     */
  /* ---------------------------------------------------------------- */
  // "ReferenceError: document is not defined at $ (file:///var/task/garca-studio/app.mjs)"
  // Causa: a Vercel tratou um arquivo de frontend na raiz como função serverless
  // e o executou no Node, onde `document` não existe.
  registrar("B20", "nenhum app.js/app.mjs na raiz", !existe("app.js") && !existe("app.mjs"),
    existe("app.mjs") ? "app.mjs existe na raiz — a Vercel vai empacotá-lo como função" : "");

  const raiz = (await ler(".")) === null;
  const arquivosRaiz = ["studio-ui.js", "index.html"];
  for (const arquivo of arquivosRaiz) {
    registrar("B20", `${arquivo} presente na raiz`, existe(arquivo));
  }
  void raiz;

  const html = await ler("index.html");
  if (html) {
    registrar("B20", 'index.html carrega studio-ui.js como módulo',
      /<script[^>]+type="module"[^>]+src="studio-ui\.js"/.test(html),
      /src="app\.js"/.test(html) ? 'ainda referencia src="app.js"' : "");

    registrar("Segurança", "nenhum script de terceiros injetado no HTML",
      !/cdn-cgi|cloudflareinsights|challenges\.cloudflare/.test(html),
      "há referência a CDN de desafio — remove-a antes do deploy");

    registrar("N16", "nenhuma imagem local inexistente referenciada",
      !(html.match(/src="assets\/[^"]+"/g) ?? []).some((ref) => !existe(ref.slice(5, -1))),
      (html.match(/src="assets\/[^"]+"/g) ?? []).filter((r) => !existe(r.slice(5, -1))).join(", "));
  }

  /* ---------------------------------------------------------------- */
  /* N17 — compilador MicroPython                                     */
  /* ---------------------------------------------------------------- */
  const wasmBytes = await tamanho("vendor/mpy-cross-v6.wasm");
  registrar("N17", "vendor/mpy-cross-v6.wasm existe", wasmBytes > 0, `tamanho: ${wasmBytes}`);
  registrar("N17", "wasm não é um placeholder vazio", wasmBytes > 200_000,
    wasmBytes >= 0 && wasmBytes < 200_000 ? `apenas ${wasmBytes} bytes — parece placeholder` : "");
  registrar("N17", "vendor/compiler.js presente", existe("vendor/compiler.js"));

  const vercel = await ler("vercel.json");
  if (vercel) {
    registrar("N17", "vercel.json serve .wasm com application/wasm",
      /application\/wasm/.test(vercel),
      "sem o MIME correto o navegador recusa instanciar o módulo");
  }

  /* ---------------------------------------------------------------- */
  /* S01/S03 — segredos                                               */
  /* ---------------------------------------------------------------- */
  registrar("S03", ".env existe no .gitignore", /\.env\b/.test((await ler(".gitignore")) ?? ""));
  registrar("S03", ".env existe no .vercelignore", /\.env\b/.test((await ler(".vercelignore")) ?? ""));
  registrar("S03", ".env.example é o único .env versionado", !existe(".env"),
    existe(".env") ? ".env local detectado — confira se está ignorado antes do commit" : "", false);

  const frontendFiles = ["studio-ui.js", "src/bootstrap.js"];
  for (const arquivo of frontendFiles) {
    const codigo = await ler(arquivo);
    if (!codigo) continue;
    registrar("S01", `${arquivo} não referencia GITHUB_TOKEN`,
      !/GITHUB_TOKEN|github_pat_/.test(codigo));
  }

  // nenhum token colado em qualquer arquivo rastreado
  const suspeitos = [];
  for (const arquivo of ["index.html", "studio-ui.js", "src/bootstrap.js", "vercel.json", "README.md", ".env.example"]) {
    const codigo = await ler(arquivo);
    if (codigo && /github_pat_[A-Za-z0-9_]{20,}/.test(codigo)) suspeitos.push(arquivo);
  }
  registrar("S05", "nenhum token real colado nos arquivos", suspeitos.length === 0, suspeitos.join(", "));

  /* ---------------------------------------------------------------- */
  /* Backend Python — resolução de caminho pós-reestruturação         */
  /* ---------------------------------------------------------------- */
  registrar("API", "api/project/format.py presente", existe("api/project/format.py"));
  registrar("API", "api/project/semantic.py presente", existe("api/project/semantic.py"));
  registrar("API", "api/github/avatar.js presente", existe("api/github/avatar.js"));
  registrar("API", "pybricks-api.json presente na raiz", existe("pybricks-api.json"));

  const format = await ler("api/project/format.py");
  if (format) {
    // parents[2] de api/project/format.py == raiz do projeto
    registrar("API", "format.py resolve o catálogo com parents[2]",
      /parents\[2\]/.test(format),
      "após mover para api/project/ o índice de parents mudou");
  }
  registrar("API", "vercel.json inclui pybricks-api.json em format.py",
    /"includeFiles":\s*"pybricks-api\.json"/.test(vercel ?? ""),
    "sem includeFiles o catálogo não existe em runtime na Vercel");

  /* ---------------------------------------------------------------- */
  /* B16 — projeto novo começa vazio                                  */
  /* ---------------------------------------------------------------- */
  const bootstrap = await ler("src/bootstrap.js");
  if (bootstrap) {
    registrar("B16", "bootstrap limpa rascunhos antigos",
      /LEGACY_KEYS/.test(bootstrap) && /migrateLegacyStorage/.test(bootstrap));
    registrar("B20", "bootstrap não acessa document no topo do módulo",
      /const hasDom = typeof window !== "undefined"/.test(bootstrap));
  }

  const vfs = await ler("src/ui/vfs.js");
  if (vfs) {
    registrar("B16", "emptyProject() gera só main.py + saida_1.py vazios",
      /emptyProject/.test(vfs));
    registrar("B16", "nenhum programa de exemplo embutido",
      !/from pybricks\.hub import PrimeHub\s*\n\s*hub\s*=\s*PrimeHub\(\)/.test(vfs),
      "", false);
  }

  /* ---------------------------------------------------------------- */
  /* Estrutura (Parte 19.1)                                           */
  /* ---------------------------------------------------------------- */
  const obrigatorios = [
    "index.html", "studio-ui.js", "styles.css", "ui-upgrades.css",
    "block-system.css", "icon-system.css", "semantic-system.css",
    "src/bootstrap.js", "src/blocks/blockCatalog.js", "src/blocks/blockFactory.js",
    "src/blocks/blockRenderer.js", "src/parser/pythonParser.js",
    "src/semantic/analyzer.js", "src/python/codeGenerator.js", "src/python/bundler.js",
    "src/editor/pythonEditor.js", "src/editor/syncManager.js",
    "src/diagnostics/errorParser.js", "src/ui/icons.js", "src/ui/sound.js",
    "src/ui/vfs.js", "src/ui/history.js", "src/ui/terminal.js",
    "src/ui/workspace.js", "src/ui/editorView.js", "src/ui/githubPanel.js",
    "tests/block_engine.test.cjs", "tests/test_core.py", "tests/test_format.py",
  ];
  const ausentes = obrigatorios.filter((arquivo) => !existe(arquivo));
  registrar("Parte 19.1", "todos os módulos obrigatórios existem", ausentes.length === 0, ausentes.join(", "));

  /* ---------------------------------------------------------------- */
  /* N10/B21 — nenhum emoji como ícone de interface                   */
  /* ---------------------------------------------------------------- */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}]/u;
  const icones = await ler("src/ui/icons.js");
  if (icones) {
    registrar("N10", "icons.js não usa emoji", !EMOJI.test(icones.replace(/\\u[0-9a-fA-F]+/g, "")));
  }

  /* ---------------------------------------------------------------- */
  /* Deploy Vercel — "No entrypoint found" e o warning do engines      */
  /*                                                                    */
  /* A Vercel infere um servidor Node.js a partir do package.json da    */
  /* raiz quando não há framework reconhecido, e então exige um         */
  /* entrypoint (app.js/index.js/server.js/main.js). Como este projeto  */
  /* é estático + api/**, o build falhava com:                          */
  /*   Error: No entrypoint found in "/vercel/path0"                    */
  /* A correção é "framework": null no vercel.json, que sobrescreve o   */
  /* preset do dashboard, + nenhum script que sugira servidor.          */
  /* ---------------------------------------------------------------- */
  let vercelJson = null;
  let packageJson = null;
  try { vercelJson = JSON.parse(vercel ?? ""); } catch { /* reportado abaixo */ }
  try { packageJson = JSON.parse((await ler("package.json")) ?? ""); } catch { /* idem */ }

  registrar("Vercel", "vercel.json é JSON válido", vercelJson !== null);
  registrar("Vercel", 'vercel.json tem "framework": null (força deploy estático)',
    vercelJson?.framework === null,
    "sem isso a Vercel infere servidor Node e falha com 'No entrypoint found'");
  registrar("Vercel", 'buildCommand vazio', vercelJson?.buildCommand === "",
    `valor atual: ${JSON.stringify(vercelJson?.buildCommand)}`);
  registrar("Vercel", 'outputDirectory vazio', vercelJson?.outputDirectory === "",
    `valor atual: ${JSON.stringify(vercelJson?.outputDirectory)}`);

  registrar("Vercel", "package.json é JSON válido", packageJson !== null);
  registrar("Vercel", 'package.json não tem "main"',
    !("main" in (packageJson ?? {})),
    '"main" faz a Vercel procurar um servidor Node na raiz');

  const scripts = packageJson?.scripts ?? {};
  registrar("Vercel", 'sem script "start" (sinaliza servidor Node)',
    !("start" in scripts),
    `start = ${JSON.stringify(scripts.start)}`);
  registrar("Vercel", 'sem script "build" que sugira compilação Node',
    !("build" in scripts),
    `build = ${JSON.stringify(scripts.build)}`);

  // engines.node: range solto gera o warning "will automatically upgrade"
  const nodeRange = packageJson?.engines?.node ?? "";
  registrar("Vercel", "engines.node é versão major fixa (sem >= ^ ~)",
    /^\d+\.x$/.test(nodeRange),
    `valor atual: ${JSON.stringify(nodeRange)} — use "22.x"`, false);

  // Node 20 entrou em EOL: novos builds na Vercel falham desde 2026-10-01
  const major = Number(/^(\d+)/.exec(nodeRange)?.[1] ?? 0);
  registrar("Vercel", "engines.node não é Node 20 ou anterior (EOL na Vercel)",
    major >= 22,
    `major detectada: ${major || "?"}. Node 20 falha em builds novos desde 2026-10-01`);

  /* ---------------------------------------------------------------- */
  /* Saída                                                             */
  /* ---------------------------------------------------------------- */
  let grupoAtual = "";
  console.log("\n\u001b[1mGarça de Botas Code Studio — verificação de deploy\u001b[0m\n");
  for (const r of resultados) {
    if (r.grupo !== grupoAtual) {
      grupoAtual = r.grupo;
      console.log(`\u001b[1m${grupoAtual}\u001b[0m`);
    }
    const marca = r.ok ? "\u001b[32m PASSA\u001b[0m" : (r.critico ? "\u001b[31m FALHA\u001b[0m" : "\u001b[33m AVISO\u001b[0m");
    // o detalhe só aparece quando há algo a corrigir — senão vira ruído
    console.log(`  ${marca}  ${r.item}${!r.ok && r.detalhe ? `\n          \u001b[2m${r.detalhe}\u001b[0m` : ""}`);
  }

  const total = resultados.length;
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${total - falhas}/${total} verificações passaram.`);

  if (criticas > 0) {
    console.log(`\u001b[31m${criticas} item(ns) crítico(s) falhando — não faça o deploy.\u001b[0m\n`);
    process.exit(1);
  }
  console.log("\u001b[32mPronto para publicar na Vercel.\u001b[0m\n");
}

main().catch((error) => {
  console.error("O verificador falhou:", error);
  process.exit(2);
});

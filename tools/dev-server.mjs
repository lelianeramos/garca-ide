/**
 * SERVIDOR DE DESENVOLVIMENTO LOCAL
 * ---------------------------------
 * Serve a interface estática e executa as funções de api/** exatamente como a
 * Vercel faria:
 *
 *   • api/project/*.py e api/validate.py  -> python3, com cwd na raiz do
 *     projeto (é o que faz `from api.project.semantic import ...` resolver)
 *   • api/github/*.js                     -> importados e executados pelo
 *     adaptador tools/vercel-shim.mjs, ou seja: o MESMO código de produção.
 *     Nada de segunda implementação que diverge com o tempo.
 *
 * Não é usado em produção. Está no .vercelignore — nenhum .mjs fica na raiz,
 * porque foi um arquivo .mjs na raiz que fez a Vercel empacotar o frontend
 * como função serverless e falhar com "document is not defined" (B20).
 *
 * Uso:  npm run dev      (PORT=4173)
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";
import { invokeVercelHandler } from "./vercel-shim.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

/* ------------------------------------------------------------------ */
/* .env — carregador mínimo, sem dependências (S03)                    */
/* ------------------------------------------------------------------ */
try {
  const env = await readFile(join(ROOT, ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
} catch { /* sem .env: o app funciona em modo "GitHub indisponível" (N18) */ }

const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const sendJson = (response, status, data) => {
  const raw = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  response.end(raw);
};

/* ------------------------------------------------------------------ */
/* Funções Python (api/project/*.py)                                    */
/* ------------------------------------------------------------------ */

const PYTHON_OPERATIONS = {
  analyze: ["from api.project.analyze import analyze", "analyze(data.get('files', []))"],
  refactor: ["from api.project.refactor import refactor", "refactor(data.get('files', []), data['oldModule'], data['newModule'])"],
  bundle: ["from api.project.bundle import bundle", "bundle(data.get('files', []), data.get('entryId'))"],
  blocks: ["from api.project.blocks import blockify", "blockify(data.get('code', ''), data.get('symbols', {}))"],
  format: ["from api.project.format import handler_payload", "handler_payload(data)"],
  semantic: ["from api.project.semantic import handler_payload", "handler_payload(data)"],
};

function runPython(operation, rawBody, response) {
  const [importLine, call] = PYTHON_OPERATIONS[operation];
  const script = `import json, sys
${importLine}
data = json.loads(sys.stdin.read() or "{}")
print(json.dumps(${call}, ensure_ascii=False))
`;

  // cwd = raiz do projeto: é o que torna `api.project.*` importável
  const child = spawn("python3", ["-c", script], { cwd: ROOT });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  child.on("error", (error) => sendJson(response, 500, { error: `python3 indisponível: ${error.message}` }));
  child.on("close", () => {
    try {
      const data = JSON.parse(out);
      sendJson(response, data.ok === false ? 400 : 200, data);
    } catch {
      sendJson(response, 500, { error: err.trim() || "Falha na análise do projeto" });
    }
  });
  child.stdin.end(rawBody);
}

function validatePython(rawBody, response) {
  const script = `import ast, json, sys
source = sys.stdin.read()
try:
    ast.parse(source)
    print(json.dumps({"valid": True, "error": None}))
except SyntaxError as exc:
    print(json.dumps({"valid": False, "error": {
        "line": exc.lineno or 1, "offset": exc.offset or 1, "message": exc.msg}},
        ensure_ascii=False))
`;
  const child = spawn("python3", ["-c", script], { cwd: ROOT });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.on("error", (error) => sendJson(response, 500, { error: error.message }));
  child.on("close", () => {
    try { sendJson(response, 200, JSON.parse(out)); }
    catch { sendJson(response, 500, { error: "Falha ao validar" }); }
  });
  child.stdin.end(rawBody);
}

async function collectRaw(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/* ------------------------------------------------------------------ */
/* Estáticos                                                           */
/* ------------------------------------------------------------------ */

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = normalize(join(ROOT, relative));

  // trava de travessia de diretório: nada fora da raiz do projeto
  if (!file.startsWith(ROOT)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return response.end("Forbidden");
  }

  try {
    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Content-Length": data.length,
    });
    response.end(data);
  } catch {
    // SPA: rota desconhecida sem extensão volta para o index.html
    if (!extname(relative)) {
      try {
        const index = await readFile(join(ROOT, "index.html"));
        response.writeHead(200, { "Content-Type": TYPES[".html"], "Content-Length": index.length });
        return response.end(index);
      } catch { /* cai no 404 */ }
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

/* ------------------------------------------------------------------ */
/* Roteador                                                            */
/* ------------------------------------------------------------------ */

// api/github/*.js: o MESMO handler que roda na Vercel
const GITHUB_HANDLERS = {
  "/api/github/commit": "api/github/commit.js",
  "/api/github/stats": "api/github/stats.js",
  "/api/github/avatar": "api/github/avatar.js",
};

http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;

  try {
    // ---- funções Python ----
    const projectMatch = pathname.match(/^\/api\/project\/(\w+)$/);
    if (projectMatch && PYTHON_OPERATIONS[projectMatch[1]]) {
      if (request.method !== "POST") return sendJson(response, 405, { error: "Método não permitido" });
      const raw = await collectRaw(request);
      return runPython(projectMatch[1], raw, response);
    }

    if (pathname === "/api/validate") {
      if (request.method !== "POST") return sendJson(response, 405, { error: "Método não permitido" });
      const raw = await collectRaw(request);
      return validatePython(raw, response);
    }

    // ---- funções Node (handlers reais da Vercel) ----
    const handlerPath = GITHUB_HANDLERS[pathname];
    if (handlerPath) {
      return await invokeVercelHandler(handlerPath, request, response, ROOT);
    }

    if (pathname.startsWith("/api/")) {
      return sendJson(response, 404, { error: `Rota de API desconhecida: ${pathname}` });
    }

    // ---- estáticos ----
    return await serveStatic(pathname, response);
  } catch (error) {
    const status = error?.status ?? 500;
    if (!response.headersSent) sendJson(response, status, { error: error.message || "Falha interna" });
    else response.end();
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Garça de Botas Code Studio (dev): http://0.0.0.0:${PORT}`);
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    console.log("  GitHub: credenciais ausentes — métricas em modo \"indisponível\" (N18).");
    console.log("  Copie .env.example para .env e preencha para ativar os commits.");
  }
});

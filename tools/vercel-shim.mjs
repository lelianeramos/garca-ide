/**
 * ADAPTADOR VERCEL -> NODE HTTP
 * -----------------------------
 * Permite que o servidor de desenvolvimento execute os MESMOS handlers que
 * rodam na Vercel (api/github/*.js), em vez de manter uma segunda
 * implementação paralela que diverge com o tempo.
 *
 * Testar em dev exatamente o código de produção é o que impede que uma
 * correção aplicada só num lado sobreviva até o deploy.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Monta um `response` com a API encadeável que a Vercel oferece. */
function createResponse(nodeResponse) {
  let statusCode = 200;
  const api = {
    status(code) { statusCode = code; return api; },
    json(payload) {
      nodeResponse.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
      nodeResponse.end(JSON.stringify(payload));
      return api;
    },
    send(payload) {
      nodeResponse.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
      nodeResponse.end(String(payload));
      return api;
    },
    setHeader(key, value) { nodeResponse.setHeader(key, value); return api; },
    end(payload) { nodeResponse.end(payload); return api; },
  };
  return api;
}

/** Monta um `request` no formato que os handlers da Vercel esperam. */
function createRequest(nodeRequest, body) {
  const host = nodeRequest.headers.host || "localhost";
  return {
    method: nodeRequest.method,
    url: nodeRequest.url,
    headers: nodeRequest.headers,
    query: Object.fromEntries(new URL(nodeRequest.url, `http://${host}`).searchParams),
    body,
  };
}

/** Lê o corpo da requisição com limite de tamanho (evita abuso de memória). */
export async function readBody(nodeRequest, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of nodeRequest) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Corpo da requisição grande demais"), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Executa um handler Vercel contra uma requisição Node.
 * @param {string} modulePath caminho relativo à raiz do projeto
 *
 * A resolução usa caminho absoluto + file:// URL. Resolver como URL relativa
 * sobre a raiz sem barra final cortava o último segmento do diretório
 * ("garca-ide") e procurava o módulo um nível acima.
 */
export async function invokeVercelHandler(modulePath, nodeRequest, nodeResponse, projectRoot) {
  const absolute = join(projectRoot, modulePath);
  const mod = await import(pathToFileURL(absolute).href);
  const handler = mod.default ?? mod.handler;
  if (typeof handler !== "function") throw new Error(`${modulePath} não exporta um handler`);

  const body = await readBody(nodeRequest);
  await handler(createRequest(nodeRequest, body), createResponse(nodeResponse));
}

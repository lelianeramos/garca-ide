/**
 * Vercel Function: /api/github/avatar?u=<username>
 * ------------------------------------------------
 * Devolve o avatar REAL do GitHub (Parte 19.5) e o nome público.
 *
 * S01: o token NUNCA chega ao navegador. Se GITHUB_TOKEN existir ele é usado
 *      só para evitar rate-limit; se não existir, a chamada é anônima
 *      (a API pública de usuários não exige autenticação).
 * S02: nenhum e-mail é retornado — apenas avatar_url, login e name.
 */

const CACHE = new Map();          // username -> { payload, at }
const CACHE_TTL_MS = 10 * 60_000; // 10 minutos

export default async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const username = String(url.searchParams.get('u') || '').trim();

  if (!username || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) {
    return response.status(400).json({ error: 'Usuário GitHub inválido' });
  }

  const cached = CACHE.get(username.toLowerCase());
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return response.status(200).json(cached.payload);
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Garca-de-Botas-Code-Studio',
  };
  // O token é opcional aqui: só aumenta o limite de requisições.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    const githubResponse = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers });
    if (!githubResponse.ok) {
      return response.status(200).json({
        login: username,
        avatar_url: null,
        name: null,
        error: githubResponse.status === 404 ? 'Usuário não encontrado no GitHub' : 'GitHub indisponível',
      });
    }

    const user = await githubResponse.json();
    const payload = {
      login: user.login,
      name: user.name || null,
      // S02: e-mail propositalmente NÃO é repassado ao navegador
      avatar_url: user.avatar_url || null,
      html_url: user.html_url || null,
    };

    CACHE.set(username.toLowerCase(), { payload, at: Date.now() });
    return response.status(200).json(payload);
  } catch (error) {
    return response.status(200).json({ login: username, avatar_url: null, name: null, error: error.message });
  }
}

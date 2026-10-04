/**
 * Vercel Function: /api/github/stats
 * ----------------------------------
 * Métricas reais de contribuição dos 4 integrantes (Parte 19.7).
 *
 * B19: exatamente 4, nesta ordem — João Vitor, José, Rafael, Fernanda.
 * N18: sem credenciais, sem resposta ou sem dados, devolve available:false e
 *      zeros. NUNCA inventa números nem ranking.
 * N02: nunca devolve null/undefined para campos exibidos na interface.
 * S01: o token fica só aqui — não é repassado ao navegador.
 * S02: nenhum e-mail é devolvido.
 *
 * 19.5 / P03: o username dos integrantes 2, 3 e 4 ainda está para confirmar.
 * Enquanto estiver vazio, NÃO se tenta casar ninguém no GitHub: sem username
 * não há avatar, e a interface mostra as iniciais em disco colorido.
 * Inventar um username ("jose", "rafael") faria a aplicação buscar e exibir a
 * foto de um desconhecido que por acaso tem esse login — o que seria pior do
 * que não mostrar foto nenhuma.
 */

const CONTRIBUTORS = [
  { id: '1', name: 'João Vitor', env: 1 },
  { id: '2', name: 'José', env: 2 },
  { id: '3', name: 'Rafael', env: 3 },
  { id: '4', name: 'Fernanda', env: 4 },
];

/** Sem dados, todo mundo com zeros — nunca null (N02). */
const emptyMetrics = { added: 0, deleted: 0, commits: 0, files: 0, lastActivity: null, avatar: null };

function configuredUsers() {
  return CONTRIBUTORS.map((contributor) => ({
    id: contributor.id,
    name: process.env[`CONTRIBUTOR_${contributor.env}_NAME`] || contributor.name,
    // vazio quando não configurado: o frontend então usa iniciais coloridas
    username: (process.env[`CONTRIBUTOR_${contributor.env}_USERNAME`] || '').trim(),
    ...emptyMetrics,
  }));
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Método não permitido' });
  }

  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const users = configuredUsers();

  // N18: sem credenciais o estado é "indisponível" — sem números fabricados
  if (!token || !repository) {
    return response.status(200).json({
      available: false,
      reason: 'GITHUB_TOKEN e GITHUB_REPOSITORY não configurados',
      users,
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Garca-de-Botas-Code-Studio',
  };

  try {
    // O GitHub responde 202 enquanto agrega as estatísticas pela primeira vez
    let githubResponse = await fetch(`https://api.github.com/repos/${repository}/stats/contributors`, { headers });
    if (githubResponse.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      githubResponse = await fetch(`https://api.github.com/repos/${repository}/stats/contributors`, { headers });
    }
    if (!githubResponse.ok) throw new Error(`GitHub respondeu ${githubResponse.status}`);

    const stats = await githubResponse.json();
    if (!Array.isArray(stats) || !stats.length) {
      return response.status(200).json({ available: false, reason: 'Repositório ainda sem contribuições', users });
    }

    const byLogin = new Map(
      stats
        .filter((entry) => entry?.author?.login)
        .map((entry) => [String(entry.author.login).toLowerCase(), entry])
    );

    for (const user of users) {
      // Sem username configurado, não casa ninguém: métricas permanecem em zero
      // e a interface mostra o estado real, nunca um dado inventado (N18).
      if (!user.username) continue;
      const entry = byLogin.get(user.username.toLowerCase());
      if (!entry) continue;

      const weeks = entry.weeks || [];
      user.added = weeks.reduce((sum, week) => sum + (week.a || 0), 0);
      user.deleted = weeks.reduce((sum, week) => sum + (week.d || 0), 0);
      user.commits = entry.total || 0;
      user.lastActivity = weeks.filter((week) => week.c).at(-1)?.w ?? null;
      user.avatar = entry.author?.avatar_url || null;
      user.githubName = entry.author?.name || null;
    }

    return response.status(200).json({ available: true, users });
  } catch (error) {
    // Falha de rede/limite: estado "indisponível", nunca métricas fabricadas
    return response.status(200).json({ available: false, reason: error.message, users });
  }
}

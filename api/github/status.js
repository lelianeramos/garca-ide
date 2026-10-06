/**
 * Vercel Function: /api/github/status
 * -----------------------------------
 * Estado REAL da conexão com o GitHub, para a interface mostrar a verdade.
 *
 * POR QUE ISTO EXISTE: o botão "Atualizar código" respondia só
 * "não foi possível atualizar o código" e a equipe achava que faltava token.
 * A causa real (variável ausente, token sem permissão, API fora do ar) ficava
 * escondida no servidor. Este endpoint diz o que está faltando.
 *
 * SEGURANÇA (S01): o token NUNCA é devolvido — nem em parte, nem mascarado.
 * Só devolvemos: existe? o repositório responde? o token é aceito? quem é o
 * login? qual foi o último commit?
 *
 * S02: nenhum e-mail é devolvido. Só nome, username e estado.
 */

const CONTRIBUTORS = [
  { id: '1', env: 1 },
  { id: '2', env: 2 },
  { id: '3', env: 3 },
  { id: '4', env: 4 },
];

const HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Garca-de-Botas-Code-Studio',
};

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Método não permitido' });
  }

  const token = (process.env.GITHUB_TOKEN || '').trim();
  const repository = (process.env.GITHUB_REPOSITORY || '').trim();
  const branch = (process.env.GITHUB_BRANCH || 'main').trim();

  // O que falta, em português, para a equipe saber exatamente o que fazer.
  const missing = [];
  if (!token) missing.push('GITHUB_TOKEN');
  if (!repository) missing.push('GITHUB_REPOSITORY');
  for (const contributor of CONTRIBUTORS) {
    if (!(process.env[`CONTRIBUTOR_${contributor.env}_EMAIL`] || '').trim()) {
      missing.push(`CONTRIBUTOR_${contributor.env}_EMAIL`);
    }
  }

  const contributors = CONTRIBUTORS.map((contributor) => ({
    id: contributor.id,
    name: (process.env[`CONTRIBUTOR_${contributor.env}_NAME`] || '').trim() || `Integrante ${contributor.id}`,
    username: (process.env[`CONTRIBUTOR_${contributor.env}_USERNAME`] || '').trim(),
    hasEmail: Boolean((process.env[`CONTRIBUTOR_${contributor.env}_EMAIL`] || '').trim()),
  }));

  if (!token || !repository) {
    return response.status(200).json({
      configured: false,
      authenticated: false,
      repository: repository || null,
      branch,
      missing,
      contributors,
      error: missing.length
        ? `Falta configurar no servidor: ${missing.join(', ')}`
        : 'GitHub não configurado',
    });
  }

  const headers = { ...HEADERS, Authorization: `Bearer ${token}` };

  try {
    const userResponse = await fetch('https://api.github.com/user', { headers });
    if (!userResponse.ok) {
      const body = await userResponse.json().catch(() => ({}));
      return response.status(200).json({
        configured: true,
        authenticated: false,
        repository,
        branch,
        missing: [],
        contributors,
        error: userResponse.status === 401
          ? 'Token recusado pelo GitHub (401). Gere um token novo.'
          : `GitHub respondeu ${userResponse.status}: ${body.message || 'sem detalhes'}`,
      });
    }
    const user = await userResponse.json();

    // Último commit da branch — mostrado como "Ver commit" na interface.
    let lastCommit = null;
    const commitsResponse = await fetch(
      `https://api.github.com/repos/${repository}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
      { headers },
    );
    if (commitsResponse.ok) {
      const [commit] = await commitsResponse.json();
      if (commit) {
        lastCommit = {
          sha: commit.sha,
          url: commit.html_url,
          message: String(commit.commit?.message || '').split('\n')[0].slice(0, 120),
          author: commit.author?.login || commit.commit?.author?.name || null,
          authorLogin: commit.author?.login || null,
          date: commit.commit?.author?.date || null,
        };
      }
    }

    return response.status(200).json({
      configured: true,
      authenticated: true,
      repository,
      branch,
      // Login e URL pública: nada secreto.
      login: user.login || null,
      avatar: user.avatar_url || null,
      contributors,
      lastCommit,
      missing: [],
    });
  } catch (error) {
    return response.status(200).json({
      configured: true,
      authenticated: false,
      repository,
      branch,
      missing: [],
      contributors,
      error: `Não foi possível falar com o GitHub: ${error.message}`,
    });
  }
}

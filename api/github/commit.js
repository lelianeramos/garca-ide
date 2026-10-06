// Vercel Function: commit atômico de vários arquivos do VFS usando Git Data API.
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método não permitido' });
  const token = process.env.GITHUB_TOKEN, repository = process.env.GITHUB_REPOSITORY, branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repository) {
    // Resposta EXATA do que falta. A interface mostra isso na tela em vez de
    // um genérico "não foi possível" que fazia a equipe achar que o token
    // estava errado quando o problema era outro.
    const missing = [];
    if (!token) missing.push('GITHUB_TOKEN');
    if (!repository) missing.push('GITHUB_REPOSITORY');
    return response.status(503).json({
      error: `GitHub não configurado no servidor. Faltou: ${missing.join(' e ')}.`,
      missing,
      hint: 'Defina as variáveis no arquivo .env (local) ou no painel da Vercel > Settings > Environment Variables. O token nunca é enviado ao navegador.',
    });
  }
  const body = request.body || {}, files = Array.isArray(body.files) ? body.files : body.path ? [{ path: body.path, content: body.content }] : [];
  if (!files.length || files.length > 100) return response.status(400).json({ error: 'Nenhum arquivo válido para commit' });
  for (const file of files) {
    file.path = String(file.path || '').trim();

    /*
     * TRAVESSIA DE DIRETÓRIO — falhar fechado.
     *
     * A versão anterior "limpava" o caminho com replace(/^\/+|\.\.(?:\/|$)/g,'')
     * e seguia em frente. Isso convertia "../../evil.py" em "evil.py" e o
     * commit era aceito, escrevendo num lugar que ninguém pediu. Remover o
     * "../" e aceitar é sanitização silenciosa: o cliente acha que escreveu
     * onde mandou. O certo é RECUSAR e dizer por quê.
     */
    if (file.path.includes('..') || file.path.startsWith('/') || file.path.startsWith('\\') ||
        file.path.includes('\0') || /^[A-Za-z]:/.test(file.path)) {
      return response.status(400).json({ error: `Caminho inseguro (travessia de diretório): ${file.path}` });
    }

    /*
     * 19.1 — o repositório tem estrutura fixa:
     *   programacao/main.py
     *   programacao/saidas/saida_N.py     (saídas são SEMPRE numeradas)
     *   programacao/<módulos>.py
     * Nada fora de programacao/ pode ser escrito pela interface.
     *
     * O lookahead (?!saidas/) impede que um arquivo não numerado escape pelo
     * ramo genérico: sem ele, "saidas/saida_abc.py" era aceito como módulo
     * comum e poluía a pasta de saídas.
     */
    const VALID_PATH = /^programacao\/(?:saidas\/saida_\d+|main|(?!saidas\/)(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*)\.py$/;
    if (!VALID_PATH.test(file.path)) {
      return response.status(400).json({ error: `Caminho fora da estrutura do projeto (esperado programacao/….py): ${file.path}` });
    }

    if (!file.delete && (typeof file.content !== 'string' || file.content.length > 500_000)) return response.status(413).json({ error: `Arquivo inválido ou muito grande: ${file.path}` });
  }
  const contributors = [1,2,3,4].map(i => ({id:String(i),name:process.env[`CONTRIBUTOR_${i}_NAME`],username:process.env[`CONTRIBUTOR_${i}_USERNAME`],email:process.env[`CONTRIBUTOR_${i}_EMAIL`]})).filter(x=>x.name);
  const contributor = contributors.find(x=>x.id===String(body.author)||x.username===body.author);if(!contributor?.email)return response.status(400).json({error:'Integrante não configurado no servidor'});
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Garca-de-Botas-Code-Studio','Content-Type':'application/json'};
  const api=`https://api.github.com/repos/${repository}/git`;
  try {
    const refRes=await fetch(`${api}/ref/heads/${encodeURIComponent(branch)}`,{headers});const ref=await refRes.json();if(!refRes.ok)throw new Error(ref.message||'Branch não encontrada');
    const parentSha=ref.object.sha;
    const commitRes=await fetch(`${api}/commits/${parentSha}`,{headers});const parent=await commitRes.json();if(!commitRes.ok)throw new Error(parent.message||'Commit-base indisponível');
    const treeItems=[];
    for(const file of files){if(file.delete){treeItems.push({path:file.path,mode:'100644',type:'blob',sha:null});continue}const blobRes=await fetch(`${api}/blobs`,{method:'POST',headers,body:JSON.stringify({content:file.content,encoding:'utf-8'})});const blob=await blobRes.json();if(!blobRes.ok)throw new Error(blob.message||`Falha no blob ${file.path}`);treeItems.push({path:file.path,mode:'100644',type:'blob',sha:blob.sha})}
    const treeRes=await fetch(`${api}/trees`,{method:'POST',headers,body:JSON.stringify({base_tree:parent.tree.sha,tree:treeItems})});const tree=await treeRes.json();if(!treeRes.ok)throw new Error(tree.message||'Falha ao criar árvore Git');
    const commitRes2=await fetch(`${api}/commits`,{method:'POST',headers,body:JSON.stringify({message:String(body.message||'atualizar projeto').slice(0,120),tree:tree.sha,parents:[parentSha],author:{name:contributor.name,email:contributor.email},committer:{name:contributor.name,email:contributor.email}})});const commit=await commitRes2.json();if(!commitRes2.ok)throw new Error(commit.message||'Falha ao criar commit');
    const update=await fetch(`${api}/refs/heads/${encodeURIComponent(branch)}`,{method:'PATCH',headers,body:JSON.stringify({sha:commit.sha,force:false})});const updated=await update.json();if(!update.ok)throw new Error(updated.message||'Falha ao atualizar branch');
    return response.status(200).json({ok:true,sha:commit.sha,commit:`https://github.com/${repository}/commit/${commit.sha}`,files:files.map(f=>f.path)});
  } catch (error) { return response.status(502).json({error:error.message||'Não foi possível comunicar com o GitHub'}); }
}

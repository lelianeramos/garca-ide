// Vercel Function: commit atômico de vários arquivos do VFS usando Git Data API.
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método não permitido' });
  const token = process.env.GITHUB_TOKEN, repository = process.env.GITHUB_REPOSITORY, branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repository) return response.status(503).json({ error: 'Configure GITHUB_TOKEN e GITHUB_REPOSITORY na Vercel' });
  const body = request.body || {}, files = Array.isArray(body.files) ? body.files : body.path ? [{ path: body.path, content: body.content }] : [];
  if (!files.length || files.length > 100) return response.status(400).json({ error: 'Nenhum arquivo válido para commit' });
  for (const file of files) {
    file.path = String(file.path || '').replace(/^\/+|\.\.(?:\/|$)/g, '');
    if (!/^(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/.test(file.path)) return response.status(400).json({ error: `Caminho Python inválido: ${file.path}` });
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

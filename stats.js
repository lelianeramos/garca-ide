export default async function handler(request,response){
  if(request.method!=='GET')return response.status(405).json({error:'Método não permitido'});
  const token=process.env.GITHUB_TOKEN,repository=process.env.GITHUB_REPOSITORY;
  const configured=[
    {name:'João Vitor',username:process.env.CONTRIBUTOR_1_USERNAME||'vitorino2011'},
    {name:'José',username:process.env.CONTRIBUTOR_2_USERNAME||'jose'},
    {name:'Rafael',username:process.env.CONTRIBUTOR_3_USERNAME||'rafael'},
    {name:'Fernanda',username:process.env.CONTRIBUTOR_4_USERNAME||'fernanda'},
  ];
  if(!token||!repository)return response.status(200).json({available:false,users:configured.map(user=>({...user,added:0,deleted:0,commits:0,files:0,lastActivity:null}))});
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Garca-de-Botas-Code-Studio'};
  try{
    let githubResponse=await fetch(`https://api.github.com/repos/${repository}/stats/contributors`,{headers});
    if(githubResponse.status===202){await new Promise(resolve=>setTimeout(resolve,900));githubResponse=await fetch(`https://api.github.com/repos/${repository}/stats/contributors`,{headers})}
    if(!githubResponse.ok)throw new Error('Estatísticas ainda não disponíveis');
    const stats=await githubResponse.json();
    const users=configured.map(user=>{const entry=stats.find(item=>item.author?.login?.toLowerCase()===user.username.toLowerCase());const weeks=entry?.weeks||[];return {...user,added:weeks.reduce((sum,w)=>sum+w.a,0),deleted:weeks.reduce((sum,w)=>sum+w.d,0),commits:entry?.total||0,files:0,lastActivity:weeks.filter(w=>w.c).at(-1)?.w||null}}).sort((a,b)=>b.added-a.added);
    return response.status(200).json({available:true,users});
  }catch(error){return response.status(200).json({available:false,error:error.message,users:configured.map(user=>({...user,added:0,deleted:0,commits:0,files:0,lastActivity:null}))})}
}

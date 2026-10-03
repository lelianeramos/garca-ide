import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

// Carregador .env simples, sem dependências.
try {
  const env = await readFile(new URL('.env', import.meta.url), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const root = new URL('.', import.meta.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const json = (res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};

async function githubCommit(req,res){
  let raw=''; for await (const chunk of req) raw+=chunk;
  let body; try{body=JSON.parse(raw)}catch{return json(res,400,{error:'JSON inválido'})}
  const token=process.env.GITHUB_TOKEN, repo=process.env.GITHUB_REPOSITORY;
  if(!token||!repo) return json(res,503,{error:'GITHUB_TOKEN e GITHUB_REPOSITORY ainda não foram configurados'});
  const safePath=String(body.path||'').replace(/^\/+|\.\./g,'');
  if(!/^programacao\/saidas\/saida_\d+\.py$/.test(safePath)) return json(res,400,{error:'Caminho de saída inválido'});
  const api=`https://api.github.com/repos/${repo}/contents/${safePath}`;
  const headers={'Authorization':`Bearer ${token}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Garca-Code-Studio'};
  let sha;
  const current=await fetch(api,{headers}); if(current.ok) sha=(await current.json()).sha;
  const payload={message:String(body.message||'atualizar código').slice(0,120),content:Buffer.from(String(body.content||''),'utf8').toString('base64'),branch:process.env.GITHUB_BRANCH||'main',committer:{name:process.env.CONTRIBUTOR_1_NAME||'João Vitor',email:process.env.CONTRIBUTOR_1_EMAIL},author:{name:process.env.CONTRIBUTOR_1_NAME||'João Vitor',email:process.env.CONTRIBUTOR_1_EMAIL},...(sha?{sha}:{})};
  const response=await fetch(api,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json(); if(!response.ok)return json(res,response.status,{error:data.message||'Falha no GitHub'});
  json(res,200,{ok:true,commit:data.commit?.html_url});
}

async function validatePython(req,res){
  let raw=''; for await (const chunk of req) raw+=chunk;
  let code; try{code=JSON.parse(raw).code}catch{return json(res,400,{error:'JSON inválido'})}
  if(typeof code!=='string'||code.length>500_000)return json(res,413,{error:'Código inválido ou muito grande'});
  const script='import ast,json,sys\ns=sys.stdin.read()\ntry:\n ast.parse(s); print(json.dumps({"valid":True,"error":None}))\nexcept SyntaxError as e:\n print(json.dumps({"valid":False,"error":{"line":e.lineno or 1,"offset":e.offset or 1,"message":e.msg}},ensure_ascii=False))';
  const child=spawn('python3',['-c',script]);let out='';child.stdout.on('data',d=>out+=d);child.stdin.end(code);child.on('close',()=>{try{json(res,200,JSON.parse(out))}catch{json(res,500,{error:'Falha ao validar'})}});
}

async function projectPython(req,res,operation){
  let raw='';for await(const chunk of req)raw+=chunk;
  const scripts={
    analyze:`import json,sys\nfrom api.project.analyze import analyze\nd=json.loads(sys.stdin.read());print(json.dumps(analyze(d.get('files',[])),ensure_ascii=False))`,
    refactor:`import json,sys\nfrom api.project.refactor import refactor\nd=json.loads(sys.stdin.read());print(json.dumps(refactor(d.get('files',[]),d['oldModule'],d['newModule']),ensure_ascii=False))`,
    bundle:`import json,sys\nfrom api.project.bundle import bundle\nd=json.loads(sys.stdin.read());print(json.dumps(bundle(d.get('files',[]),d.get('entryId')),ensure_ascii=False))`,
    blocks:`import json,sys\nfrom api.project.blocks import blockify\nd=json.loads(sys.stdin.read());print(json.dumps(blockify(d.get('code',''),d.get('symbols',{})),ensure_ascii=False))`,
    format:`import json,sys\nfrom api.project.format import handler_payload\nd=json.loads(sys.stdin.read());print(json.dumps(handler_payload(d),ensure_ascii=False))`
  };
  const child=spawn('python3',['-c',scripts[operation]],{cwd:root});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.stdin.end(raw);child.on('close',()=>{try{const data=JSON.parse(out);json(res,data.ok===false?400:200,data)}catch{json(res,500,{error:err||'Falha na análise do projeto'})}})
}

http.createServer(async(req,res)=>{
  const projectMatch=req.url?.match(/^\/api\/project\/(analyze|refactor|bundle|blocks|format)$/);
  if(projectMatch&&req.method==='POST')return projectPython(req,res,projectMatch[1]).catch(e=>json(res,500,{error:e.message}));
  if(req.url==='/api/validate'&&req.method==='POST') return validatePython(req,res).catch(e=>json(res,500,{error:e.message}));
  if(req.url==='/api/github/stats'&&req.method==='GET') return json(res,200,{available:false,users:[{name:'João Vitor',username:'vitorino2011',added:0,deleted:0,commits:0,files:0},{name:'José',username:'jose',added:0,deleted:0,commits:0,files:0},{name:'Rafael',username:'rafael',added:0,deleted:0,commits:0,files:0},{name:'Fernanda',username:'fernanda',added:0,deleted:0,commits:0,files:0}]});
  if(req.url==='/api/github/commit'&&req.method==='POST') return githubCommit(req,res).catch(e=>json(res,500,{error:e.message}));
  const pathname=new URL(req.url,'http://localhost').pathname;
  const rel=pathname==='/'?'index.html':pathname.slice(1);
  const file=normalize(join(root,rel));
  if(!file.startsWith(normalize(root))) {res.writeHead(403);return res.end('Forbidden')}
  try{const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}
}).listen(port,'0.0.0.0',()=>console.log(`Garça de Botas Code Studio: http://0.0.0.0:${port}`));

# Garça de Botas Code Studio

IDE web de robótica para a equipe **Garça de Botas** (FLL), construída para
LEGO **SPIKE Prime** + **Pybricks/MicroPython**.

Blocos e Python são **duas vistas do mesmo programa**: escrever `while` no
editor mostra `enquanto` na área de blocos, e editar o parâmetro de um bloco
reescreve só aquela linha do Python — sem nunca apagar o código válido que
você escreveu.

Aplicativo de **desktop**. É usado no computador, no dia de treino, para
conectar ao HUB por Bluetooth.

---

## O que ele faz

**Sincronização bidirecional**
Colar um programa Python inteiro gera todos os blocos correspondentes —
movimento, motores, sensores, som, operadores, variáveis, lógica e funções.
Um erro de sintaxe não derruba a conversão: as linhas válidas viram blocos, a
linha com problema fica sublinhada e explicada no terminal em português.

**Editor de Python de verdade**
Numeração de linha, indentação automática, fechamento de pares,
autocompletar com a API completa do Pybricks, ajuda de assinatura ao digitar
`(`, documentação ao passar o mouse e explicação de erro com causa e sugestão.

**Bibliotecas e código modular**
Um `libraries/movements.py` com `gyro_move`, `gyro_turn` e `gyro_curve` é
indexado e as funções aparecem como blocos na categoria **Bibliotecas**.
Renomear ou mover um arquivo atualiza os `import` de quem o usa, com
confirmação antes.

**Blocos com os nomes do LEGO Education**
Categorias e rótulos seguem o SPIKE Prime em pt-BR: Motores, Movimento, Luz,
Som, Eventos, Controle, Sensores, Operadores, Variáveis, Meus blocos, HUB,
Bibliotecas. As categorias que o seu código está usando aparecem primeiro.

**HUB**
Conexão Bluetooth real, compilação local para MicroPython ABI v6, envio e
execução no HUB, com validação de imports, portas e limites **antes** de
enviar.

**GitHub**
Atualização do código no repositório da equipe em commit atômico, com a foto
real de cada integrante e as métricas de contribuição.

---

## Rodando localmente

```bash
npm install          # opcional: só para "npm run fetch:wasm" re-baixar o compilador
python3 --version    # precisa de Python 3.10+ no PATH
npm run dev          # http://localhost:4173
```

Sem `.env` a aplicação funciona normalmente; apenas o GitHub entra em estado
**indisponível** e nenhuma métrica é inventada.

Para ativar o GitHub localmente:

```bash
cp .env.example .env
# edite .env com o seu token e repositório
npm run dev
```

---

## Testes

```bash
npm test              # tudo
npm run test:blocks   # motor visual de blocos
npm run test:api      # segurança do commit + caminhos do repositório
npm run test:py       # parser semântico e normalização
npm run vercel:doctor # checagem pré-deploy (38 itens)
```

Rode `npm run vercel:doctor` **antes** de publicar. Ele confere os pontos que
já quebraram o deploy — o `document is not defined`, o `No entrypoint found`, o
warning do `engines`, o caminho de commit, o wasm, segredos vazados — e termina
com código 1 se algum item crítico falhar.

---

## Deploy na Vercel

### 1. Configuração do projeto

| Campo | Valor |
|---|---|
| Framework Preset | **Other** |
| Root Directory | a pasta do projeto (ex.: `garca-studio`) |
| Build Command | **vazio** |
| Output Directory | **vazio** |
| Install Command | **vazio** |
| Node.js Version | **22.x** |

O `vercel.json` já declara `framework`, `buildCommand`, `outputDirectory` e
`installCommand`, e esses campos **sobrescrevem o dashboard**. Ainda assim,
confira se o painel bate com a tabela.

#### Por que `framework: null`

A Vercel infere um servidor Node.js quando encontra um `package.json` na raiz
sem um framework reconhecido, e passa a exigir um entrypoint. O build então
quebrava com:

```
Error: No entrypoint found in "/vercel/path0". Set package.json "main" to a
server file, or add one of: app.js, app.cjs, index.js, server.js, main.js…
```

Este projeto é **estático + `api/**`** — não existe servidor Node na raiz.
`"framework": null` no `vercel.json` sobrescreve o Framework Preset do painel e
faz o deploy ser tratado como site estático, sem detecção de entrypoint.

Pelo mesmo motivo o `package.json` **não tem** `main`, nem `scripts.start`, nem
`scripts.build`. Qualquer um deles reativa a inferência de servidor. Em
desenvolvimento use `npm run dev`.

#### Por que Node 22.x e não 20.x

Node 20 entrou em fim de vida e **novos builds na Vercel com ele falham desde
1º de outubro de 2026**. Use `22.x`.

O valor é uma major **fixa** de propósito. Um range solto (`>=20.0.0`, `^22`)
faz a Vercel avisar que a versão vai subir sozinha a cada nova major:

```
Warning: Detected "engines": { "node": ">=20.0.0" } in your package.json that
will automatically upgrade when a new major Node.js Version is released.
```

#### Por que Install Command vazio

Nada em produção depende de `node_modules`: o compilador
`vendor/mpy-cross-v6.wasm` já está versionado, as funções Python rodam no
runtime Python da Vercel e as funções JS usam apenas `fetch`, nativo do Node.
Pular a instalação torna o build mais rápido e elimina uma forma de falhar.

`npm install` localmente só é necessário para `npm run fetch:wasm`, que
re-baixa o compilador.

### 2. Variáveis de ambiente

Cadastre em *Settings → Environment Variables* para **Production** e
**Preview**:

```
PORT=4173
GITHUB_TOKEN=<fine-grained token>
GITHUB_REPOSITORY=organizacao-ou-usuario/nome-do-repositorio
GITHUB_BRANCH=main

CONTRIBUTOR_1_NAME=João Vitor
CONTRIBUTOR_1_USERNAME=vitorino2011
CONTRIBUTOR_1_EMAIL=<e-mail do integrante 1>

CONTRIBUTOR_2_NAME=José
CONTRIBUTOR_2_USERNAME=<confirmar>
CONTRIBUTOR_2_EMAIL=<confirmar>

CONTRIBUTOR_3_NAME=Rafael
CONTRIBUTOR_3_USERNAME=<confirmar>
CONTRIBUTOR_3_EMAIL=<confirmar>

CONTRIBUTOR_4_NAME=Fernanda
CONTRIBUTOR_4_USERNAME=<confirmar>
CONTRIBUTOR_4_EMAIL=<confirmar>
```

`PORT` só afeta o desenvolvimento local; a Vercel define a própria porta.

Os `USERNAME` dos integrantes 2, 3 e 4 ainda precisam ser confirmados.
Enquanto estiverem vazios a interface mostra as **iniciais em disco colorido**
em vez da foto — ela nunca busca um usuário "chutado" no GitHub, porque isso
exibiria a foto de um desconhecido.

### 3. Token

Gere um *fine-grained personal access token* com permissão
**Contents: Read and write** apenas no repositório do projeto.

> **Se um token foi colado em chat, issue, print ou commit, ele está
> comprometido.** Revogue em <https://github.com/settings/tokens> e gere outro.
> Não há como "desexpor" um token.

O token é lido somente dentro de `api/**`. Nenhuma rota devolve o token ou os
e-mails ao navegador.

### 4. Publicar

```bash
npm i -g vercel
vercel --prod
```

Ou conecte o repositório no painel da Vercel. Depois de mudar variáveis de
ambiente, faça **Redeploy** sem cache.

---

## Estrutura

```
index.html              interface única
studio-ui.js            entrada do frontend (módulo ES)
src/
  bootstrap.js          fachada: liga tudo, nenhum acesso a document no topo
  pybricks/apiRegistry.js   API do Pybricks 4.0.0 (autocompletar e tipos)
  blocks/               catálogo, fábrica IR->bloco, renderizador
  parser/pythonParser.js    parser tolerante (JavaScript, roda no navegador)
  semantic/analyzer.js      imports, dependências, ciclos, símbolos
  python/codeGenerator.js   blocos -> Python por faixa de caracteres (span)
  python/bundler.js         junta os módulos para enviar ao HUB
  editor/pythonEditor.js    primitivas do editor
  editor/syncManager.js     orquestra a sincronização bidirecional
  diagnostics/errorParser.js explicação de erro em pt-BR
  ui/                   vfs, histórico, terminal, canvas, editor, github, ícones, som
api/
  project/semantic.py   AST -> IR (análise autoritativa, Python)
  project/format.py     normalização de texto colado
  project/{analyze,bundle,blocks,refactor}.py
  github/{commit,stats,avatar}.js
vendor/
  compiler.js           mpy-cross
  mpy-cross-v6.wasm     compilador MicroPython ABI v6
tools/
  dev-server.mjs        servidor de desenvolvimento (não vai para produção)
  vercel-shim.mjs       executa os handlers da Vercel em dev
  check-deploy.mjs      npm run vercel:doctor
```

`tools/` está no `.vercelignore`. Nenhum `.mjs` fica na raiz do projeto: foi um
arquivo `.mjs` na raiz que fez a Vercel tratar código de navegador como função
serverless e falhar com `ReferenceError: document is not defined`.

---

## Estrutura no repositório da equipe

Os commits da interface escrevem sempre dentro de `programacao/`:

```
programacao/main.py
programacao/saidas/saida_1.py
programacao/saidas/saida_2.py
programacao/libraries/movements.py
```

Caminhos fora dessa estrutura são recusados pelo servidor — inclusive
tentativas de travessia de diretório (`../`), que são rejeitadas em vez de
"limpas" silenciosamente.

---

## Navegador

Chrome ou Edge recentes, servido por **HTTPS** ou `localhost`. O Web Bluetooth
não existe no Firefox nem no Safari, então a conexão com o HUB requer Chrome ou
Edge. Editar blocos e Python funciona em qualquer navegador moderno.

---

## Licença

Uso da equipe Garça de Botas. O compilador `mpy-cross` pertence ao projeto
Pybricks/MicroPython e é distribuído conforme a licença original.

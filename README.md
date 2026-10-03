# Code Studio

IDE web para programar o LEGO SPIKE Prime em Python/Pybricks e blocos sincronizados.

## Deploy na Vercel

- Framework Preset: `Other`.
- Root Directory: a pasta que contém diretamente `index.html`, `studio-ui.js`, `api/` e `vendor/`.
- Build Command e Output Directory: vazios.
- Install Command: `npm install`.
- `server.mjs` é exclusivo do desenvolvimento local; nunca o use como Build Command.
- Não deve existir `app.js` ou `app.mjs`; o frontend é carregado apenas por `studio-ui.js`.

Após alterar o projeto, publique sem reutilizar o cache de build.

## Desenvolvimento

1. Copie `.env.example` para `.env` e preencha apenas as integrações que usar.
2. Execute `npm install`.
3. Execute `npm start` e abra `http://localhost:4173` em Chrome ou Edge.
4. Execute `npm test` antes de enviar mudanças.

Web Bluetooth funciona somente em contexto seguro (HTTPS ou localhost). Tokens e
e-mails de commit pertencem ao ambiente do servidor e nunca são enviados ao navegador.

## Arquitetura

O editor usa a representação intermediária como fonte de verdade:

`Python → parser tolerante → IR → análise semântica → registry → blocos`

Um erro temporário preserva as unidades válidas e gera diagnósticos localizados.
Projetos e preferências ficam no navegador; limpar os dados do site remove esses
rascunhos. Projetos `.lls` podem ser importados, mas novos projetos usam o VFS interno.

## Limites de validação

A suíte automatizada cobre parser, blocos, VFS e endpoints. Conexão, bateria,
transferência e execução devem ser confirmadas com o HUB físico e o firmware usado
pela equipe; a aplicação nunca simula uma conexão bem-sucedida.

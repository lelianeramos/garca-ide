# Rodada 1 — arquitetura visual dos blocos (itens 1–19, 32–34)

Documento de trabalho. Cada item registra a CAUSA medida, não a intenção.

## Diagnóstico da sobreposição (item #40)

O usuário estava certo: **não era CSS de superfície**. Medido no Chromium
(`docs/overlap-audit.md`):

```
{"cls":"block-stack",        "pos":"absolute","left":"70px","top":"55px"}
{"cls":"block-stack nested", "pos":"absolute","left":"70px","top":"55px"}
movement_straight X myblock_call = 115x90px
```

`styles.css` declarava `.block-stack { position:absolute }` e
`semantic-system.css` criava `.block-stack.nested` **sem zerar `position`**.
Toda pilha aninhada saía do fluxo com `left:70px; top:55px` relativos ao
pai, e era pintada por cima dos irmãos. O browser não podia reflow porque a
posição não dependia do fluxo.

**Correção:** `block-layout.css` (entra por último). A raiz continua
ancorada; toda pilha não-raiz é `position: static`. A altura do container
passa a ser a soma dos filhos — o "próximo bloco desce" deixa de ser cálculo
e vira comportamento padrão.

## Itens concluídos

| # | O quê | Como |
|---|-------|------|
| 1, 2 | Fluxo vertical + auto-layout | `block-layout.css` §2, §5 |
| 3 | Sem "Nenhum bloco nessa saída" | `emptyState()` = uma dica, só na 1ª vez |
| 4, 5 | Formas por função | catálogo já tinha shapes; cavity do chapéu |
| 6, 7 | `args` fora da tela | `functionFieldsHtml`, `guessParam` tipado |
| 9 | Bloco de movimento redesenhado | `geometry` no catálogo + painel §3 |
| 10 | `main()` sem bloco visual | `blockFactory` devolve `null` |
| 14–16 | Pastas recolhíveis e aninhadas | `toggleFolder` + estado no VFS |
| 17 | Configurações fora da top bar | `projectMenuItems` |
| 18 | Top bar enxuta | 6 botões + hub + github + perfil |
| 19 | Cartão do HUB minimalista | 250×34px, ponto de estado |
| 32–34 | Verificador de layout | `src/ui/layoutGuard.js` |

## Bugs de leitura corrigidos no caminho

- **unidade duplicada** (14 blocos): o campo numérico já desenha a unidade e
  o texto repetia. Teste `nenhum bloco repete a unidade no texto` impede
  regressão.
- **painel de extras sempre aberto**: `.gb-advanced { display:flex }` vencia o
  atributo `hidden` do HTML.
- **bloco mais largo que o pai**: `max-width` em `vw` não tem relação com o
  pai. Agora é `max-width: 100%` dentro de container.
- **parênteses e unidades órfãs**: "(" e ")" eram texto,number e unidade eram
  irmãos. `joinControls()` funde controles vizinhos em `.gb-group`.

## Como verificar

```bash
npm test                                   # 19 testes do pipeline + 46 do parser
node /home/user/.pw/audit3.mjs             # sem sobreposição após cada operação
node /home/user/.pw/folders.mjs            # pastas aninhadas e estado
node /home/user/.pw/visual.mjs             # medidas de largura e top bar
```

## Pendente para a próxima rodada

- #11/#12: paleta compacta + hover (a paletinha está como está, sem hover)
- #20: fluxo de pareamento com telas de erro
- #21/#22/#23: GitHub — status real, avatares, menu de autor
- #26: workspace em 50–60% (hoje 34%)
- #28: Python recolhido por padrão
- #30/#31: menos caixas, responsividade real
- #37: auto-scroll ao adicionar
- #38: programa completo com container, rodapé final

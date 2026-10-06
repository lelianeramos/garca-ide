# Laudo: sobreposição de blocos — causa raiz medida

Medido no Chromium real (1600x950), com o programa de teste do item #38.

## O que a medição mostrou

```
=== STACKS (computed) ===
{"cls":"block-stack",        "pos":"absolute","left":"70px","top":"55px"}
{"cls":"block-stack nested", "pos":"absolute","left":"70px","top":"55px"}

=== SOBREPOSIÇÃO GLOBAL (pares não aninhados) ===
movement_straight X myblock_call = 115x90px
```

## Causa raiz

`src/ui/` usa `.block-stack` como âncora do canvas, declarada em
`styles.css`:

```css
.block-stack{
  position:absolute;   /* <-oku */
  left:70px;
  top:55px;
  width:300px
}
```

`semantic-system.css` define a pilha aninhada, mas **não zera o
`position`**:

```css
.block-stack.nested {
  width: auto;
  min-width: 190px;
  padding: 3px 0 3px 4px;
}
```

Resultado: **toda pilha aninhada é posicionada de forma absoluta**, com
`left:70px; top:55px` relativos ao bloco-pai. A pilha dentro de um container
(`se`, `repetir`, e o próprio chapéu `quando o programa iniciar`) sai do
fluxo normal e é desenhada por cima dos irmãos seguintes.

O browser nunca pode fazer reflow porque a posição não depende do fluxo.

## Por que isso NÃO é um bug de CSS de superfície

- Trocar `position` por `static` sem mais nada quebra o ancoramento da raiz
  do canvas.
- A correção certa é: **a raiz continua ancorada; toda pilha aninhada volta
  para o fluxo normal**, e a altura do pai passa a ser a soma dos filhos.
  Aí o "próximo bloco desce sozinho" deixa de ser um `top: N` calculado à
  mão e passa a ser o comportamento padrão do fluxo de caixa.

## Consequências já corrigidas nesta rodada

1. Blocos dentro de container ocupam fluxo; o container cresce.
2. `main()` deixa de aparecer como bloco visível (item #10) — a chamada no
   fim do arquivo é gerada pelo gerador, não desenhada para a criança.
3. `args` some do bloco visual (item #6/#7): cada parâmetro vira um campo
   tipado dentro da frase.

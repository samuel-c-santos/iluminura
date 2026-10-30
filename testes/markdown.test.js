/*
 * Testes do motor Markdown — execute com: node testes/markdown.test.js
 * Não precisa de servidor nem de navegador.
 */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'assets', 'markdown.js'));
const MD = globalThis.LeitorMD;

const amostra = `---
title: Teste
tags: [a, b]
---

# Título principal

Parágrafo com **negrito**, *itálico*, \`código\`, ~~riscado~~, ==realce==,
H~2~O, x^2^, [link](https://exemplo.com), ![img](img/foto.png) e https://auto.link.

## Listas

- item um
- item dois
  - aninhado
- [x] tarefa feita
- [ ] tarefa pendente

1. primeiro
2. segundo

> Citação com **ênfase**.
>
> > aninhada

> [!WARNING]
> Cuidado aqui.

## Tabela

| Nome | Valor |
| :--- | ---: |
| a | 1 |

## Código

\`\`\`js
const x = 42; // comentário
function f(a) { return "texto" + a; }
\`\`\`

\`\`\`mermaid
graph TD
  A[Início] --> B[Fim]
\`\`\`

## Matemática

Inline $E = mc^2$ e bloco:

$$
\\frac{a}{b} + \\sqrt{x}
$$

Setext
======

Texto com nota[^1] e referência [documento][doc].

[^1]: Conteúdo da nota.
[doc]: https://example.org "Documento"

<button onclick="alert(1)">x</button>

[perigo](javascript:alert(1))

---
`;

const { html, headings } = MD.render(amostra);

const casos = {
  'front matter oculto': !html.includes('tags:'),
  'título h1 com id': html.includes('<h1 id="titulo-principal"'),
  'negrito': html.includes('<strong>negrito</strong>'),
  'itálico': html.includes('<em>itálico</em>'),
  'código inline': html.includes('<code>código</code>'),
  'riscado': html.includes('<del>riscado</del>'),
  'realce': html.includes('<mark>realce</mark>'),
  'subscrito': html.includes('<sub>2</sub>'),
  'sobrescrito': html.includes('<sup>2</sup>'),
  'link externo seguro': html.includes('rel="noopener noreferrer"'),
  'imagem': html.includes('<img src="img/foto.png"'),
  'url solta': html.includes('>https://auto.link<'),
  'lista aninhada': (html.match(/<ul/g) || []).length >= 2,
  'lista de tarefas': html.includes('class="task-item"'),
  'lista ordenada': html.includes('<ol'),
  'citação': html.includes('<blockquote'),
  'alerta': html.includes('alert-warning') && html.includes('Atenção'),
  'tabela': html.includes('<th') && html.includes('text-align:right'),
  'realce de código': html.includes('tok-kw') && html.includes('tok-com') && html.includes('tok-str'),
  'rótulo de linguagem': html.includes('class="code-lang">js<'),
  'bloco mermaid': html.includes('class="mermaid-block"') &&
    html.includes('mermaid-source') &&
    html.includes('A[Início] --&gt; B[Fim]') &&
    !html.includes('language-mermaid'),
  'fórmula inline': html.includes('math-inline'),
  'fração': html.includes('mfrac'),
  'bloco de fórmula': html.includes('math-block'),
  'título setext': html.includes('<h1 id="setext"'),
  'nota de rodapé': html.includes('fn-ref') && html.includes('id="fn-1"'),
  'link de referência': html.includes('title="Documento"'),
  'html cru escapado': html.includes('&lt;button'),
  'javascript: bloqueado': !/href="javascript:/i.test(html),
  'linha horizontal': html.includes('<hr'),
  'índice coletado': headings.length >= 6
};

let falhas = 0;
for (const [nome, ok] of Object.entries(casos)) {
  if (!ok) { console.log('FALHOU  ' + nome); falhas++; }
}

const stats = MD.stats(amostra);

console.log(falhas === 0
  ? `\nOK: ${Object.keys(casos).length} verificações passaram`
  : `\n${falhas} de ${Object.keys(casos).length} falharam`);

console.log('títulos :', headings.map(h => h.level + ':' + h.text).join(' | '));
console.log('métricas:', JSON.stringify(stats));

process.exit(falhas ? 1 : 0);

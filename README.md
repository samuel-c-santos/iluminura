# leitor_md

Aplicativo web local e autônomo para edição e renderização de documentos em formato Markdown. Implementado em JavaScript puro (ECMAScript padrão), sem dependências externas, bibliotecas de terceiros ou processos de compilação/empacotamento.

![leitor_md](assets/logo.svg)

---

## 1. Visão Geral

O `leitor_md` opera inteiramente no ambiente do cliente (navegador web), mantendo o processamento e o armazenamento de arquivos no sistema local do usuário. O projeto não realiza requisições de rede, telemetria ou integração com serviços em nuvem.

### Arquitetura de Execução

O sistema pode ser executado através de três métodos:

| Método | Execução | Características Técnicas |
| --- | --- | --- |
| Servidor local integrado | Executar `iniciar.bat` ou `node servidor.js` | Disponibiliza a interface em `http://127.0.0.1:8731`. Habilita acesso completo à File System Access API para manipulação direta de arquivos e pastas no disco. |
| Linha de comando direta | `node servidor.js [porta]` | Permite customização da porta de escuta do serviço HTTP estático local. |
| Carregamento estático | Abrir `index.html` diretamente | Execução em protocolo `file://`. A persistência opera via seletor tradicional de arquivos (Blob/download) e cache via Web Storage API (`localStorage`). |

---

## 2. Especificação Funcional

### 2.1 Interface e Modos de Operação
- **Modos de Exibição**: Painel duplo sincronizado (Editor e Pré-visualização), modo exclusivo de Leitura (com formatação tipográfica e barra de progresso) e modo Código-Fonte puro.
- **Estruturação de Documento**: Extração e renderização dinâmica do índice hierárquico (TOC) com suporte a níveis de cabeçalho `H1` a `H6`.
- **Métricas Textuais**: Contagem em tempo real de palavras, caracteres totais, caracteres sem espaço, linhas e parágrafos. Estimativa de tempo de leitura configurável (120, 240 ou 382 palavras por minuto).
- **Temas e Tipografia**: Três variantes de interface (Claro, Escuro e Sépia) e três famílias tipográficas (Sem Serifa, Serifada e Monoespaçada).
- **Dimensionamento**: Escala visual configurável de 60% a 200%.

### 2.2 Motor de Edição
- **Realce Sintático em Tempo Real**: Overlay de realce léxico sincronizado com o campo de edição.
- **Mecanismos de Escrita**: Modo Foco (atenuação visual de parágrafos inativos) e Modo Máquina de Escrever (ancoragem vertical contínua da linha de edição ativa no centro da tela).
- **Automação de Entrada**: Fechamento automático de pares delimitadores (`()`, `[]`, `{}`, aspas simples e duplas, crases, `*`, `_`, `~`, `$`).
- **Manipulação de Listas e Blocos**: Continuação automática de marcadores de lista, caixas de seleção de tarefas e blocos de citação ao inserir quebras de linha; encerramento de bloco mediante quebra dupla. Suporte a indentação e desindentação em bloco (`Tab` e `Shift+Tab`).
- **Busca e Substituição**: Módulo integrado de busca textual com navegação sequencial e substituição individual ou global.
- **Persistência Temporária**: Salvamento periódico automático no armazenamento local do navegador para contenção de perda de dados.

### 2.3 Especificação de Renderização Markdown
O analisador sintático integrado implementa o subconjunto comum das especificações CommonMark e GitHub Flavored Markdown (GFM):
- Cabeçalhos ATX (`#`) e Setext (`===`, `---`).
- Formatação em linha: negrito, itálico, tachado (`~~`), realce (`==`), subscrito (`~`), sobrescrito (`^`) e código em linha.
- Listas ordenadas, não ordenadas e listas de verificação (*task lists* interativas).
- Citações em bloco com suporte a aninhamento e blocos de alerta padronizados (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`).
- Tabelas GFM com delimitadores de alinhamento (`:---`, `:---:`, `---:`).
- Blocos de código com realce de sintaxe nativo para as linguagens: JavaScript, TypeScript, Python, Go, Rust, Java, C, SQL, HTML, CSS, Shell e YAML.
- Renderização matemática: suporte a expressões TeX em linha (`$...$`) e em bloco (`$$...$$`), processadas via conversor matemático interno para MathML/SVG.
- Notas de rodapé (`[^1]`), metadados YAML front matter (filtrados da visualização) e separadores temáticos (`<hr>`).
- Segurança: sanitização estrita de HTML arbitrário e bloqueio preventivo de URIs executáveis (esquema `javascript:`).

### 2.4 Exportação
- **HTML Autônomo**: Documento compilado contendo folhas de estilo e imagens embutidas (codificação Base64).
- **PDF**: Folha de estilos otimizada para impressão via motor nativo do navegador (`@media print`).
- **Transferência**: Cópia direta da marcação HTML processada para a área de transferência do sistema.

---

## 3. Atalhos de Teclado

| Ação | Combinação |
| --- | --- |
| Novo documento | `Ctrl + N` |
| Abrir arquivo | `Ctrl + O` |
| Salvar documento | `Ctrl + S` |
| Localizar no texto | `Ctrl + F` |
| Substituir no texto | `Ctrl + H` |
| Aplicar negrito | `Ctrl + B` |
| Aplicar itálico | `Ctrl + I` |
| Inserir link | `Ctrl + K` |
| Cabeçalhos (Níveis 1 a 6) | `Ctrl + 1` até `Ctrl + 6` |
| Alternar visualização de código-fonte | `Ctrl + /` |
| Alternar modo foco | `Ctrl + Shift + F` |
| Alternar painel lateral | `Ctrl + Shift + 1` |
| Inserir bloco de código | `Ctrl + Shift + K` |
| Inserir bloco matemático | `Ctrl + Shift + M` |
| Imprimir / Exportar PDF | `Ctrl + P` |
| Exibir ajuda de atalhos | `F1` |

---

## 4. Estrutura do Repositório

```
leitor_md/
├── index.html              Interface gráfica do usuário e estrutura dos painéis
├── assets/
│   ├── markdown.js         Analisador sintático, gerador de AST e motor de realce
│   ├── app.js              Controlador de estado, manipulação de arquivos e eventos
│   ├── style.css           Regras de layout, variáveis de tema e diretivas de impressão
│   └── logo.svg            Identificador visual vetorial
├── servidor.js             Servidor HTTP local minimalista sem módulos externos
├── iniciar.bat             Script de inicialização rápida para ambiente Windows
├── exemplo.md              Documento de validação de sintaxe e referência
├── testes/
│   └── markdown.test.js    Suíte de testes automatizados do analisador
└── LICENSE                 Termos da licença MIT
```

---

## 5. Verificação e Testes

A integridade do motor de análise léxica e sintática é validada por meio de uma suíte de testes unitários executada em ambiente Node.js:

```bash
node testes/markdown.test.js
```

A rotina avalia 30 asserções cobrindo processamento de blocos, regras de inline, tabelas GFM, renderização matemática, sanitização contra injeção de script e isolamento de links maliciosos.

---

## 6. Limitações Técnicas e Escopo

- **Modelo de Visualização**: A interface utiliza arquitetura de painel duplo (editor de texto e painel de renderização) ou visualização alternada, não empregando edição direta *in-place* no documento renderizado.
- **Diagramas Vetoriais**: Sintaxes baseadas em bibliotecas externas (como Mermaid ou PlantUML) não são processadas graficamente, permanecendo como blocos de código formatados.
- **Requisitos de Sistema de Arquivos**: O gerenciamento recursivo de diretórios locais depende da compatibilidade com a File System Access API (disponível em navegadores baseados no motor Chromium).
- **Desempenho de Realce**: Documentos que excedem o limiar de 2.500 linhas têm a camada de realce do editor temporariamente desativada durante a digitação para preservar a taxa de quadros e a responsividade da entrada.

---

## 7. Licença

Este projeto é distribuído sob os termos da Licença MIT. Consulte o arquivo [LICENSE](LICENSE) para mais informações.

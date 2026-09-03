# Leitura DS

<div align="center">

![Status](https://img.shields.io/badge/status-em%20desenvolvimento-ff4d55?style=for-the-badge)
![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7c3aed?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-2563eb?style=for-the-badge)

**Um leitor local-first para EPUBs e quadrinhos dentro do Obsidian.**

Leitura concentrada, destaques sincronizados no Vault e modos feitos para cada momento.

[Funcionalidades](#funcionalidades) · [Instalação](#instalação) · [Privacidade](#privacidade) · [Desenvolvimento](#desenvolvimento)

</div>

---

## Por que o Leitura DS?

O Leitura DS mantém livros, progresso, destaques e comentários no seu próprio Vault. Assim, sua leitura acompanha você entre macOS, iPhone e Android por meio da sincronização que você já usa no Obsidian.

## Funcionalidades

### EPUB

- Leitura de EPUB com sumário clicável e retomada no ponto exato.
- Progresso do livro ou capítulo, tempo restante estimado e marcadores.
- Destaques coloridos, comentários, etiquetas e exportação para notas Markdown.
- Biblioteca visual com capas, busca e página de todos os destaques.
- Temas, fontes, espaçamento, largura do texto, duas colunas e tela cheia.
- Estado compartilhado no Vault: posição e palavra em destaque continuam em outros dispositivos.

### Modos de leitura

- **Leitura rápida**: RSVP com ponto de reconhecimento visual, velocidade e tamanho ajustáveis.
- **Foco em Linha**: acompanha palavra por palavra sem fazer o texto saltar.
- **Fluxo de Cores**: guia visual de leitura com cores configuráveis.
- **Thread**: trechos curtos em cartões verticais, para leitura contínua.
- **Stories**: um trecho por tela, com toque nas laterais para avançar ou voltar.
- **Carrossel**: trechos pequenos navegáveis lateralmente.
- **Leitura em voz alta**: usa a voz disponível no dispositivo a partir do ponto de leitura.

### Quadrinhos

- Biblioteca e leitor para CBZ, com detecção de CBR.
- Zoom, ajuste de página, páginas duplas, leitura RTL e controles por teclado.
- Navegação por página, miniaturas próximas, marcadores e notas por página.
- Em páginas altas, as setas para cima e para baixo rolam a arte; ao trocar de página a leitura retorna ao topo.

> CBR depende do suporte ao formato RAR disponível no ambiente do Obsidian. Para maior compatibilidade entre dispositivos, CBZ é o formato recomendado.

## Instalação

Enquanto o plugin não estiver listado na comunidade do Obsidian, use a instalação manual:

1. Baixe ou clone este repositório.
2. Gere a versão de produção com `npm install` e `npm run build`.
3. Copie `main.js`, `manifest.json`, `styles.css` e a pasta `assets/` para:

```text
<seu-vault>/.obsidian/plugins/leitura-ds/
```

4. No Obsidian, abra **Configurações → Plugins não oficiais**, habilite o Leitura DS e escolha as pastas em **Leitura DS**.

Abra um EPUB, CBZ ou CBR no Vault, ou use os comandos **Minha biblioteca**, **Meus destaques** e **Continuar última leitura**.

## Privacidade

O Leitura DS é local-first: não envia seus livros, destaques, comentários ou posição de leitura para um serviço externo. O estado é salvo em arquivos do próprio Vault para que o seu método de sincronização possa levá-lo aos seus dispositivos.

## Desenvolvimento

```bash
npm install
npm run build
```

Para desenvolvimento contínuo:

```bash
npm run dev
```

## Roteiro

- Testes em uma variedade maior de EPUBs e aparelhos móveis.
- Aprimoramento da compatibilidade CBR.
- Acessibilidade, gestos configuráveis e mais estatísticas de leitura.

## Autor

Desenvolvido por [Douglas Santana](https://github.com/Douglock).

## Licença

Distribuído sob a licença [MIT](LICENSE).

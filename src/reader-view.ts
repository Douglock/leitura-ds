import { ItemView, Notice, Platform, setIcon, WorkspaceLeaf } from "obsidian";
import type FlowReaderPlugin from "./main";
import { BookSearchModal } from "./book-search-modal";
import { AnnotationModal } from "./annotation-modal";
import { AppearanceModal } from "./appearance-modal";
import { MarkersModal } from "./markers-modal";
import { FastReader, optimalRecognitionPoint } from "./fast-reading";
import { parseEpub } from "./epub-parser";
import { dirname, resolvePath } from "./path-utils";
import type { BookAnnotation, BookMarker, ParsedBook, ReaderAppearance, ReaderFont, ReaderTheme, ReadingPosition, SocialReadingMode } from "./types";

export const FLOW_READER_VIEW = "flow-reader-view";

export class FlowReaderView extends ItemView {
  private book: ParsedBook | null = null;
  private chapterIndex = 0;
  private readerHost!: HTMLElement;
  private titleElement!: HTMLElement;
  private chapterSelect!: HTMLSelectElement;
  private previousButton!: HTMLButtonElement;
  private nextButton!: HTMLButtonElement;
  private fastPanel!: HTMLElement;
  private fastOutput!: HTMLElement;
  private fastReader: FastReader | null = null;
  private sourceFilePath = "";
  private fastWordIndex = 0;
  private fontSize = 18;
  private theme: ReaderTheme = "default";
  private focusColor = "#ff4d55";
  private fontFamily: ReaderFont = "book";
  private lineHeight = 1.75;
  private pageWidth = 760;
  private pageMargin = 16;
  private textAlign: "left" | "justify" = "left";
  private saveTimer: number | null = null;
  private statusElement!: HTMLElement;
  private syncStatusElement!: HTMLElement;
  private fastFontSize = 56;
  private fastWpm = 300;
  private selectionBar!: HTMLElement;
  private pendingSelection: { quote: string; startOffset: number; endOffset: number; wordIndex: number } | null = null;
  private selectionTimer: number | null = null;
  private fastPlayButton!: HTMLButtonElement;
  private fastTimeElement!: HTMLElement;
  private fastSpeedInput!: HTMLInputElement;
  private fastSpeedLabel!: HTMLElement;
  private timeDisplayMode: "book" | "chapter" = "book";
  private requestedChapterIndex: number | null = null;
  private progressFill!: HTMLElement;
  private colorFlow = false;
  private colorFlowButton!: HTMLButtonElement;
  private twoColumn = false;
  private twoColumnButton!: HTMLButtonElement;
  private requestedAnnotationId = "";
  private requestedLegacyBookId = "";
  private returnPosition: ReadingPosition | null = null;
  private returnReadingBar!: HTMLElement;
  private returnReadingText!: HTMLElement;
  private focusPanel!: HTMLElement;
  private focusWords: HTMLElement[] = [];
  private focusTimer: number | null = null;
  private focusIndex = 0;
  private focusWpm = 240;
  private focusPlayButton!: HTMLButtonElement;
  private fullscreenButton!: HTMLButtonElement;
  private selectionDismissArmed = false;
  private touchStart: { x: number; y: number; at: number } | null = null;
  private readonly chapterWordCounts = new Map<number, number>();
  private progressFrame: number | null = null;
  private lastReadingActivityAt = 0;
  private pendingReadingSeconds = 0;
  private voiceButton!: HTMLButtonElement;
  private voiceRate = 1;
  private socialMode: SocialReadingMode = "normal";
  private socialModeSelect!: HTMLSelectElement;
  private socialOverlay!: HTMLElement;
  private socialIndex = 0;
  private socialChunks: Array<{ text: string; startWord: number }> = [];
  private socialPointerStart: number | null = null;
  private socialMove: ((delta: number) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: FlowReaderPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return FLOW_READER_VIEW;
  }

  getDisplayText(): string {
    return this.book?.title ?? "Leitura DS";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    this.registerDomEvent(document, "selectionchange", () => this.scheduleSelectionCapture());
    this.registerDomEvent(document, "pointerdown", (event) => this.handleSelectionOutsideTap(event), { capture: true });
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.key === "Escape") (this.containerEl.children[1] as HTMLElement)?.removeClass("is-reader-fullscreen", "is-immersive");
    });
    if (this.sourceFilePath) await this.loadBook(this.sourceFilePath);
  }

  async onClose(): Promise<void> {
    if (this.progressFrame !== null) window.cancelAnimationFrame(this.progressFrame);
    await this.persistPosition();
    await this.flushReadingStats();
    this.fastReader?.destroy();
    this.pauseFocusPlayback();
    window.speechSynthesis?.cancel();
    this.selectionBar?.remove();
    this.releaseBook();
  }

  async setState(state: unknown): Promise<void> {
    const path = typeof state === "object" && state && "file" in state && typeof state.file === "string" ? state.file : "";
    this.requestedChapterIndex = typeof state === "object" && state && "chapterIndex" in state && typeof state.chapterIndex === "number" ? state.chapterIndex : null;
    this.requestedAnnotationId = typeof state === "object" && state && "annotationId" in state && typeof state.annotationId === "string" ? state.annotationId : "";
    this.requestedLegacyBookId = typeof state === "object" && state && "legacyBookId" in state && typeof state.legacyBookId === "string" ? state.legacyBookId : "";
    this.sourceFilePath = path;
    if (this.readerHost && path) await this.loadBook(path);
  }

  getState(): Record<string, string> {
    return { file: this.sourceFilePath };
  }

  private renderShell(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("flow-reader");

    const toolbar = container.createDiv({ cls: "flow-reader__toolbar" });
    const primary = toolbar.createDiv({ cls: "flow-reader__toolbar-primary" });
    const homeButton = primary.createEl("button", { text: "⌂", attr: { "aria-label": "Ir para Minha biblioteca", title: "Minha biblioteca" } });
    homeButton.addEventListener("click", () => void this.plugin.openLibrary());
    const highlightsButton = primary.createEl("button", { cls: "flow-reader__primary-action", attr: { "aria-label": "Meus destaques", title: "Meus destaques" } });
    setIcon(highlightsButton, "highlighter");
    highlightsButton.addEventListener("click", () => void this.plugin.openHighlights());
    const fastButton = primary.createEl("button", { cls: "flow-reader__fast-toggle flow-reader__primary-action", attr: { "aria-label": "Leitura rápida", title: "Leitura rápida" } });
    setIcon(fastButton, "gauge");
    fastButton.addEventListener("click", () => this.openFastPanel());
    this.titleElement = primary.createDiv({ cls: "flow-reader__title", text: "Leitura DS" });
    const moreButton = primary.createEl("button", { text: "⋯", cls: "flow-reader__more", attr: { "aria-label": "Mais ferramentas", "aria-expanded": "false" } });
    const tools = toolbar.createDiv({ cls: "flow-reader__toolbar-tools" });
    this.chapterSelect = tools.createEl("select", { attr: { "aria-label": "Capítulo" } });
    this.chapterSelect.addEventListener("change", () => void this.showChapter(this.chapterSelect.selectedIndex));
    const smallerText = tools.createEl("button", { text: "A−", cls: "flow-reader__secondary-action", attr: { "aria-label": "Diminuir texto" } });
    smallerText.addEventListener("click", () => this.changeFontSize(-2));
    const largerText = tools.createEl("button", { text: "A+", cls: "flow-reader__secondary-action", attr: { "aria-label": "Aumentar texto" } });
    largerText.addEventListener("click", () => this.changeFontSize(2));
    const searchButton = tools.createEl("button", { text: "⌕", cls: "flow-reader__secondary-action", attr: { "aria-label": "Pesquisar no livro" } });
    searchButton.addEventListener("click", () => this.openSearch());
    const savePointButton = tools.createEl("button", { text: "★", cls: "flow-reader__secondary-action", attr: { "aria-label": "Abrir marcadores", title: "Marcadores" } });
    savePointButton.addEventListener("click", () => this.openMarkers());
    this.voiceButton = tools.createEl("button", { cls: "flow-reader__secondary-action", attr: { "aria-label": "Ouvir capítulo", title: "Ouvir capítulo" } });
    setIcon(this.voiceButton, "volume-2");
    this.voiceButton.addEventListener("click", () => this.toggleSpeech());
    const themeButton = tools.createEl("button", { text: "◐", cls: "flow-reader__secondary-action", attr: { "aria-label": "Escolher tema e cor", title: "Aparência" } });
    themeButton.addEventListener("click", () => this.openAppearanceSettings());
    this.colorFlowButton = tools.createEl("button", { text: "≋", cls: "flow-reader__secondary-action", attr: { "aria-label": "Ativar Fluxo Cromático", title: "Fluxo Cromático" } });
    this.colorFlowButton.addEventListener("click", () => {
      this.colorFlow = !this.colorFlow;
      this.colorFlowButton.toggleClass("is-active", this.colorFlow);
      this.colorFlowButton.setAttribute("aria-label", `${this.colorFlow ? "Desativar" : "Ativar"} Fluxo Cromático`);
      this.applyColorFlow();
      this.schedulePositionSave();
    });
    this.twoColumnButton = tools.createEl("button", { text: "▥", cls: "flow-reader__secondary-action", attr: { "aria-label": "Ativar leitura em duas colunas", title: "Duas colunas" } });
    this.twoColumnButton.addEventListener("click", () => {
      this.twoColumn = !this.twoColumn;
      this.twoColumnButton.toggleClass("is-active", this.twoColumn);
      this.twoColumnButton.setAttribute("aria-label", `${this.twoColumn ? "Desativar" : "Ativar"} leitura em duas colunas`);
      this.applyTwoColumn();
      this.schedulePositionSave();
    });
    const focusButton = tools.createEl("button", { text: "◎", cls: "flow-reader__secondary-action", attr: { "aria-label": "Abrir Foco em Linha", title: "Foco em Linha" } });
    focusButton.addEventListener("click", () => this.openFocusMode());
    this.fullscreenButton = tools.createEl("button", { text: "⛶", cls: "flow-reader__secondary-action", attr: { "aria-label": "Entrar em tela cheia", title: "Tela cheia" } });
    this.fullscreenButton.addEventListener("click", () => void this.toggleFullscreen());
    this.registerDomEvent(document, "fullscreenchange", () => {
      const root = this.containerEl.children[1] as HTMLElement;
      const active = document.fullscreenElement === root || root.hasClass("is-reader-fullscreen");
      root.toggleClass("is-immersive", active);
      this.fullscreenButton.toggleClass("is-active", active);
      this.fullscreenButton.setAttribute("aria-label", active ? "Sair da tela cheia" : "Entrar em tela cheia");
    });
    const chapterArrows = tools.createDiv({ cls: "flow-reader__chapter-arrows" });
    this.previousButton = chapterArrows.createEl("button", { text: "←", attr: { "aria-label": "Capítulo anterior" } });
    this.previousButton.addEventListener("click", () => void this.changeChapter(-1));
    this.nextButton = chapterArrows.createEl("button", { text: "→", attr: { "aria-label": "Próximo capítulo" } });
    this.nextButton.addEventListener("click", () => void this.changeChapter(1));
    const navigationGroup = tools.createDiv({ cls: "flow-reader__tool-group flow-reader__tool-group--navigation" });
    navigationGroup.append(this.chapterSelect, chapterArrows);
    const modesGroup = tools.createDiv({ cls: "flow-reader__tool-group flow-reader__tool-group--modes" });
    this.socialModeSelect = modesGroup.createEl("select", { cls: "flow-reader__social-select", attr: { "aria-label": "Modo de leitura social", title: "Modo de leitura" } });
    ([ ["normal", "Leitura"], ["thread", "Thread"], ["stories", "Stories"], ["carousel", "Carrossel"] ] as Array<[SocialReadingMode, string]>).forEach(([value, text]) => this.socialModeSelect.createEl("option", { value, text }));
    this.socialModeSelect.addEventListener("change", () => this.setSocialMode(this.socialModeSelect.value as SocialReadingMode));
    modesGroup.append(themeButton, this.colorFlowButton, this.twoColumnButton, focusButton, this.fullscreenButton);
    const utilitiesGroup = tools.createDiv({ cls: "flow-reader__tool-group flow-reader__tool-group--utilities" });
    utilitiesGroup.append(smallerText, largerText, searchButton, savePointButton, this.voiceButton);
    moreButton.addEventListener("click", () => {
      const expanded = !toolbar.hasClass("is-expanded");
      toolbar.toggleClass("is-expanded", expanded);
      moreButton.setAttribute("aria-expanded", String(expanded));
    });
    const progressTrack = container.createDiv({ cls: "flow-reader__reading-progress", attr: { role: "progressbar", "aria-label": "Progresso da leitura. Toque para ir a um ponto", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", tabindex: "0", title: "Toque para ir a um ponto da leitura" } });
    this.progressFill = progressTrack.createDiv({ cls: "flow-reader__reading-progress-fill" });
    progressTrack.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const rect = progressTrack.getBoundingClientRect();
      if (rect.width > 0) void this.jumpToReadingProgress((event.clientX - rect.left) / rect.width);
    });
    progressTrack.addEventListener("keydown", (event) => {
      const current = this.timeDisplayMode === "chapter" ? this.getChapterScrollProgress() : this.getBookProgress();
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        void this.jumpToReadingProgress(event.key === "Home" ? 0 : 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        void this.jumpToReadingProgress(Math.max(0, Math.min(1, current + (event.key === "ArrowLeft" ? -0.05 : 0.05))));
      }
    });
    this.statusElement = container.createDiv({ cls: "flow-reader__status", text: "0%" });
    this.statusElement.tabIndex = 0;
    this.statusElement.setAttribute("role", "button");
    this.statusElement.setAttribute("aria-label", "Alternar entre tempo do livro e tempo do capítulo");
    this.statusElement.addEventListener("click", () => {
      this.timeDisplayMode = this.timeDisplayMode === "book" ? "chapter" : "book";
      this.updateLiveProgress();
    });
    this.statusElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.statusElement.click();
      }
    });
    this.syncStatusElement = container.createDiv({ cls: "flow-reader__sync-status", text: "Salvo no Vault" });
    this.returnReadingBar = container.createDiv({ cls: "flow-reader__return-reading is-hidden" });
    this.returnReadingText = this.returnReadingBar.createSpan({ text: "Você abriu um destaque." });
    const returnButton = this.returnReadingBar.createEl("button", { text: "Voltar para onde parei", cls: "mod-cta" });
    returnButton.addEventListener("click", () => void this.returnToReadingPosition());

    this.readerHost = container.createDiv({ cls: "flow-reader__content" });
    this.readerHost.addEventListener("scroll", () => {
      this.noteReadingActivity();
      this.scheduleProgressUpdate();
      this.schedulePositionSave();
    }, { passive: true });
    this.readerHost.addEventListener("pointerup", () => this.scheduleSelectionCapture());
    this.readerHost.addEventListener("touchend", () => this.scheduleSelectionCapture(260), { passive: true });
    this.readerHost.addEventListener("touchstart", (event) => {
      const touch = event.touches.item(0);
      this.touchStart = touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
    }, { passive: true });
    this.readerHost.addEventListener("touchend", (event) => this.handleChapterSwipe(event), { passive: true });
    this.readerHost.createDiv({ cls: "flow-reader__empty", text: "Abra um arquivo EPUB do seu Vault." });
    this.socialOverlay = container.createDiv({ cls: "flow-reader__social is-hidden" });
    this.socialOverlay.addEventListener("pointerdown", (event) => { this.socialPointerStart = event.clientX; });
    this.socialOverlay.addEventListener("pointerup", (event) => {
      if (this.socialPointerStart === null || this.socialMode === "thread") return;
      const distance = event.clientX - this.socialPointerStart;
      this.socialPointerStart = null;
      if (Math.abs(distance) > 44) this.socialMove?.(distance < 0 ? 1 : -1);
      else if (this.socialMode === "stories") this.socialMove?.(event.clientX > window.innerWidth / 2 ? 1 : -1);
    });
    this.fastPanel = container.createDiv({ cls: "flow-reader__fast is-hidden" });
    this.renderFastControls();
    this.focusPanel = container.createDiv({ cls: "flow-reader__focus-controls is-hidden" });
    this.renderFocusControls();
    const immersiveClose = container.createEl("button", { text: "×", cls: "flow-reader__immersive-close", attr: { "aria-label": "Sair da tela cheia" } });
    immersiveClose.addEventListener("click", () => void this.toggleFullscreen());
    this.selectionBar = document.body.createDiv({ cls: "flow-reader__selection-bar is-hidden" });
    const highlightButton = this.selectionBar.createEl("button", { text: "Destacar e comentar", cls: "mod-cta" });
    highlightButton.addEventListener("click", () => this.openPendingAnnotation());
    const startFastButton = this.selectionBar.createEl("button", { text: "Marcar para ler daqui", attr: { "aria-label": "Marcar palavra como início da leitura rápida" } });
    startFastButton.addEventListener("click", () => this.markFastStartFromSelection());
    this.selectionBar.createSpan({ cls: "flow-reader__selection-hint", text: "Dois toques fora para cancelar" });
    container.addEventListener("keydown", (event) => this.handleReaderKeydown(event));
  }

  private renderFastControls(): void {
    const header = this.fastPanel.createDiv({ cls: "flow-reader__fast-header" });
    const close = header.createEl("button", { text: "×", cls: "flow-reader__fast-close", attr: { "aria-label": "Sair da leitura rápida" } });
    close.addEventListener("click", () => void this.closeFastPanel());
    header.createDiv({ cls: "flow-reader__fast-title", text: "Leitura rápida" });
    const stage = this.fastPanel.createDiv({ cls: "flow-reader__fast-stage" });
    stage.tabIndex = 0;
    stage.setAttribute("role", "button");
    stage.setAttribute("aria-label", "Reproduzir ou pausar leitura rápida");
    stage.addEventListener("click", () => this.toggleFastPlayback());
    stage.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.toggleFastPlayback();
      }
    });
    stage.createDiv({ cls: "flow-reader__focus-line flow-reader__focus-line--top" });
    stage.createDiv({ cls: "flow-reader__focus-tick flow-reader__focus-tick--top" });
    this.fastOutput = stage.createDiv({ cls: "flow-reader__fast-word", text: "Leitura rápida" });
    stage.createDiv({ cls: "flow-reader__focus-line flow-reader__focus-line--bottom" });
    stage.createDiv({ cls: "flow-reader__focus-tick flow-reader__focus-tick--bottom" });
    const controls = this.fastPanel.createDiv({ cls: "flow-reader__fast-controls" });
    const back = controls.createEl("button", { text: "−5", attr: { "aria-label": "Voltar cinco palavras" } });
    this.fastPlayButton = controls.createEl("button", { text: "▶", attr: { "aria-label": "Reproduzir ou pausar" } });
    const forward = controls.createEl("button", { text: "+5", attr: { "aria-label": "Avançar cinco palavras" } });
    this.fastSpeedInput = controls.createEl("input", { type: "range", attr: { min: "100", max: "1000", step: "25", value: String(this.fastWpm), "aria-label": "Palavras por minuto" } });
    this.fastSpeedLabel = controls.createSpan({ text: `${this.fastWpm} ppm` });
    const smaller = controls.createEl("button", { text: "A−", attr: { "aria-label": "Diminuir palavra" } });
    const larger = controls.createEl("button", { text: "A+", attr: { "aria-label": "Aumentar palavra" } });
    const reset = controls.createEl("button", { text: "↺", attr: { "aria-label": "Restaurar velocidade e tamanho padrão", title: "Restaurar padrão" } });
    back.addEventListener("click", () => this.fastReader?.seek(-5));
    forward.addEventListener("click", () => this.fastReader?.seek(5));
    this.fastTimeElement = controls.createSpan({ cls: "flow-reader__fast-time", text: "Tempo restante: —" });
    this.fastPlayButton.addEventListener("click", () => this.toggleFastPlayback());
    this.fastSpeedInput.addEventListener("input", () => {
      const wordsPerMinute = Number(this.fastSpeedInput.value);
      this.fastWpm = wordsPerMinute;
      this.fastSpeedLabel.textContent = `${wordsPerMinute} ppm`;
      this.fastReader?.setOptions({ wordsPerMinute });
      this.updateFastRemainingTime();
      this.schedulePositionSave();
    });
    smaller.addEventListener("click", () => this.changeFastFontSize(-4));
    larger.addEventListener("click", () => this.changeFastFontSize(4));
    reset.addEventListener("click", () => {
      this.fastWpm = this.plugin.flowSettings.fastWordsPerMinute;
      this.fastSpeedInput.value = String(this.fastWpm);
      this.fastSpeedLabel.textContent = `${this.fastWpm} ppm`;
      this.fastFontSize = this.plugin.flowSettings.fastFontSize;
      this.applyFastFontSize();
      this.fastReader?.setOptions({ wordsPerMinute: this.fastWpm });
      this.updateFastRemainingTime();
      this.schedulePositionSave();
    });
  }

  private renderFocusControls(): void {
    const close = this.focusPanel.createEl("button", { text: "×", attr: { "aria-label": "Sair do Foco em Linha" } });
    close.addEventListener("click", () => this.closeFocusMode());
    this.focusPanel.createSpan({ cls: "flow-reader__focus-label", text: "Foco em Linha" });
    const back = this.focusPanel.createEl("button", { text: "−5", attr: { "aria-label": "Voltar cinco palavras" } });
    this.focusPlayButton = this.focusPanel.createEl("button", { text: "▶", cls: "mod-cta", attr: { "aria-label": "Reproduzir ou pausar" } });
    const forward = this.focusPanel.createEl("button", { text: "+5", attr: { "aria-label": "Avançar cinco palavras" } });
    const speed = this.focusPanel.createEl("input", { type: "range", attr: { min: "80", max: "600", step: "10", value: String(this.focusWpm), "aria-label": "Velocidade do Foco em Linha" } });
    const speedLabel = this.focusPanel.createSpan({ cls: "flow-reader__focus-speed", text: `${this.focusWpm} ppm` });
    const reset = this.focusPanel.createEl("button", { text: "↺", attr: { "aria-label": "Restaurar velocidade padrão", title: "Restaurar padrão" } });
    back.addEventListener("click", () => this.seekFocus(-5));
    forward.addEventListener("click", () => this.seekFocus(5));
    this.focusPlayButton.addEventListener("click", () => this.toggleFocusPlayback());
    speed.addEventListener("input", () => {
      this.focusWpm = Number(speed.value);
      speedLabel.textContent = `${this.focusWpm} ppm`;
      if (this.focusTimer !== null) {
        this.pauseFocusPlayback();
        this.startFocusPlayback();
      }
    });
    reset.addEventListener("click", () => {
      this.focusWpm = this.plugin.flowSettings.focusWordsPerMinute;
      speed.value = String(this.focusWpm);
      speedLabel.textContent = `${this.focusWpm} ppm`;
      if (this.focusTimer !== null) { this.pauseFocusPlayback(); this.startFocusPlayback(); }
    });
  }

  private openFocusMode(): void {
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    if (!article) return;
    this.fastReader?.pause();
    this.fastPlayButton.textContent = "▶";
    this.prepareFocusWords(article);
    this.focusIndex = Math.max(0, Math.min(this.fastWordIndex, this.focusWords.length - 1));
    article.addClass("is-focus-reading");
    this.focusPanel.removeClass("is-hidden");
    this.showFocusWord();
  }

  private closeFocusMode(): void {
    this.pauseFocusPlayback();
    this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter")?.removeClass("is-focus-reading");
    this.focusPanel.addClass("is-hidden");
    this.fastWordIndex = this.focusIndex;
    this.highlightStoppedWord();
    this.schedulePositionSave();
  }

  private prepareFocusWords(article: HTMLElement): void {
    if (article.querySelector(".flow-reader__focus-word")) {
      this.focusWords = Array.from(article.querySelectorAll<HTMLElement>(".flow-reader__focus-word"));
      return;
    }
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest("style, script") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes: Text[] = [];
    let node = walker.nextNode() as Text | null;
    while (node) { nodes.push(node); node = walker.nextNode() as Text | null; }
    nodes.forEach((text) => {
      if (!/\S/.test(text.data)) return;
      const fragment = document.createDocumentFragment();
      text.data.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) fragment.append(document.createTextNode(part));
        else fragment.append(Object.assign(document.createElement("span"), { className: "flow-reader__focus-word", textContent: part }));
      });
      text.replaceWith(fragment);
    });
    this.focusWords = Array.from(article.querySelectorAll<HTMLElement>(".flow-reader__focus-word"));
  }

  private toggleFocusPlayback(): void {
    if (this.focusTimer === null) this.startFocusPlayback();
    else this.pauseFocusPlayback();
  }

  private startFocusPlayback(): void {
    if (!this.focusWords.length) return;
    this.focusPlayButton.textContent = "⏸";
    const advance = (): void => {
      this.showFocusWord();
      const word = this.focusWords[this.focusIndex]?.textContent ?? "";
      const pauseFactor = /[.!?…][”"')\]]?$/.test(word) ? 1.8 : /[,;:][”"')\]]?$/.test(word) ? 1.3 : 1;
      this.focusTimer = window.setTimeout(() => {
        if (this.focusIndex >= this.focusWords.length - 1) { this.pauseFocusPlayback(); return; }
        this.focusIndex += 1;
        advance();
      }, (60_000 / this.focusWpm) * pauseFactor);
    };
    advance();
  }

  private pauseFocusPlayback(): void {
    if (this.focusTimer !== null) window.clearTimeout(this.focusTimer);
    this.focusTimer = null;
    if (this.focusPlayButton) this.focusPlayButton.textContent = "▶";
  }

  private seekFocus(delta: number): void {
    this.focusIndex = Math.max(0, Math.min(this.focusWords.length - 1, this.focusIndex + delta));
    this.showFocusWord();
  }

  private showFocusWord(): void {
    this.focusWords.forEach((word) => word.removeClass("is-active"));
    const active = this.focusWords[this.focusIndex];
    if (!active) return;
    active.addClass("is-active");
    this.fastWordIndex = this.focusIndex;
    this.noteReadingActivity();
    this.fastReader?.setIndex(this.focusIndex);
    const wordRect = active.getBoundingClientRect();
    const readerRect = this.readerHost.getBoundingClientRect();
    const comfortTop = readerRect.top + readerRect.height * .24;
    const comfortBottom = readerRect.top + readerRect.height * .76;
    if (wordRect.top < comfortTop || wordRect.bottom > comfortBottom) {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    this.schedulePositionSave();
  }

  private toggleSpeech(): void {
    if (!("speechSynthesis" in window)) { new Notice("Leitura em voz alta não está disponível neste dispositivo."); return; }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      this.voiceButton.removeClass("is-active");
      return;
    }
    const article = this.readerHost?.querySelector<HTMLElement>(".flow-reader__chapter");
    const chapterText = article ? this.getReadableArticleText(article) : this.readerHost?.innerText ?? "";
    const chunks = chapterText.match(/\S+\s*/g) ?? [];
    // The saved reader word is the source of truth for fast reading and voice alike.
    const source = chunks.slice(Math.max(0, Math.min(this.fastWordIndex, chunks.length - 1))).join("").trim();
    if (!source) return;
    const utterance = new SpeechSynthesisUtterance(source);
    utterance.lang = "pt-BR";
    utterance.rate = this.plugin.flowSettings.voiceRate ?? this.voiceRate;
    utterance.onend = () => this.voiceButton?.removeClass("is-active");
    utterance.onerror = () => this.voiceButton?.removeClass("is-active");
    this.voiceButton.addClass("is-active");
    window.speechSynthesis.speak(utterance);
    if (this.fastWordIndex > 0) new Notice(`Lendo a partir da palavra ${this.fastWordIndex + 1}.`);
  }

  private async loadBook(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file || file.extension.toLowerCase() !== "epub") {
      new Notice("Leitura DS: arquivo EPUB não encontrado.");
      return;
    }
    this.readerHost.empty();
    this.readerHost.createDiv({ cls: "flow-reader__loading", text: "Abrindo livro…" });
    try {
      this.releaseBook();
      this.chapterWordCounts.clear();
      const buffer = await this.app.vault.readBinary(file);
      this.book = await parseEpub(buffer, file.path);
      await this.plugin.registerBook(this.book);
      if (this.requestedLegacyBookId) {
        await this.plugin.migrateBookState(this.requestedLegacyBookId, this.book.id);
        this.requestedLegacyBookId = "";
      }
      this.sourceFilePath = file.path;
      this.titleElement.textContent = this.book.title;
      this.chapterSelect.empty();
      this.book.chapters.forEach((chapter) => this.chapterSelect.createEl("option", { text: chapter.label }));
      const saved = this.plugin.getPosition(this.book.id);
      this.returnPosition = this.requestedAnnotationId && saved ? { ...saved } : null;
      const defaults = this.plugin.flowSettings;
      this.fontSize = saved?.fontSize ?? defaults.defaultFontSize;
      this.theme = saved?.theme ?? defaults.defaultTheme;
      this.focusColor = saved?.focusColor ?? defaults.defaultFocusColor;
      this.fontFamily = saved?.fontFamily ?? "book";
      this.lineHeight = saved?.lineHeight ?? 1.75;
      this.pageWidth = saved?.pageWidth ?? 760;
      this.pageMargin = saved?.pageMargin ?? 16;
      this.textAlign = saved?.textAlign ?? "left";
      this.fastFontSize = saved?.fastFontSize ?? defaults.fastFontSize;
      this.fastWpm = saved?.fastWordsPerMinute ?? defaults.fastWordsPerMinute;
      this.focusWpm = saved?.focusWordsPerMinute ?? defaults.focusWordsPerMinute;
      this.fastSpeedInput.value = String(this.fastWpm);
      this.fastSpeedLabel.textContent = `${this.fastWpm} ppm`;
      this.colorFlow = saved?.colorFlow ?? false;
      this.colorFlowButton.toggleClass("is-active", this.colorFlow);
      this.twoColumn = saved?.twoColumn ?? false;
      this.twoColumnButton.toggleClass("is-active", this.twoColumn);
      this.applyFastFontSize();
      this.applyTheme();
      this.socialMode = defaults.defaultSocialMode ?? "normal";
      this.socialModeSelect.value = this.socialMode;
      const requested = this.requestedChapterIndex;
      this.requestedChapterIndex = null;
      const annotationId = this.requestedAnnotationId;
      this.requestedAnnotationId = "";
      await this.showChapter(requested ?? saved?.chapterIndex ?? 0, requested === null, "", Boolean(annotationId));
      if (annotationId) {
        this.returnReadingText.textContent = "Você abriu um destaque.";
        this.returnReadingBar.removeClass("is-hidden");
        window.requestAnimationFrame(() => this.scrollToAnnotation(annotationId));
      } else {
        this.returnReadingBar.addClass("is-hidden");
      }
    } catch (error) {
      console.error("Leitura DS failed to open EPUB", error);
      this.readerHost.empty();
      this.readerHost.createDiv({ cls: "flow-reader__error", text: error instanceof Error ? error.message : "Não foi possível abrir o EPUB." });
    }
  }

  private async showChapter(index: number, restoreSaved = false, fragment = "", skipPersist = false): Promise<void> {
    if (!this.book) return;
    this.pauseFocusPlayback();
    window.speechSynthesis?.cancel();
    this.voiceButton?.removeClass("is-active");
    this.focusPanel?.addClass("is-hidden");
    this.focusWords = [];
    this.chapterIndex = Math.max(0, Math.min(index, this.book.chapters.length - 1));
    const chapter = this.book.chapters[this.chapterIndex];
    if (!chapter) return;
    this.chapterSelect.selectedIndex = this.chapterIndex;
    this.previousButton.disabled = this.chapterIndex === 0;
    this.nextButton.disabled = this.chapterIndex === this.book.chapters.length - 1;
    this.readerHost.empty();
    const article = this.readerHost.createEl("article", { cls: "flow-reader__chapter" });
    article.style.fontSize = `${this.fontSize}px`;
    article.innerHTML = chapter.html;
    this.applyReadingLayout(article);
    this.applyColorFlow();
    this.applyTwoColumn();
    this.applyAnnotations(article);
    article.addEventListener("click", (event) => this.handleArticleClick(event));
    article.querySelectorAll("a[href]").forEach((anchor) => {
      anchor.addEventListener("click", (event) => {
        const href = anchor.getAttribute("href") ?? "";
        event.preventDefault();
        void this.followBookLink(href);
      });
    });
    const saved = this.plugin.getPosition(this.book.id);
    this.fastWordIndex = restoreSaved && saved?.chapterIndex === this.chapterIndex ? saved.fastWordIndex ?? 0 : 0;
    if (restoreSaved && saved?.chapterIndex === this.chapterIndex) this.fastWordIndex = this.resolveSavedWordIndex(article, saved, this.fastWordIndex);
    const scrollTop = restoreSaved && saved?.chapterIndex === this.chapterIndex ? saved.scrollTop ?? 0 : 0;
    this.fastReader?.destroy();
    this.fastReader = new FastReader(this.fastOutput, (wordIndex) => {
      this.fastWordIndex = wordIndex;
      this.noteReadingActivity();
      this.updateFastRemainingTime();
      this.schedulePositionSave();
    }, { wordsPerMinute: this.fastWpm, wordsPerGroup: 1 });
    this.fastReader.load(this.getReadableArticleText(article), this.fastWordIndex);
    window.requestAnimationFrame(() => {
      if (fragment) this.scrollToFragment(fragment);
      else this.readerHost.scrollTop = scrollTop;
      if (restoreSaved && saved?.chapterIndex === this.chapterIndex) this.highlightStoppedWord();
      this.updateLiveProgress();
      if (this.socialMode !== "normal") this.renderSocialMode();
    });
    if (!skipPersist) await this.persistPosition();
  }

  private setSocialMode(mode: SocialReadingMode): void {
    this.socialMode = mode;
    this.socialModeSelect.value = mode;
    if (mode === "normal") {
      this.socialOverlay.addClass("is-hidden");
      this.readerHost.removeClass("is-social-active");
      this.socialMove = null;
      this.highlightStoppedWord();
      this.schedulePositionSave();
      return;
    }
    this.renderSocialMode();
  }

  private renderSocialMode(): void {
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    if (!article || this.socialMode === "normal") return;
    // Cards that occupy an entire screen need deliberately short passages. The
    // thread can keep longer passages because it scrolls as a normal feed.
    this.socialChunks = this.createSocialChunks(article, this.socialMode === "thread" ? 360 : 170);
    if (!this.socialChunks.length) return;
    const index = this.socialChunks.findIndex((chunk, current) => chunk.startWord <= this.fastWordIndex && (!this.socialChunks[current + 1] || this.socialChunks[current + 1].startWord > this.fastWordIndex));
    this.socialIndex = Math.max(0, index);
    this.socialOverlay.empty();
    this.socialOverlay.removeClass("is-hidden");
    this.socialOverlay.className = `flow-reader__social flow-reader__social--${this.socialMode}`;
    this.readerHost.addClass("is-social-active");
    const header = this.socialOverlay.createDiv({ cls: "flow-reader__social-header" });
    const exit = header.createEl("button", { text: "×", attr: { "aria-label": "Sair deste modo" } });
    exit.addEventListener("click", () => this.setSocialMode("normal"));
    header.createSpan({ text: this.book?.chapters[this.chapterIndex]?.label ?? "Capítulo" });
    const progress = header.createSpan({ cls: "flow-reader__social-progress" });
    const renderStep = (): void => {
      const chunk = this.socialChunks[this.socialIndex];
      if (!chunk) return;
      this.fastWordIndex = chunk.startWord;
      progress.textContent = `${this.socialIndex + 1} / ${this.socialChunks.length}`;
      this.socialOverlay.querySelector(".flow-reader__social-body")?.remove();
      const body = this.socialOverlay.createDiv({ cls: "flow-reader__social-body" });
      if (this.socialMode === "thread") {
        this.socialChunks.forEach((item, index) => {
          const card = body.createDiv({ cls: index === this.socialIndex ? "flow-reader__thread-card is-current" : "flow-reader__thread-card", text: item.text });
          card.addEventListener("click", () => { this.socialIndex = index; renderStep(); });
        });
        body.scrollTop = Math.max(0, (body.querySelector(".is-current") as HTMLElement | null)?.offsetTop - 80 || 0);
      } else {
        const card = body.createDiv({ cls: "flow-reader__social-card", text: chunk.text, attr: { "aria-live": "polite" } });
        const navigation = body.createDiv({ cls: "flow-reader__social-navigation" });
        const previous = navigation.createEl("button", { text: "‹", attr: { "aria-label": "Trecho anterior" } });
        const counter = navigation.createSpan({ text: `${this.socialIndex + 1} de ${this.socialChunks.length}` });
        const next = navigation.createEl("button", { text: "›", attr: { "aria-label": "Próximo trecho" } });
        previous.addEventListener("click", () => move(-1)); next.addEventListener("click", () => move(1));
        if (this.socialMode === "carousel") counter.setAttribute("title", "Arraste para o lado para continuar");
        if (this.socialMode === "stories") counter.setAttribute("title", "Toque à direita para avançar ou à esquerda para voltar");
        card.tabIndex = 0;
        card.addEventListener("keydown", (event) => { if (event.key === "ArrowLeft") move(-1); if (event.key === "ArrowRight" || event.key === " ") move(1); });
      }
      this.schedulePositionSave();
    };
    const move = (delta: number): void => {
      this.socialIndex = Math.max(0, Math.min(this.socialChunks.length - 1, this.socialIndex + delta));
      renderStep();
    };
    this.socialMove = move;
    renderStep();
  }

  private createSocialChunks(article: HTMLElement, maximumCharacters: number): Array<{ text: string; startWord: number }> {
    const paragraphs = Array.from(article.querySelectorAll<HTMLElement>("p, li, blockquote, h1, h2, h3"))
      .map((element) => element.innerText.replace(/\s+/g, " ").trim()).filter(Boolean);
    const source = paragraphs.length ? paragraphs : [this.getReadableArticleText(article).replace(/\s+/g, " ").trim()];
    const chunks: Array<{ text: string; startWord: number }> = [];
    let wordsBefore = 0;
    source.forEach((paragraph) => {
      const words = paragraph.match(/\S+/g) ?? [];
      let part: string[] = [];
      let partStart = wordsBefore;
      words.forEach((word) => {
        if (part.length && `${part.join(" ")} ${word}`.length > maximumCharacters) { chunks.push({ text: part.join(" "), startWord: partStart }); partStart += part.length; part = []; }
        part.push(word);
      });
      if (part.length) chunks.push({ text: part.join(" "), startWord: partStart });
      wordsBefore += words.length;
    });
    return chunks;
  }

  private scrollToAnnotation(annotationId: string): void {
    const mark = this.readerHost.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
    mark?.scrollIntoView({ block: "center", behavior: "smooth" });
    mark?.addClass("is-targeted");
    window.setTimeout(() => mark?.removeClass("is-targeted"), 2200);
  }

  private async returnToReadingPosition(): Promise<void> {
    if (!this.book || !this.returnPosition) return;
    const position = { ...this.returnPosition };
    this.returnPosition = null;
    this.returnReadingBar.addClass("is-hidden");
    await this.plugin.setPosition(this.book.id, position);
    await this.showChapter(position.chapterIndex, true);
  }

  private async changeChapter(delta: number): Promise<void> {
    await this.showChapter(this.chapterIndex + delta);
  }

  private getReadableArticleText(article: HTMLElement): string {
    return this.getReadableTextNodes(article).map((node) => node.data).join("");
  }

  private getReadableWords(article: HTMLElement): string[] {
    return Array.from(this.getReadableArticleText(article).matchAll(/\S+/g), (match) => match[0]);
  }

  private resolveSavedWordIndex(article: HTMLElement, saved: ReadingPosition, fallback: number): number {
    if (!saved.word) return fallback;
    const words = this.getReadableWords(article);
    const target = saved.word.toLocaleLowerCase("pt-BR");
    let bestIndex = -1;
    let bestScore = -1;
    words.forEach((word, index) => {
      if (word.toLocaleLowerCase("pt-BR") !== target) return;
      let score = 0;
      (saved.contextBefore ?? []).forEach((context, offset) => {
        const candidate = words[index - (saved.contextBefore!.length - offset)];
        if (candidate?.toLocaleLowerCase("pt-BR") === context.toLocaleLowerCase("pt-BR")) score += 2;
      });
      (saved.contextAfter ?? []).forEach((context, offset) => {
        if (words[index + offset + 1]?.toLocaleLowerCase("pt-BR") === context.toLocaleLowerCase("pt-BR")) score += 2;
      });
      score -= Math.min(2, Math.abs(index - fallback) / 1000);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    return bestIndex >= 0 ? bestIndex : fallback;
  }

  private getReadableTextNodes(article: HTMLElement): Text[] {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest("style, script") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes: Text[] = [];
    let node = walker.nextNode() as Text | null;
    while (node) { nodes.push(node); node = walker.nextNode() as Text | null; }
    return nodes;
  }

  private openFastPanel(): void {
    this.clearStoppedWordHighlight();
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    if (article && this.fastReader) this.fastReader.load(this.getReadableArticleText(article), this.fastWordIndex);
    this.fastPanel.removeClass("is-hidden");
    this.fastPanel.tabIndex = -1;
    this.fastPanel.focus({ preventScroll: true });
    this.updateFastRemainingTime();
  }

  private async closeFastPanel(): Promise<void> {
    this.fastReader?.pause();
    this.fastWordIndex = this.fastReader?.getDisplayedIndex() ?? this.fastWordIndex;
    this.fastPanel.addClass("is-hidden");
    this.fastPlayButton.textContent = "▶";
    window.requestAnimationFrame(() => this.highlightStoppedWord());
    await this.persistPosition();
    await this.flushReadingStats();
  }

  private changeFontSize(delta: number): void {
    this.fontSize = Math.max(12, Math.min(40, this.fontSize + delta));
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    if (article) article.style.fontSize = `${this.fontSize}px`;
    this.schedulePositionSave();
  }

  private async followBookLink(href: string): Promise<void> {
    if (!this.book || !href) return;
    const current = this.book.chapters[this.chapterIndex];
    if (!current) return;
    const [rawPath, rawFragment = ""] = href.split("#");
    const targetPath = rawPath ? resolvePath(dirname(current.href), rawPath) : current.href;
    const targetIndex = this.book.chapters.findIndex((chapter) => chapter.href === targetPath);
    const fragment = decodeURIComponent(rawFragment);
    if (targetIndex >= 0 && targetIndex !== this.chapterIndex) await this.showChapter(targetIndex, false, fragment);
    else if (targetIndex >= 0 || !rawPath) this.scrollToFragment(fragment);
  }

  private scrollToFragment(fragment: string): void {
    if (!fragment) return;
    const target = Array.from(this.readerHost.querySelectorAll<HTMLElement>("[id], [name]")).find(
      (element) => element.id === fragment || element.getAttribute("name") === fragment
    );
    target?.scrollIntoView({ block: "start" });
    this.schedulePositionSave();
  }

  private openSearch(): void {
    if (!this.book) return;
    new BookSearchModal(this.app, this.book, (chapterIndex, term) => {
      void this.showChapter(chapterIndex).then(() => this.highlightSearchTerm(term));
    }).open();
  }

  private highlightSearchTerm(term: string): void {
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    if (!article || !term) return;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const index = node.data.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + term.length);
        const mark = document.createElement("mark");
        mark.className = "flow-reader__search-mark";
        range.surroundContents(mark);
        mark.scrollIntoView({ block: "center" });
        return;
      }
      node = walker.nextNode() as Text | null;
    }
  }

  private openMarkers(): void {
    if (!this.book) return;
    new MarkersModal(
      this.app,
      this.plugin.getMarkers(this.book.id),
      (name) => void this.addMarker(name),
      (marker) => void this.goToMarker(marker),
      (marker) => void this.plugin.deleteMarker(this.book!.id, marker.id)
    ).open();
  }

  private async addMarker(name: string): Promise<void> {
    if (!this.book) return;
    await this.persistPosition();
    const position = this.plugin.getPosition(this.book.id);
    if (!position) return;
    const marker: BookMarker = { id: `marker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, position: { ...position }, createdAt: new Date().toISOString() };
    await this.plugin.saveMarker(this.book.id, marker);
    new Notice(`Marcador “${name}” adicionado.`);
  }

  private async goToMarker(marker: BookMarker): Promise<void> {
    if (!this.book) return;
    const current = this.plugin.getPosition(this.book.id);
    this.returnPosition = current ? { ...current } : null;
    await this.showChapter(marker.position.chapterIndex, false, "", true);
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    if (!article) return;
    this.fastWordIndex = this.resolveSavedWordIndex(article, marker.position, marker.position.fastWordIndex ?? 0);
    this.fastReader?.load(this.getReadableArticleText(article), this.fastWordIndex);
    window.requestAnimationFrame(() => this.highlightStoppedWord());
    if (this.returnPosition) {
      this.returnReadingText.textContent = "Você abriu um marcador.";
      this.returnReadingBar.removeClass("is-hidden");
    }
  }

  private openAppearanceSettings(): void {
    const settings: ReaderAppearance = {
      theme: this.theme, focusColor: this.focusColor, fontSize: this.fontSize, fontFamily: this.fontFamily,
      lineHeight: this.lineHeight, pageWidth: this.pageWidth, pageMargin: this.pageMargin, textAlign: this.textAlign
    };
    new AppearanceModal(this.app, settings, (next) => {
      this.theme = next.theme;
      this.focusColor = next.focusColor;
      this.fontSize = next.fontSize;
      this.fontFamily = next.fontFamily;
      this.lineHeight = next.lineHeight;
      this.pageWidth = next.pageWidth;
      this.pageMargin = next.pageMargin;
      this.textAlign = next.textAlign;
      this.applyTheme();
      const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
      if (article) this.applyReadingLayout(article);
      this.schedulePositionSave();
    }).open();
  }

  private applyTheme(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.removeClass("is-theme-paper", "is-theme-sepia", "is-theme-forest", "is-theme-midnight", "is-theme-dark");
    if (this.theme !== "default") root.addClass(`is-theme-${this.theme}`);
    root.style.setProperty("--flow-reader-accent", this.focusColor);
  }

  private applyReadingLayout(article: HTMLElement): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.style.setProperty("--flow-reader-max-width", `${this.pageWidth}px`);
    root.style.setProperty("--flow-reader-page-margin", `${this.pageMargin}px`);
    article.style.fontSize = `${this.fontSize}px`;
    article.style.lineHeight = String(this.lineHeight);
    article.style.textAlign = this.textAlign;
    const families: Record<ReaderFont, string> = {
      book: "var(--font-text)", serif: "Georgia, 'Times New Roman', serif",
      sans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    };
    article.style.fontFamily = families[this.fontFamily];
  }

  private applyColorFlow(): void {
    const article = this.readerHost?.querySelector<HTMLElement>(".flow-reader__chapter");
    article?.toggleClass("is-color-flow", this.colorFlow);
  }

  private applyTwoColumn(): void {
    const article = this.readerHost?.querySelector<HTMLElement>(".flow-reader__chapter");
    article?.toggleClass("is-two-column", this.twoColumn);
  }

  private async toggleFullscreen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    const fallbackActive = root.hasClass("is-reader-fullscreen");
    if (document.fullscreenElement === root) {
      await document.exitFullscreen().catch(() => undefined);
      root.removeClass("is-reader-fullscreen");
    } else if (fallbackActive) {
      root.removeClass("is-reader-fullscreen");
    } else {
      root.addClass("is-immersive");
      try {
        await root.requestFullscreen({ navigationUI: "hide" });
      } catch {
        root.addClass("is-reader-fullscreen");
      }
    }
    const active = document.fullscreenElement === root || root.hasClass("is-reader-fullscreen");
    root.toggleClass("is-immersive", active);
    this.fullscreenButton.toggleClass("is-active", active);
    this.fullscreenButton.setAttribute("aria-label", active ? "Sair da tela cheia" : "Entrar em tela cheia");
  }

  private updateLiveProgress(): void {
    if (!this.book || !this.progressFill) return;
    const chapterProgress = this.readerHost.scrollHeight > this.readerHost.clientHeight
      ? this.readerHost.scrollTop / (this.readerHost.scrollHeight - this.readerHost.clientHeight)
      : 0;
    const progress = Math.max(0, Math.min(1, (this.chapterIndex + chapterProgress) / this.book.chapters.length));
    const displayedProgress = this.timeDisplayMode === "chapter" ? chapterProgress : progress;
    this.progressFill.style.width = `${displayedProgress * 100}%`;
    const track = this.progressFill.parentElement;
    track?.setAttribute("aria-valuenow", String(Math.round(displayedProgress * 100)));
    this.updateReadingStatus(progress, chapterProgress);
  }

  private scheduleProgressUpdate(): void {
    if (this.progressFrame !== null) return;
    this.progressFrame = window.requestAnimationFrame(() => {
      this.progressFrame = null;
      this.updateLiveProgress();
    });
  }

  private clearStoppedWordHighlight(): void {
    const parents = new Set<HTMLElement>();
    this.readerHost.querySelectorAll<HTMLElement>(".flow-reader__stopped-word").forEach((mark) => {
      if (mark.parentElement) parents.add(mark.parentElement);
      mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
    });
    parents.forEach((parent) => parent.normalize());
  }

  private highlightStoppedWord(): void {
    this.clearStoppedWordHighlight();
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    if (!article || this.fastWordIndex < 0) return;
    const nodes = this.getReadableTextNodes(article);
    const text = nodes.map((node) => node.data).join("");
    const words = Array.from(text.matchAll(/\S+/g));
    const wordMatch = words[this.fastWordIndex];
    if (!wordMatch || wordMatch.index === undefined) return;
    const word = wordMatch[0];
    const wordStart = wordMatch.index;
    const wordEnd = wordStart + word.length;
    const focusOffset = wordStart + optimalRecognitionPoint(word);
    const mapped: Array<{ node: Text; start: number; end: number }> = [];
    let offset = 0;
    nodes.forEach((node) => {
      mapped.push({ node, start: offset, end: offset + node.data.length });
      offset += node.data.length;
    });
    mapped.filter((item) => wordStart < item.end && wordEnd > item.start).reverse().forEach((item) => {
        const localStart = Math.max(0, wordStart - item.start);
        const localEnd = Math.min(item.node.data.length, wordEnd - item.start);
        if (localEnd <= localStart) return;
        const mark = document.createElement("mark");
        mark.className = "flow-reader__stopped-word";
        const range = document.createRange();
        range.setStart(item.node, localStart);
        range.setEnd(item.node, localEnd);
        range.surroundContents(mark);
        if (focusOffset >= item.start + localStart && focusOffset < item.start + localEnd) {
          const segment = mark.textContent ?? "";
          const localFocus = focusOffset - (item.start + localStart);
          const prefix = document.createTextNode(segment.slice(0, localFocus));
          const focus = document.createElement("span");
          focus.className = "flow-reader__stopped-focus";
          focus.textContent = segment.charAt(localFocus);
          const suffix = document.createTextNode(segment.slice(localFocus + 1));
          mark.replaceChildren(prefix, focus, suffix);
        }
    });
    this.readerHost.querySelector<HTMLElement>(".flow-reader__stopped-word")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  private schedulePositionSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistPosition();
    }, 700);
  }

  private noteReadingActivity(): void {
    const now = Date.now();
    if (this.lastReadingActivityAt) {
      const elapsed = Math.min(30, Math.max(0, (now - this.lastReadingActivityAt) / 1000));
      this.pendingReadingSeconds += elapsed;
    }
    this.lastReadingActivityAt = now;
    if (this.pendingReadingSeconds >= 45) void this.flushReadingStats();
  }

  private async flushReadingStats(): Promise<void> {
    if (this.lastReadingActivityAt && Date.now() - this.lastReadingActivityAt < 120_000) {
      this.pendingReadingSeconds += Math.min(30, Math.max(0, (Date.now() - this.lastReadingActivityAt) / 1000));
    }
    this.lastReadingActivityAt = 0;
    const seconds = this.pendingReadingSeconds;
    this.pendingReadingSeconds = 0;
    if (this.book && seconds >= 1) await this.plugin.recordReadingSeconds(this.book.id, seconds);
  }

  private async persistPosition(): Promise<void> {
    if (!this.book) return;
    const chapterProgress = this.readerHost.scrollHeight > this.readerHost.clientHeight
      ? this.readerHost.scrollTop / (this.readerHost.scrollHeight - this.readerHost.clientHeight)
      : 0;
    const progress = (this.chapterIndex + chapterProgress) / this.book.chapters.length;
    this.updateReadingStatus(progress, chapterProgress);
    if (this.returnPosition) return;
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    const words = article ? this.getReadableWords(article) : [];
    const safeWordIndex = Math.max(0, Math.min(this.fastWordIndex, Math.max(0, words.length - 1)));
    await this.plugin.setPosition(this.book.id, {
      chapterIndex: this.chapterIndex,
      progress,
      fastWordIndex: safeWordIndex,
      word: words[safeWordIndex],
      contextBefore: words.slice(Math.max(0, safeWordIndex - 3), safeWordIndex),
      contextAfter: words.slice(safeWordIndex + 1, safeWordIndex + 4),
      scrollTop: this.readerHost.scrollTop,
      fontSize: this.fontSize,
      theme: this.theme,
      focusColor: this.focusColor,
      fontFamily: this.fontFamily,
      lineHeight: this.lineHeight,
      pageWidth: this.pageWidth,
      pageMargin: this.pageMargin,
      textAlign: this.textAlign,
      fastFontSize: this.fastFontSize,
      fastWordsPerMinute: this.fastWpm,
      focusWordsPerMinute: this.focusWpm,
      colorFlow: this.colorFlow,
      twoColumn: this.twoColumn,
      updatedAt: new Date().toISOString()
    });
    this.updateSyncStatus();
  }

  private updateSyncStatus(): void {
    if (!this.syncStatusElement) return;
    this.syncStatusElement.textContent = "✓ Salvo no Vault";
    if (this.plugin.sharedSaveTime) this.syncStatusElement.title = `Última sincronização: ${new Date(this.plugin.sharedSaveTime).toLocaleString("pt-BR")}`;
  }

  private updateReadingStatus(progress: number, knownChapterProgress?: number): void {
    if (!this.book || !this.statusElement) return;
    const chapterWords = this.getChapterWordCount(this.chapterIndex);
    const chapterScrollProgress = knownChapterProgress ?? (this.readerHost.scrollHeight > this.readerHost.clientHeight
      ? this.readerHost.scrollTop / (this.readerHost.scrollHeight - this.readerHost.clientHeight)
      : 0);
    const currentChapterRemaining = Math.ceil(chapterWords * (1 - chapterScrollProgress));
    const laterChaptersWords = this.book.chapters.slice(this.chapterIndex + 1).reduce(
      (total, _chapter, relativeIndex) => total + this.getChapterWordCount(this.chapterIndex + 1 + relativeIndex),
      0
    );
    const remainingWords = this.timeDisplayMode === "chapter"
      ? currentChapterRemaining
      : currentChapterRemaining + laterChaptersWords;
    const minutes = Math.max(1, Math.ceil(remainingWords / 250));
    const label = this.timeDisplayMode === "chapter" ? "neste capítulo" : "no livro";
    const displayedProgress = this.timeDisplayMode === "chapter" ? chapterScrollProgress : progress;
    this.statusElement.textContent = `${Math.round(displayedProgress * 100)}% · cerca de ${minutes} min ${label}`;
    this.statusElement.title = "Toque para alternar livro/capítulo";
  }

  private getChapterWordCount(chapterIndex: number): number {
    const cached = this.chapterWordCounts.get(chapterIndex);
    if (cached !== undefined) return cached;
    const chapter = this.book?.chapters[chapterIndex];
    if (!chapter) return 0;
    const document = new DOMParser().parseFromString(chapter.html, "text/html");
    const count = document.body.textContent?.trim().match(/\S+/g)?.length ?? 0;
    this.chapterWordCounts.set(chapterIndex, count);
    return count;
  }

  private getChapterScrollProgress(): number {
    if (!this.readerHost || this.readerHost.scrollHeight <= this.readerHost.clientHeight) return 0;
    return Math.max(0, Math.min(1, this.readerHost.scrollTop / (this.readerHost.scrollHeight - this.readerHost.clientHeight)));
  }

  private getBookProgress(): number {
    if (!this.book?.chapters.length) return 0;
    return Math.max(0, Math.min(1, (this.chapterIndex + this.getChapterScrollProgress()) / this.book.chapters.length));
  }

  private async jumpToReadingProgress(percent: number): Promise<void> {
    if (!this.book?.chapters.length) return;
    const safePercent = Math.max(0, Math.min(1, percent));
    if (this.timeDisplayMode === "chapter") {
      this.readerHost.scrollTop = safePercent * Math.max(0, this.readerHost.scrollHeight - this.readerHost.clientHeight);
      this.updateLiveProgress();
      this.schedulePositionSave();
      return;
    }
    const exactChapter = safePercent * this.book.chapters.length;
    const targetChapter = Math.min(this.book.chapters.length - 1, Math.floor(exactChapter));
    const chapterPercent = safePercent === 1 ? 1 : exactChapter - targetChapter;
    await this.showChapter(targetChapter, false, "", true);
    this.readerHost.scrollTop = chapterPercent * Math.max(0, this.readerHost.scrollHeight - this.readerHost.clientHeight);
    this.updateLiveProgress();
    this.schedulePositionSave();
  }

  private changeFastFontSize(delta: number): void {
    this.fastFontSize = Math.max(28, Math.min(100, this.fastFontSize + delta));
    this.applyFastFontSize();
    this.schedulePositionSave();
  }

  private applyFastFontSize(): void {
    if (this.fastPanel) this.fastPanel.style.setProperty("--flow-fast-font-size", `${this.fastFontSize}px`);
  }

  private toggleFastPlayback(): void {
    const playing = this.fastReader?.toggle() ?? false;
    this.fastPlayButton.textContent = playing ? "⏸" : "▶";
  }

  private handleReaderKeydown(event: KeyboardEvent): void {
    if (this.fastPanel.hasClass("is-hidden")) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === "Space") {
      event.preventDefault();
      this.toggleFastPlayback();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.fastReader?.seek(-5);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.fastReader?.seek(5);
    } else if (event.key === "Escape") {
      event.preventDefault();
      void this.closeFastPanel();
    }
  }

  private updateFastRemainingTime(): void {
    if (!this.fastTimeElement || !this.fastReader) return;
    const minutes = this.fastReader.getRemainingMinutes();
    const totalSeconds = Math.max(0, Math.ceil(minutes * 60));
    const hours = Math.floor(totalSeconds / 3600);
    const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    this.fastTimeElement.textContent = hours > 0
      ? `Restante: ${hours}h ${remainingMinutes}min`
      : `Restante: ${remainingMinutes}:${seconds.toString().padStart(2, "0")}`;
  }

  private scheduleSelectionCapture(delay = 120): void {
    if (this.selectionTimer !== null) window.clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => {
      this.selectionTimer = null;
      this.captureSelection();
    }, delay);
  }

  private handleArticleClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("a, button, mark, input, select, textarea")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      this.scheduleSelectionCapture(0);
      return;
    }
    this.selectWordAtPoint(event.clientX, event.clientY);
  }

  private handleChapterSwipe(event: TouchEvent): void {
    if (!this.plugin.flowSettings.swipeNavigation) return;
    const start = this.touchStart;
    this.touchStart = null;
    const touch = event.changedTouches.item(0);
    const selection = window.getSelection();
    if (!start || !touch || (selection && !selection.isCollapsed)) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Date.now() - start.at > 900 || Math.abs(deltaX) < 100 || Math.abs(deltaY) > 75) return;
    if (deltaX < 0 && !this.nextButton.disabled) void this.changeChapter(1);
    if (deltaX > 0 && !this.previousButton.disabled) void this.changeChapter(-1);
  }

  private selectWordAtPoint(x: number, y: number): void {
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const caretPosition = documentWithCaret.caretPositionFromPoint?.(x, y);
    const fallbackRange = caretPosition ? null : documentWithCaret.caretRangeFromPoint?.(x, y);
    const node = caretPosition?.offsetNode ?? fallbackRange?.startContainer;
    const rawOffset = caretPosition?.offset ?? fallbackRange?.startOffset ?? 0;
    if (!(node instanceof Text) || !this.readerHost.contains(node)) return;
    const text = node.data;
    let offset = Math.min(rawOffset, Math.max(0, text.length - 1));
    if (/\s/.test(text.charAt(offset)) && offset > 0) offset -= 1;
    if (/\s/.test(text.charAt(offset))) return;
    let start = offset;
    let end = offset + 1;
    while (start > 0 && !/\s/.test(text.charAt(start - 1))) start -= 1;
    while (end < text.length && !/\s/.test(text.charAt(end))) end += 1;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    this.captureSelection();
  }

  private captureSelection(): void {
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    const selection = window.getSelection();
    if (!article || !selection || selection.isCollapsed || !selection.rangeCount) {
      this.hideSelectionBar();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) return;
    const quote = selection.toString().replace(/\s+/g, " ").trim();
    if (!quote || quote.length > 5000) return;
    const before = document.createRange();
    before.selectNodeContents(article);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length;
    const wordIndex = this.wordIndexAtPosition(article, range.startContainer, range.startOffset);
    if (this.pendingSelection?.quote !== quote || this.pendingSelection.startOffset !== startOffset) this.selectionDismissArmed = false;
    this.pendingSelection = { quote, startOffset, endOffset: startOffset + range.toString().length, wordIndex };
    this.positionSelectionBar(range.getBoundingClientRect());
    this.selectionBar.removeClass("is-hidden");
  }

  private hideSelectionBar(): void {
    this.pendingSelection = null;
    this.selectionDismissArmed = false;
    this.selectionBar?.addClass("is-hidden");
  }

  private wordIndexAtPosition(article: HTMLElement, targetNode: Node, targetOffset: number): number {
    const nodes = this.getReadableTextNodes(article);
    const text = nodes.map((node) => node.data).join("");
    let readableOffset = 0;
    const textIndex = nodes.indexOf(targetNode as Text);
    if (textIndex >= 0) {
      for (let index = 0; index < textIndex; index += 1) readableOffset += nodes[index]?.data.length ?? 0;
      readableOffset += targetOffset;
    } else {
      const before = document.createRange();
      before.selectNodeContents(article);
      before.setEnd(targetNode, targetOffset);
      const fragment = before.cloneContents();
      const wrapper = document.createElement("div");
      wrapper.append(fragment);
      wrapper.querySelectorAll("style, script").forEach((element) => element.remove());
      readableOffset = wrapper.textContent?.length ?? 0;
    }
    const words = Array.from(text.matchAll(/\S+/g));
    const containing = words.findIndex((match) => match.index !== undefined && readableOffset >= match.index && readableOffset < match.index + match[0].length);
    if (containing >= 0) return containing;
    const following = words.findIndex((match) => (match.index ?? 0) >= readableOffset);
    return following >= 0 ? following : Math.max(0, words.length - 1);
  }

  private handleSelectionOutsideTap(event: PointerEvent): void {
    if (!Platform.isMobile) return;
    if (!this.pendingSelection || this.selectionBar.hasClass("is-hidden")) return;
    const target = event.target;
    if (target instanceof Node && (this.selectionBar.contains(target) || target instanceof Element && Boolean(target.closest(".modal-container")))) return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.selectionDismissArmed) {
      this.selectionDismissArmed = true;
      this.selectionBar.addClass("is-dismiss-armed");
      return;
    }
    window.getSelection()?.removeAllRanges();
    this.hideSelectionBar();
    this.selectionBar.removeClass("is-dismiss-armed");
  }

  private positionSelectionBar(rect: DOMRect): void {
    const width = Math.min(330, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const preferredBelow = rect.bottom + 12;
    const top = preferredBelow + 72 < window.innerHeight ? preferredBelow : Math.max(80, rect.top - 72);
    this.selectionBar.style.left = `${left}px`;
    this.selectionBar.style.top = `${top}px`;
    this.selectionBar.style.width = `${width}px`;
  }

  private markFastStartFromSelection(): void {
    if (!this.pendingSelection) return;
    const article = this.readerHost.querySelector<HTMLElement>(".flow-reader__chapter");
    this.fastWordIndex = this.pendingSelection.wordIndex;
    if (article && this.fastReader) {
      this.fastReader.load(this.getReadableArticleText(article), this.fastWordIndex);
    }
    window.getSelection()?.removeAllRanges();
    this.hideSelectionBar();
    this.highlightStoppedWord();
    this.schedulePositionSave();
    new Notice("Ponto de início marcado. Toque em ⚡ quando quiser começar.");
  }

  private openPendingAnnotation(): void {
    if (!this.book || !this.pendingSelection) return;
    const now = new Date().toISOString();
    const annotation: BookAnnotation = {
      id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chapterIndex: this.chapterIndex,
      quote: this.pendingSelection.quote,
      startOffset: this.pendingSelection.startOffset,
      endOffset: this.pendingSelection.endOffset,
      color: "yellow",
      comment: "",
      createdAt: now,
      updatedAt: now
    };
    new AnnotationModal(this.app, annotation, (saved) => void this.saveAndRenderAnnotation(saved)).open();
    this.hideSelectionBar();
    window.getSelection()?.removeAllRanges();
  }

  private applyAnnotations(article: HTMLElement): void {
    if (!this.book) return;
    const annotations = this.plugin.getAnnotations(this.book.id)
      .filter((annotation) => annotation.chapterIndex === this.chapterIndex)
      .sort((a, b) => b.startOffset - a.startOffset);
    annotations.forEach((annotation) => this.wrapAnnotationRange(article, annotation));
  }

  private wrapAnnotationRange(article: HTMLElement, annotation: BookAnnotation): void {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let offset = 0;
    let text = walker.nextNode() as Text | null;
    while (text) {
      nodes.push({ node: text, start: offset, end: offset + text.data.length });
      offset += text.data.length;
      text = walker.nextNode() as Text | null;
    }
    nodes
      .filter((item) => annotation.startOffset < item.end && annotation.endOffset > item.start)
      .reverse()
      .forEach((item) => {
        const localStart = Math.max(0, annotation.startOffset - item.start);
        const localEnd = Math.min(item.node.data.length, annotation.endOffset - item.start);
        if (localEnd <= localStart) return;
        const range = document.createRange();
        range.setStart(item.node, localStart);
        range.setEnd(item.node, localEnd);
        const mark = document.createElement("mark");
        mark.className = `flow-reader__annotation flow-reader__annotation--${annotation.color}`;
        mark.dataset.annotationId = annotation.id;
        mark.title = annotation.comment || "Destaque sem comentário";
        range.surroundContents(mark);
        mark.addEventListener("click", () => this.editAnnotation(annotation));
      });
  }

  private editAnnotation(annotation: BookAnnotation): void {
    if (!this.book) return;
    new AnnotationModal(
      this.app,
      annotation,
      (saved) => void this.saveAndRenderAnnotation(saved),
      () => void this.deleteAndRenderAnnotation(annotation.id)
    ).open();
  }

  private async saveAndRenderAnnotation(annotation: BookAnnotation): Promise<void> {
    if (!this.book) return;
    await this.plugin.saveAnnotation(this.book.id, annotation);
    await this.showChapter(this.chapterIndex, true);
    new Notice("Destaque salvo.");
  }

  private async deleteAndRenderAnnotation(annotationId: string): Promise<void> {
    if (!this.book) return;
    await this.plugin.deleteAnnotation(this.book.id, annotationId);
    await this.showChapter(this.chapterIndex, true);
    new Notice("Destaque removido.");
  }

  private releaseBook(): void {
    this.book?.resources.forEach((url) => URL.revokeObjectURL(url));
    this.book = null;
  }
}

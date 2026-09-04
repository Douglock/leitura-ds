import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type LeituraDSPlugin from "./main";
import { parseCbr, parseCbz } from "./comic-parser";
import { MarkersModal } from "./markers-modal";
import { AnnotationModal } from "./annotation-modal";
import type { BookAnnotation, BookMarker, ComicBook, ReadingPosition } from "./types";

export const LEITURA_DS_COMIC_VIEW = "leitura-ds-comic";

export class LeituraDSComicView extends ItemView {
  private comic: ComicBook | null = null;
  private sourceFilePath = "";
  private requestedPage: number | null = null;
  private requestedLegacyBookId = "";
  private pageIndex = 0;
  private image!: HTMLImageElement;
  private secondaryImage!: HTMLImageElement;
  private title!: HTMLElement;
  private pageLabel!: HTMLElement;
  private progress!: HTMLElement;
  private previous!: HTMLButtonElement;
  private next!: HTMLButtonElement;
  private pageHost!: HTMLElement;
  private zoomLabel!: HTMLElement;
  private thumbnailTray!: HTMLElement;
  private thumbnailGrid!: HTMLElement;
  private annotationButton!: HTMLButtonElement;
  private spreadButton!: HTMLButtonElement;
  private directionButton!: HTMLButtonElement;
  private zoom = 1;
  private fitMode: "page" | "width" | "original" = "page";
  private spreadMode = false;
  private readingDirection: "ltr" | "rtl" = "ltr";
  private pageUrls = new Map<number, string>();
  private pageLoads = new Map<number, Promise<string>>();
  private pointers = new Map<number, { startX: number; startY: number; x: number; y: number }>();
  private pinchDistance = 0;
  private suppressPageClickUntil = 0;
  private thumbnailsOpen = false;
  private thumbnailRender = 0;
  private pageRequest = 0;
  private saveTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LeituraDSPlugin) { super(leaf); }
  getViewType(): string { return LEITURA_DS_COMIC_VIEW; }
  getDisplayText(): string { return this.comic?.title ?? "Leitura DS"; }
  getIcon(): string { return "images"; }

  async onOpen(): Promise<void> {
    this.renderShell();
    this.registerDomEvent(document, "keydown", (event) => {
      if (this.app.workspace.getActiveViewOfType(LeituraDSComicView) !== this || this.isTyping(event.target)) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); void this.movePage(this.readingDirection === "rtl" ? 1 : -1); }
      if (event.key === "ArrowRight") { event.preventDefault(); void this.movePage(this.readingDirection === "rtl" ? -1 : 1); }
      if (event.key === "PageUp") { event.preventDefault(); void this.movePage(-1); }
      if (event.key === " " || event.key === "PageDown") { event.preventDefault(); void this.movePage(1); }
      if (event.key === "ArrowUp") { event.preventDefault(); this.scrollComicPage(-1); }
      if (event.key === "ArrowDown") { event.preventDefault(); this.scrollComicPage(1); }
      if (event.key === "Home") { event.preventDefault(); void this.showPage(0); }
      if (event.key === "End" && this.comic) { event.preventDefault(); void this.showPage(this.comic.pages.length - 1); }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); this.changeZoom(.2); }
      if (event.key === "-") { event.preventDefault(); this.changeZoom(-.2); }
      if (event.key.toLowerCase() === "w") { event.preventDefault(); this.setFitMode("width"); }
      if (event.key.toLowerCase() === "h") { event.preventDefault(); this.setFitMode("page"); }
      if (event.key === "0") { event.preventDefault(); this.setFitMode("original"); }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); void this.toggleFullscreen(); }
      if (event.key.toLowerCase() === "t") { event.preventDefault(); this.toggleThumbnails(); }
      if (event.key.toLowerCase() === "g") { event.preventDefault(); void this.goToPage(); }
      if (event.key.toLowerCase() === "d") { event.preventDefault(); void this.toggleSpreadMode(); }
      if (event.key.toLowerCase() === "m") { event.preventDefault(); this.openMarkers(); }
      if (event.key.toLowerCase() === "a") { event.preventDefault(); this.openPageAnnotation(); }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); this.toggleReadingDirection(); }
    });
    if (this.sourceFilePath) await this.loadComic(this.sourceFilePath);
  }

  async onClose(): Promise<void> {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    await this.persistPosition();
    this.releaseComic();
  }

  async setState(state: unknown): Promise<void> {
    this.sourceFilePath = typeof state === "object" && state && "file" in state && typeof state.file === "string" ? state.file : "";
    this.requestedPage = typeof state === "object" && state && "pageIndex" in state && typeof state.pageIndex === "number" ? state.pageIndex : null;
    this.requestedLegacyBookId = typeof state === "object" && state && "legacyBookId" in state && typeof state.legacyBookId === "string" ? state.legacyBookId : "";
    if (this.image && this.sourceFilePath) await this.loadComic(this.sourceFilePath);
  }

  getState(): Record<string, string | number> { return { file: this.sourceFilePath, pageIndex: this.pageIndex }; }

  private renderShell(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty(); root.addClass("flow-comic");
    const toolbar = root.createDiv({ cls: "flow-comic__toolbar" });
    const home = toolbar.createEl("button", { text: "⌂", attr: { "aria-label": "Ir para Minha biblioteca", title: "Minha biblioteca" } });
    home.addEventListener("click", () => void this.plugin.openLibrary());
    this.title = toolbar.createDiv({ cls: "flow-comic__title", text: "Quadrinho" });
    this.previous = toolbar.createEl("button", { text: "←", attr: { "aria-label": "Página anterior" } });
    this.previous.addEventListener("click", () => void this.movePage(-1));
    this.pageLabel = toolbar.createDiv({ cls: "flow-comic__page", text: "Página 0" });
    this.next = toolbar.createEl("button", { text: "→", attr: { "aria-label": "Próxima página" } });
    this.next.addEventListener("click", () => void this.movePage(1));
    const fullscreen = toolbar.createEl("button", { text: "⛶", attr: { "aria-label": "Tela cheia", title: "Tela cheia (F)" } });
    fullscreen.addEventListener("click", () => void this.toggleFullscreen());
    const thumbnails = toolbar.createEl("button", { text: "▦", attr: { "aria-label": "Mostrar miniaturas", title: "Miniaturas (T)" } });
    thumbnails.addEventListener("click", () => this.toggleThumbnails());
    const goTo = toolbar.createEl("button", { text: "#", attr: { "aria-label": "Ir para página", title: "Ir para página (G)" } });
    goTo.addEventListener("click", () => void this.goToPage());
    const controls = root.createDiv({ cls: "flow-comic__controls", attr: { "aria-label": "Ajuste da página" } });
    const zoomOut = controls.createEl("button", { text: "−", attr: { "aria-label": "Diminuir zoom", title: "Diminuir zoom (−)" } });
    zoomOut.addEventListener("click", () => this.changeZoom(-.2));
    const fit = controls.createEl("button", { cls: "flow-comic__fit", text: "Ajustar página", attr: { "aria-label": "Alternar ajuste da página", title: "Ajustar página (H), largura (W) ou tamanho original (0)" } });
    fit.addEventListener("click", () => this.cycleFitMode());
    const zoomIn = controls.createEl("button", { text: "+", attr: { "aria-label": "Aumentar zoom", title: "Aumentar zoom (+)" } });
    zoomIn.addEventListener("click", () => this.changeZoom(.2));
    this.zoomLabel = controls.createDiv({ cls: "flow-comic__zoom", text: "100%" });
    this.spreadButton = controls.createEl("button", { cls: "flow-comic__spread-toggle", text: "Dupla", attr: { "aria-label": "Alternar páginas duplas", title: "Páginas duplas (D)" } });
    this.spreadButton.addEventListener("click", () => void this.toggleSpreadMode());
    this.directionButton = controls.createEl("button", { text: "RTL", attr: { "aria-label": "Alternar direção de leitura", title: "Modo mangá, direita para esquerda (R)" } });
    this.directionButton.addEventListener("click", () => this.toggleReadingDirection());
    const markers = controls.createEl("button", { text: "★", attr: { "aria-label": "Marcadores", title: "Marcadores (M)" } });
    markers.addEventListener("click", () => this.openMarkers());
    this.annotationButton = controls.createEl("button", { text: "Nota", attr: { "aria-label": "Anotar página", title: "Destaque e comentário da página (A)" } });
    this.annotationButton.addEventListener("click", () => this.openPageAnnotation());
    this.progress = root.createDiv({ cls: "flow-comic__progress" });
    this.thumbnailTray = root.createDiv({ cls: "flow-comic__thumbnails" });
    this.thumbnailGrid = this.thumbnailTray.createDiv({ cls: "flow-comic__thumbnail-grid" });
    this.pageHost = root.createDiv({ cls: "flow-comic__page-host", attr: { "data-fit": "page" } });
    this.pageHost.addEventListener("scroll", () => this.schedulePositionSave(), { passive: true });
    const spreadHost = this.pageHost.createDiv({ cls: "flow-comic__spread" });
    this.image = spreadHost.createEl("img", { cls: "flow-comic__image", attr: { alt: "Página do quadrinho" } });
    this.secondaryImage = spreadHost.createEl("img", { cls: "flow-comic__image flow-comic__image--secondary", attr: { alt: "" } });
    this.pageHost.addEventListener("click", (event) => {
      if (Date.now() < this.suppressPageClickUntil || this.zoom > 1.01 || this.pointers.size) return;
      const rect = this.pageHost.getBoundingClientRect();
      const onLeft = event.clientX < rect.left + rect.width / 2;
      void this.movePage(onLeft ? (this.readingDirection === "rtl" ? 1 : -1) : (this.readingDirection === "rtl" ? -1 : 1));
    });
    this.registerDomEvent(this.pageHost, "dblclick", (event) => { event.preventDefault(); this.setFitMode("page"); });
    this.registerDomEvent(this.pageHost, "pointerdown", (event) => this.onPointerDown(event));
    this.registerDomEvent(this.pageHost, "pointermove", (event) => this.onPointerMove(event));
    this.registerDomEvent(this.pageHost, "pointerup", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.pageHost, "pointercancel", (event) => this.pointers.delete(event.pointerId));
  }

  private async loadComic(path: string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    const extension = file?.extension.toLowerCase();
    if (!file || !["cbz", "cbr"].includes(extension ?? "")) { new Notice("Leitura DS: arquivo de quadrinho não encontrado."); return; }
    try {
      this.releaseComic();
      const binary = await this.app.vault.readBinary(file);
      this.comic = extension === "cbr" ? await parseCbr(binary, file.path, this.plugin.comicRuntimeBaseUrl) : await parseCbz(binary, file.path);
      await this.plugin.registerBook(this.comic);
      if (this.requestedLegacyBookId) {
        await this.plugin.migrateBookState(this.requestedLegacyBookId, this.comic.id);
        this.requestedLegacyBookId = "";
      }
      this.sourceFilePath = file.path;
      this.title.textContent = this.comic.title;
      const saved = this.plugin.getPosition(this.comic.id);
      const requested = this.requestedPage; this.requestedPage = null;
      const defaults = this.plugin.leituraSettings;
      this.fitMode = saved?.comicFitMode ?? defaults.defaultComicFitMode;
      this.zoom = saved?.comicZoom ?? 1;
      this.spreadMode = saved?.comicSpreadMode ?? defaults.defaultComicSpreadMode;
      this.readingDirection = saved?.comicReadingDirection ?? defaults.defaultComicReadingDirection;
      this.pageHost.toggleClass("is-spread", this.spreadMode);
      this.pageHost.toggleClass("is-rtl", this.readingDirection === "rtl");
      this.spreadButton.toggleClass("is-active", this.spreadMode);
      this.directionButton.toggleClass("is-active", this.readingDirection === "rtl");
      this.applyImageFit();
      const page = requested ?? saved?.chapterIndex ?? 0;
      const restoreScrollTop = requested === null && saved?.chapterIndex === page ? saved.comicScrollTop ?? 0 : 0;
      await this.showPage(page, false, restoreScrollTop);
    } catch (error) {
      console.error("Leitura DS could not open CBZ", error);
      this.image.removeAttribute("src");
      const host = this.image.parentElement;
      host?.querySelector(".flow-comic__error")?.remove();
      host?.createDiv({ cls: "flow-comic__error", text: error instanceof Error ? error.message : "Não foi possível abrir o quadrinho." });
      this.pageLabel.textContent = "Não foi possível abrir";
      new Notice(error instanceof Error ? error.message : "Não foi possível abrir o quadrinho.");
    }
  }

  private async showPage(index: number, shouldPersist = true, restoreScrollTop = 0): Promise<void> {
    if (!this.comic) return;
    const comic = this.comic;
    const request = ++this.pageRequest;
    const nextIndex = Math.max(0, Math.min(index, comic.pages.length - 1));
    const changedPage = nextIndex !== this.pageIndex;
    try {
      const url = await this.getPageUrl(nextIndex);
      const rightIndex = nextIndex + 1;
      const rightUrl = this.spreadMode && rightIndex < comic.pages.length ? await this.getPageUrl(rightIndex) : "";
      if (request !== this.pageRequest || this.comic !== comic) return;
      this.pageIndex = nextIndex;
      this.image.src = url;
      if (rightUrl) {
        this.secondaryImage.src = rightUrl;
        this.secondaryImage.alt = `${comic.title}, página ${rightIndex + 1}`;
        this.secondaryImage.show();
      } else {
        this.secondaryImage.removeAttribute("src");
        this.secondaryImage.hide();
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Não foi possível carregar esta página.");
      return;
    }
    // Each comic page is read from top to bottom. A page turn must not inherit
    // the scroll position of the preceding page.
    if (changedPage || restoreScrollTop > 0) {
      const scrollTop = changedPage ? restoreScrollTop : Math.max(this.pageHost.scrollTop, restoreScrollTop);
      this.pageHost.scrollTo({ top: scrollTop, left: 0, behavior: "auto" });
      window.requestAnimationFrame(() => {
        if (request === this.pageRequest) this.pageHost.scrollTo({ top: scrollTop, left: 0, behavior: "auto" });
      });
    }
    this.image.alt = `${comic.title}, página ${this.pageIndex + 1}`;
    const rightPage = this.spreadMode && this.pageIndex + 1 < comic.pages.length ? `–${this.pageIndex + 2}` : "";
    this.pageLabel.textContent = `Página ${this.pageIndex + 1}${rightPage} de ${comic.pages.length}`;
    this.progress.style.width = `${((this.pageIndex + 1) / comic.pages.length) * 100}%`;
    this.previous.disabled = this.pageIndex === 0;
    this.next.disabled = this.pageIndex >= this.comic.pages.length - (this.spreadMode ? 2 : 1);
    this.renderPageAnnotationState();
    this.trimPageCache();
    if (this.plugin.leituraSettings.preloadComicPages) void this.preloadNearbyPages();
    if (this.thumbnailsOpen) void this.renderThumbnails();
    if (shouldPersist) await this.persistPosition();
  }

  private async movePage(direction: -1 | 1): Promise<void> {
    await this.showPage(this.pageIndex + direction * (this.spreadMode ? 2 : 1));
  }

  /** Keeps tall pages readable without changing page accidentally. */
  private scrollComicPage(direction: -1 | 1): void {
    const distance = Math.max(120, Math.round(this.pageHost.clientHeight * .72));
    this.pageHost.scrollBy({ top: direction * distance, behavior: "smooth" });
  }

  private async toggleSpreadMode(): Promise<void> {
    this.spreadMode = !this.spreadMode;
    this.pageHost.toggleClass("is-spread", this.spreadMode);
    this.spreadButton.toggleClass("is-active", this.spreadMode);
    await this.showPage(this.pageIndex, false);
    this.schedulePositionSave();
  }

  private toggleReadingDirection(): void {
    this.readingDirection = this.readingDirection === "ltr" ? "rtl" : "ltr";
    this.pageHost.toggleClass("is-rtl", this.readingDirection === "rtl");
    this.directionButton.toggleClass("is-active", this.readingDirection === "rtl");
    this.schedulePositionSave();
    new Notice(this.readingDirection === "rtl" ? "Modo mangá ativado: direita para esquerda." : "Modo ocidental ativado: esquerda para direita.");
  }

  private async getPageUrl(index: number): Promise<string> {
    if (!this.comic) throw new Error("Quadrinho não está aberto.");
    if (index < 0 || index >= this.comic.pages.length) throw new Error("Página do quadrinho fora do intervalo.");
    const cached = this.pageUrls.get(index) ?? this.comic.pages[index];
    if (cached) { this.pageUrls.set(index, cached); return cached; }
    const loader = this.comic.loadPage;
    if (!loader) throw new Error("Página do quadrinho não encontrada.");
    const currentLoad = this.pageLoads.get(index);
    if (currentLoad) return currentLoad;
    const comic = this.comic;
    const load = loader(index).then((url) => {
      if (this.comic !== comic) { URL.revokeObjectURL(url); throw new Error("O quadrinho foi fechado durante o carregamento."); }
      this.pageUrls.set(index, url);
      return url;
    });
    this.pageLoads.set(index, load);
    try { return await load; }
    finally { if (this.pageLoads.get(index) === load) this.pageLoads.delete(index); }
  }

  private async preloadNearbyPages(): Promise<void> {
    if (!this.comic?.loadPage) return;
    await Promise.allSettled([this.pageIndex - 1, this.pageIndex + 1]
      .filter((index) => index >= 0 && index < this.comic!.pages.length && !this.pageUrls.has(index))
      .map((index) => this.getPageUrl(index)));
  }

  private trimPageCache(): void {
    if (!this.comic?.loadPage) return;
    for (const [index, url] of this.pageUrls) {
      if (Math.abs(index - this.pageIndex) > 2) {
        URL.revokeObjectURL(url);
        this.pageUrls.delete(index);
      }
    }
  }

  private toggleThumbnails(): void {
    this.thumbnailsOpen = !this.thumbnailsOpen;
    this.thumbnailTray.toggleClass("is-open", this.thumbnailsOpen);
    if (this.thumbnailsOpen) void this.renderThumbnails();
  }

  private async renderThumbnails(): Promise<void> {
    if (!this.comic || !this.thumbnailsOpen) return;
    const renderId = ++this.thumbnailRender;
    this.thumbnailGrid.empty();
    const start = Math.max(0, this.pageIndex - 3);
    const end = Math.min(this.comic.pages.length - 1, this.pageIndex + 3);
    for (let index = start; index <= end; index++) {
      try {
        const url = await this.getPageUrl(index);
        if (renderId !== this.thumbnailRender || !this.thumbnailsOpen) return;
        const button = this.thumbnailGrid.createEl("button", {
          cls: index === this.pageIndex ? "flow-comic__thumbnail is-active" : "flow-comic__thumbnail",
          attr: { "aria-label": `Ir para página ${index + 1}`, title: `Página ${index + 1}` }
        });
        button.createEl("img", { attr: { src: url, alt: "" } });
        button.createSpan({ text: `${index + 1}` });
        button.addEventListener("click", (event) => { event.stopPropagation(); void this.showPage(index); });
      } catch {
        // A single broken page must not prevent the rest of the comic from opening.
      }
    }
  }

  private async goToPage(): Promise<void> {
    if (!this.comic) return;
    const answer = window.prompt(`Ir para página (1–${this.comic.pages.length})`, `${this.pageIndex + 1}`);
    if (answer === null) return;
    const page = Number.parseInt(answer, 10);
    if (!Number.isFinite(page) || page < 1 || page > this.comic.pages.length) {
      new Notice(`Digite um número entre 1 e ${this.comic.pages.length}.`);
      return;
    }
    await this.showPage(page - 1);
  }

  private openMarkers(): void {
    if (!this.comic) return;
    new MarkersModal(
      this.app,
      this.plugin.getMarkers(this.comic.id),
      (name) => void this.addMarker(name),
      (marker) => void this.showPage(marker.position.chapterIndex),
      (marker) => void this.plugin.deleteMarker(this.comic!.id, marker.id),
      "Página"
    ).open();
  }

  private async addMarker(name: string): Promise<void> {
    if (!this.comic) return;
    await this.persistPosition();
    const position = this.plugin.getPosition(this.comic.id);
    if (!position) return;
    const marker: BookMarker = {
      id: `marker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      position: { ...position },
      createdAt: new Date().toISOString()
    };
    await this.plugin.saveMarker(this.comic.id, marker);
    new Notice(`Marcador “${name}” adicionado.`);
  }

  private openPageAnnotation(): void {
    if (!this.comic) return;
    const existing = this.plugin.getAnnotations(this.comic.id).find((annotation) => annotation.chapterIndex === this.pageIndex && annotation.quote === `Página ${this.pageIndex + 1}`);
    const annotation: BookAnnotation = existing ?? {
      id: `comic-page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      chapterIndex: this.pageIndex,
      quote: `Página ${this.pageIndex + 1}`,
      startOffset: 0,
      endOffset: 0,
      color: "yellow",
      comment: "",
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    new AnnotationModal(
      this.app,
      annotation,
      (saved) => void this.savePageAnnotation(saved),
      existing ? () => void this.deletePageAnnotation(existing.id) : undefined
    ).open();
  }

  private async savePageAnnotation(annotation: BookAnnotation): Promise<void> {
    if (!this.comic) return;
    await this.plugin.saveAnnotation(this.comic.id, annotation);
    this.renderPageAnnotationState();
    new Notice("Anotação da página salva.");
  }

  private async deletePageAnnotation(annotationId: string): Promise<void> {
    if (!this.comic) return;
    await this.plugin.deleteAnnotation(this.comic.id, annotationId);
    this.renderPageAnnotationState();
    new Notice("Anotação da página removida.");
  }

  private renderPageAnnotationState(): void {
    if (!this.comic || !this.annotationButton) return;
    const hasAnnotation = this.plugin.getAnnotations(this.comic.id).some((annotation) => annotation.chapterIndex === this.pageIndex && annotation.quote === `Página ${this.pageIndex + 1}`);
    this.annotationButton.toggleClass("is-marked", hasAnnotation);
    this.annotationButton.setAttribute("aria-label", hasAnnotation ? "Editar anotação da página" : "Anotar página");
    this.annotationButton.setAttribute("title", hasAnnotation ? "Editar anotação da página (A)" : "Destaque e comentário da página (A)");
  }

  private changeZoom(delta: number): void {
    this.fitMode = "original";
    this.zoom = Math.max(.5, Math.min(4, Number((this.zoom + delta).toFixed(2))));
    this.applyImageFit();
    this.schedulePositionSave();
  }

  private cycleFitMode(): void {
    this.setFitMode(this.fitMode === "page" ? "width" : this.fitMode === "width" ? "original" : "page");
  }

  private setFitMode(mode: "page" | "width" | "original"): void {
    this.fitMode = mode;
    this.zoom = 1;
    this.applyImageFit();
    this.schedulePositionSave();
  }

  private applyImageFit(): void {
    this.pageHost.dataset.fit = this.fitMode;
    [this.image, this.secondaryImage].forEach((image) => {
      image.style.removeProperty("transform");
      image.style.setProperty("zoom", String(this.zoom));
    });
    this.zoomLabel.textContent = this.fitMode === "page" ? "Página" : this.fitMode === "width" ? "Largura" : this.zoom === 1 ? "Original" : `${Math.round(this.zoom * 100)}%`;
  }

  private async toggleFullscreen(): Promise<void> {
    if (!document.fullscreenElement) await this.containerEl.requestFullscreen?.();
    else await document.exitFullscreen?.();
  }

  private isTyping(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointers.set(event.pointerId, { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY });
    this.pageHost.setPointerCapture?.(event.pointerId);
    if (this.pointers.size === 2) this.pinchDistance = this.pointerDistance();
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    const pointer = this.pointers.get(event.pointerId)!;
    this.pointers.set(event.pointerId, { ...pointer, x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const distance = this.pointerDistance();
      if (this.pinchDistance) this.changeZoom((distance - this.pinchDistance) / 180);
      this.pinchDistance = distance;
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const start = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (!start || this.zoom > 1.01 || event.pointerType === "mouse") return;
    const movement = event.clientX - start.startX;
    const verticalMovement = event.clientY - start.startY;
    if (Math.abs(verticalMovement) > 18) this.suppressPageClickUntil = Date.now() + 350;
    if (Math.abs(movement) < 60 || Math.abs(verticalMovement) > Math.abs(movement)) return;
    this.suppressPageClickUntil = Date.now() + 350;
    const direction: -1 | 1 = movement < 0 ? 1 : -1;
    const readingDirection: -1 | 1 = this.readingDirection === "rtl" ? (direction === 1 ? -1 : 1) : direction;
    void this.movePage(readingDirection);
  }

  private pointerDistance(): number {
    const [first, second] = [...this.pointers.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  }

  private async persistPosition(): Promise<void> {
    if (!this.comic) return;
    const ratio = this.comic.pages.length ? (this.pageIndex + 1) / this.comic.pages.length : 0;
    const position: ReadingPosition = {
      chapterIndex: this.pageIndex, progress: ratio, word: `Página ${this.pageIndex + 1}`,
      comicScrollTop: this.pageHost.scrollTop, comicZoom: this.zoom, comicFitMode: this.fitMode,
      comicSpreadMode: this.spreadMode, comicReadingDirection: this.readingDirection,
      updatedAt: new Date().toISOString()
    };
    await this.plugin.setPosition(this.comic.id, position);
  }

  private schedulePositionSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistPosition();
    }, 800);
  }

  private releaseComic(): void {
    this.pageRequest += 1;
    new Set([...(this.comic?.resources ?? []), ...this.pageUrls.values()]).forEach((url) => URL.revokeObjectURL(url));
    this.pageUrls.clear();
    this.pageLoads.clear();
    this.comic = null;
  }
}

import { ItemView, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";
import type LeituraDSPlugin from "./main";
import { parseEpubCatalogEntry } from "./epub-parser";
import { parseCbzCatalogEntry } from "./comic-parser";
import type { ParsedBook } from "./types";

export const LEITURA_DS_LIBRARY_VIEW = "leitura-ds-library";

export class LeituraDSLibraryView extends ItemView {
  private parsed: ParsedBook[] = [];
  private observer: IntersectionObserver | null = null;
  private loadQueue: TFile[] = [];
  private queuedPaths = new Set<string>();
  private hydratedPaths = new Set<string>();
  private activeLoads = 0;
  private generation = 0;
  private filterCards: () => void = () => undefined;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: LeituraDSPlugin) { super(leaf); }
  getViewType(): string { return LEITURA_DS_LIBRARY_VIEW; }
  getDisplayText(): string { return "Minha biblioteca"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> { await this.renderLibrary(); }
  async onClose(): Promise<void> { this.releaseCatalog(); }

  private releaseCatalog(): void {
    this.generation += 1;
    this.observer?.disconnect();
    this.observer = null;
    this.loadQueue = [];
    this.activeLoads = 0;
    this.queuedPaths.clear();
    this.hydratedPaths.clear();
    this.parsed.forEach((book) => book.resources.forEach((url) => URL.revokeObjectURL(url)));
    this.parsed = [];
  }

  private async renderLibrary(): Promise<void> {
    this.releaseCatalog();
    const generation = this.generation;
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("flow-library");
    const header = root.createDiv({ cls: "flow-library__header" });
    const heading = header.createDiv();
    heading.createEl("h2", { text: "Minha biblioteca" });
    heading.createEl("p", { text: "Seus livros aparecem imediatamente; as capas são preparadas conforme entram na tela." });
    const headerActions = header.createDiv({ cls: "flow-library__header-actions" });
    const search = headerActions.createEl("input", { type: "search", cls: "flow-library__search", attr: { placeholder: "Buscar livro ou autor…", "aria-label": "Buscar na biblioteca" } });
    const statusFilter = headerActions.createEl("select", { attr: { "aria-label": "Filtrar livros" } });
    [["all", "Todos"], ["reading", "Em leitura"], ["new", "Não iniciados"], ["finished", "Concluídos"]].forEach(([value, text]) => statusFilter.createEl("option", { value, text }));
    const sort = headerActions.createEl("select", { attr: { "aria-label": "Ordenar livros" } });
    [["recent", "Última leitura"], ["title", "Título"], ["progress", "Progresso"], ["author", "Autor"]].forEach(([value, text]) => sort.createEl("option", { value, text }));
    const shelf = root.createDiv({ cls: "flow-library__shelf", attr: { "aria-live": "polite" } });
    const folder = this.plugin.leituraSettings.libraryFolder.trim().replace(/\/+$/, "");
    const files = this.app.vault.getFiles()
      .filter((file) => ["epub", "cbz", "cbr"].includes(file.extension.toLowerCase()) && (!folder || file.path.startsWith(`${folder}/`)))
      .sort((left, right) => left.basename.localeCompare(right.basename, "pt-BR"));
    if (!files.length) {
      shelf.createDiv({ cls: "flow-library__empty", text: "Adicione arquivos EPUB, CBZ ou CBR ao Vault para montar sua prateleira." });
      return;
    }

    this.parsed = files.map((file) => this.createPlaceholder(file));
    // CBR extraction currently needs the whole archive. Its cover is therefore
    // prepared only when the comic is opened, avoiding a large memory spike in the shelf.
    files.filter((file) => file.extension.toLowerCase() === "cbr").forEach((file) => this.hydratedPaths.add(file.path));

    this.filterCards = (): void => {
      const term = search.value.trim().toLocaleLowerCase("pt-BR");
      shelf.querySelectorAll<HTMLElement>(".flow-library__book").forEach((card) => {
        const hidden = (Boolean(term) && !(card.dataset.search ?? "").includes(term)) || (statusFilter.value !== "all" && card.dataset.status !== statusFilter.value);
        card.toggleClass("is-filtered", hidden);
      });
    };
    const renderCards = (): void => {
      if (generation !== this.generation) return;
      this.observer?.disconnect();
      shelf.empty();
      const sorted = [...this.parsed].sort((left, right) => {
        const leftPosition = this.plugin.getPosition(left.id);
        const rightPosition = this.plugin.getPosition(right.id);
        if (sort.value === "progress") return (rightPosition?.progress ?? 0) - (leftPosition?.progress ?? 0);
        if (sort.value === "author") return left.author.localeCompare(right.author, "pt-BR");
        if (sort.value === "recent") return (rightPosition?.updatedAt ?? "").localeCompare(leftPosition?.updatedAt ?? "");
        return left.title.localeCompare(right.title, "pt-BR");
      });
      sorted.forEach((book, index) => this.renderCard(shelf, book, index));
      this.observeVisibleCards(root, shelf, files, generation);
      this.filterCards();
    };
    renderCards();
    search.addEventListener("input", this.filterCards);
    statusFilter.addEventListener("change", this.filterCards);
    sort.addEventListener("change", renderCards);
  }

  private createPlaceholder(file: TFile): ParsedBook {
    const record = this.plugin.getBookRecordByPath(file.path);
    const extension = file.extension.toLowerCase() as "epub" | "cbz" | "cbr";
    return {
      id: record?.id ?? `pending-${this.pathHash(file.path)}`,
      path: file.path,
      title: record?.title ?? file.basename,
      author: record?.author ?? (extension === "epub" ? "Livro" : "Quadrinho"),
      chapters: (record?.chapters ?? []).map((label, index) => ({ id: `cached-${index}`, href: "", label, html: "" })),
      resources: [],
      format: record?.format ?? extension
    };
  }

  private pathHash(path: string): string {
    let hash = 2166136261;
    for (const character of path) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }

  private observeVisibleCards(root: HTMLElement, shelf: HTMLElement, files: TFile[], generation: number): void {
    const byPath = new Map(files.map((file) => [file.path, file]));
    if (typeof IntersectionObserver === "undefined") {
      files.filter((file) => !this.hydratedPaths.has(file.path)).slice(0, Platform.isMobile ? 4 : 10).forEach((file) => this.enqueueBook(file, shelf, generation));
      return;
    }
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const card = entry.target as HTMLElement;
        this.observer?.unobserve(card);
        const file = byPath.get(card.dataset.path ?? "");
        if (file) this.enqueueBook(file, shelf, generation);
      });
    }, { root, rootMargin: "500px 0px" });
    shelf.querySelectorAll<HTMLElement>(".flow-library__book").forEach((card) => {
      if (!this.hydratedPaths.has(card.dataset.path ?? "")) this.observer?.observe(card);
    });
  }

  private enqueueBook(file: TFile, shelf: HTMLElement, generation: number): void {
    if (generation !== this.generation || this.hydratedPaths.has(file.path) || this.queuedPaths.has(file.path)) return;
    this.queuedPaths.add(file.path);
    this.loadQueue.push(file);
    this.drainBookQueue(shelf, generation);
  }

  private drainBookQueue(shelf: HTMLElement, generation: number): void {
    const maximumWorkers = Platform.isMobile ? 1 : 2;
    while (generation === this.generation && this.activeLoads < maximumWorkers && this.loadQueue.length) {
      const file = this.loadQueue.shift();
      if (!file) return;
      this.activeLoads += 1;
      void this.readBook(file).then((book) => {
        if (generation !== this.generation) {
          book.resources.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        const previousIndex = this.parsed.findIndex((candidate) => candidate.path === file.path);
        if (previousIndex >= 0) {
          this.parsed[previousIndex].resources.forEach((url) => URL.revokeObjectURL(url));
          this.parsed[previousIndex] = book;
        }
        this.hydratedPaths.add(file.path);
        const oldCard = Array.from(shelf.querySelectorAll<HTMLElement>(".flow-library__book")).find((card) => card.dataset.path === file.path);
        if (oldCard) {
          const index = Number(oldCard.dataset.hueIndex ?? previousIndex);
          const nextCard = this.renderCard(shelf, book, Number.isFinite(index) ? index : 0);
          oldCard.replaceWith(nextCard);
          this.filterCards();
        }
      }).finally(() => {
        if (generation !== this.generation) return;
        this.activeLoads -= 1;
        this.queuedPaths.delete(file.path);
        this.drainBookQueue(shelf, generation);
      });
    }
  }

  private async readBook(file: TFile): Promise<ParsedBook> {
    try {
      const binary = await this.app.vault.readBinary(file);
      const extension = file.extension.toLowerCase();
      const book = extension === "cbz" ? await parseCbzCatalogEntry(binary, file.path) : await parseEpubCatalogEntry(binary, file.path);
      await this.plugin.registerBook(book);
      return book;
    } catch (error) {
      console.error("Leitura DS could not add book to library", file.path, error);
      return { ...this.createPlaceholder(file), error: error instanceof Error ? error.message : "Este arquivo não pôde ser preparado." };
    }
  }

  private renderCard(shelf: HTMLElement, book: ParsedBook, index: number): HTMLButtonElement {
    const card = shelf.createEl("button", { cls: "flow-library__book", attr: { "aria-label": `Abrir ${book.title}` } });
    card.dataset.path = book.path;
    card.dataset.hueIndex = String(index);
    card.dataset.search = `${book.title} ${book.author}`.toLocaleLowerCase("pt-BR");
    const cover = card.createDiv({ cls: "flow-library__cover" });
    cover.style.setProperty("--book-hue", String((index * 47 + 214) % 360));
    if (book.coverUrl) cover.createEl("img", { attr: { src: book.coverUrl, alt: `Capa de ${book.title}`, loading: "lazy" } });
    else {
      cover.createDiv({ cls: "flow-library__cover-title", text: book.title });
      cover.createDiv({ cls: "flow-library__cover-author", text: book.author });
    }
    const position = book.error ? undefined : this.plugin.getPosition(book.id);
    const progress = position?.progress ?? 0;
    card.dataset.status = progress >= .995 ? "finished" : progress > 0 ? "reading" : "new";
    const meta = card.createDiv({ cls: "flow-library__meta" });
    meta.createDiv({ cls: "flow-library__book-title", text: book.title });
    meta.createDiv({ cls: "flow-library__author", text: book.author });
    if (book.format === "cbz" || book.format === "cbr") meta.createDiv({ cls: "flow-library__format", text: `Quadrinho · ${book.format.toUpperCase()}` });
    if (book.error) meta.createDiv({ cls: "flow-library__error", text: book.error });
    const progressRow = meta.createDiv({ cls: "flow-library__progress" });
    const track = progressRow.createDiv({ cls: "flow-library__progress-track" });
    track.createDiv({ cls: "flow-library__progress-fill" }).style.width = `${Math.round(progress * 100)}%`;
    progressRow.createSpan({ text: progress > 0 ? `${Math.round(progress * 100)}%` : "Novo" });
    if (position && progress > 0) {
      const chapter = book.chapters[position.chapterIndex]?.label ?? (book.format === "epub" ? `Capítulo ${position.chapterIndex + 1}` : `Página ${position.chapterIndex + 1}`);
      const word = position.word && book.format === "epub" ? ` · ${position.word}` : "";
      meta.createDiv({ cls: "flow-library__continue", text: `Continuar · ${chapter}${word}` });
    }
    card.addEventListener("click", () => {
      if (book.error) { new Notice(book.error); return; }
      const file = this.app.vault.getFileByPath(book.path);
      if (file) void this.plugin.openBook(file);
      else new Notice("Este livro não está mais no Vault.");
    });
    return card;
  }
}

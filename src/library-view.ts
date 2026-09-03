import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type FlowReaderPlugin from "./main";
import { parseEpubCatalogEntry } from "./epub-parser";
import { parseCbrCatalogEntry, parseCbzCatalogEntry } from "./comic-parser";
import type { ParsedBook } from "./types";

export const FLOW_LIBRARY_VIEW = "flow-reader-library";

export class FlowLibraryView extends ItemView {
  private parsed: ParsedBook[] = [];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: FlowReaderPlugin) { super(leaf); }
  getViewType(): string { return FLOW_LIBRARY_VIEW; }
  getDisplayText(): string { return "Minha biblioteca"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> { await this.renderLibrary(); }
  async onClose(): Promise<void> {
    this.parsed.forEach((book) => book.resources.forEach((url) => URL.revokeObjectURL(url)));
    this.parsed = [];
  }

  private async renderLibrary(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("flow-library");
    const header = root.createDiv({ cls: "flow-library__header" });
    const heading = header.createDiv();
    heading.createEl("h2", { text: "Minha biblioteca" });
    heading.createEl("p", { text: "Seus livros, prontos para continuar de onde você parou." });
    const headerActions = header.createDiv({ cls: "flow-library__header-actions" });
    const search = headerActions.createEl("input", { type: "search", cls: "flow-library__search", attr: { placeholder: "Buscar livro ou autor…", "aria-label": "Buscar na biblioteca" } });
    const statusFilter = headerActions.createEl("select", { attr: { "aria-label": "Filtrar livros" } });
    [["all", "Todos"], ["reading", "Em leitura"], ["new", "Não iniciados"], ["finished", "Concluídos"]].forEach(([value, text]) => statusFilter.createEl("option", { value, text }));
    const sort = headerActions.createEl("select", { attr: { "aria-label": "Ordenar livros" } });
    [["recent", "Última leitura"], ["title", "Título"], ["progress", "Progresso"], ["author", "Autor"]].forEach(([value, text]) => sort.createEl("option", { value, text }));
    const shelf = root.createDiv({ cls: "flow-library__shelf" });
    const folder = this.plugin.flowSettings.libraryFolder.trim().replace(/\/+$/, "");
    const files = this.app.vault.getFiles().filter((file) => ["epub", "cbz", "cbr"].includes(file.extension.toLowerCase()) && (!folder || file.path.startsWith(`${folder}/`)));
    if (!files.length) {
      shelf.createDiv({ cls: "flow-library__empty", text: "Adicione arquivos EPUB, CBZ ou CBR ao Vault para montar sua prateleira." });
      return;
    }
    shelf.createDiv({ cls: "flow-library__loading", text: `Organizando ${files.length} livro${files.length === 1 ? "" : "s"}…` });
    // Reading several large archives at the same time can exhaust mobile memory.
    // Two workers keeps the shelf responsive while covers are prepared.
    const books = await this.readBooksGradually(files);
    this.parsed = books.filter((book): book is ParsedBook => Boolean(book));
    shelf.empty();
    const renderCards = (): void => {
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
      filter();
    };
    const filter = (): void => {
      const term = search.value.trim().toLocaleLowerCase("pt-BR");
      shelf.querySelectorAll<HTMLElement>(".flow-library__book").forEach((card) => {
        const hidden = (Boolean(term) && !(card.dataset.search ?? "").includes(term)) || (statusFilter.value !== "all" && card.dataset.status !== statusFilter.value);
        card.toggleClass("is-filtered", hidden);
      });
    };
    renderCards();
    search.addEventListener("input", filter);
    statusFilter.addEventListener("change", filter);
    sort.addEventListener("change", renderCards);
  }

  private async readBook(file: TFile): Promise<ParsedBook | null> {
    try {
      const binary = await this.app.vault.readBinary(file);
      const extension = file.extension.toLowerCase();
      const book = extension === "cbz" ? await parseCbzCatalogEntry(binary, file.path) : extension === "cbr" ? await parseCbrCatalogEntry(binary, file.path, this.plugin.comicRuntimeBaseUrl) : await parseEpubCatalogEntry(binary, file.path);
      await this.plugin.registerBook(book);
      return book;
    } catch (error) {
      console.error("Leitura DS could not add book to library", file.path, error);
      const extension = file.extension.toLowerCase();
      return {
        id: `unavailable-${file.path}`, path: file.path, title: file.basename, author: extension === "cbr" || extension === "cbz" ? "Quadrinho" : "Livro",
        chapters: [], resources: [], format: (extension === "cbr" || extension === "cbz" ? extension : "epub") as "epub" | "cbz" | "cbr",
        error: error instanceof Error ? error.message : "Este arquivo não pôde ser preparado."
      };
    }
  }

  private async readBooksGradually(files: TFile[]): Promise<Array<ParsedBook | null>> {
    const books: Array<ParsedBook | null> = Array(files.length).fill(null);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const index = next++;
        books[index] = await this.readBook(files[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, () => worker()));
    return books;
  }

  private renderCard(shelf: HTMLElement, book: ParsedBook, index: number): void {
    const card = shelf.createEl("button", { cls: "flow-library__book", attr: { "aria-label": `Abrir ${book.title}` } });
    card.dataset.search = `${book.title} ${book.author}`.toLocaleLowerCase("pt-BR");
    const cover = card.createDiv({ cls: "flow-library__cover" });
    cover.style.setProperty("--book-hue", String((index * 47 + 214) % 360));
    if (book.coverUrl) cover.createEl("img", { attr: { src: book.coverUrl, alt: `Capa de ${book.title}` } });
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
    const fill = track.createDiv({ cls: "flow-library__progress-fill" });
    fill.style.width = `${Math.round(progress * 100)}%`;
    progressRow.createSpan({ text: progress > 0 ? `${Math.round(progress * 100)}%` : "Novo" });
    if (position && progress > 0) {
      const chapter = book.chapters[position.chapterIndex]?.label ?? `Capítulo ${position.chapterIndex + 1}`;
      const word = position.word ? ` · ${position.word}` : "";
      meta.createDiv({ cls: "flow-library__continue", text: `Continuar · ${chapter}${word}` });
    }
    card.addEventListener("click", () => {
      if (book.error) { new Notice(book.error); return; }
      const file = this.app.vault.getFileByPath(book.path);
      if (file) void this.plugin.openBook(file);
      else new Notice("Este livro não está mais no Vault.");
    });
  }
}

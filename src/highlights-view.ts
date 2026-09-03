import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type FlowReaderPlugin from "./main";
import { AnnotationModal } from "./annotation-modal";

export const FLOW_HIGHLIGHTS_VIEW = "flow-reader-highlights";

export class FlowHighlightsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: FlowReaderPlugin) { super(leaf); }
  getViewType(): string { return FLOW_HIGHLIGHTS_VIEW; }
  getDisplayText(): string { return "Meus destaques"; }
  getIcon(): string { return "highlighter"; }
  async onOpen(): Promise<void> { this.renderHighlights(); }

  private renderHighlights(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("flow-highlights");
    const header = root.createDiv({ cls: "flow-highlights__header" });
    const heading = header.createDiv();
    heading.createEl("h2", { text: "Meus destaques" });
    heading.createEl("p", { text: "Ideias, trechos e comentários guardados durante a leitura." });
    const headerActions = header.createDiv({ cls: "flow-highlights__header-actions" });
    const search = headerActions.createEl("input", { type: "search", attr: { placeholder: "Buscar nos destaques…", "aria-label": "Buscar nos destaques" } });
    const bookFilter = headerActions.createEl("select", { attr: { "aria-label": "Filtrar por livro" } });
    bookFilter.createEl("option", { text: "Todos os livros", value: "" });
    const colorFilter = headerActions.createEl("select", { attr: { "aria-label": "Filtrar por cor" } });
    colorFilter.createEl("option", { text: "Todas as cores", value: "" });
    [["yellow", "Amarelo"], ["blue", "Azul"], ["red", "Vermelho"], ["purple", "Roxo"], ["green", "Verde"]].forEach(([id, label]) => colorFilter.createEl("option", { text: label, value: id }));
    const tagFilter = headerActions.createEl("select", { attr: { "aria-label": "Filtrar por etiqueta" } });
    tagFilter.createEl("option", { text: "Todas as etiquetas", value: "" });
    const dateFilter = headerActions.createEl("select", { attr: { "aria-label": "Filtrar por período" } });
    [["", "Qualquer data"], ["today", "Hoje"], ["week", "Últimos 7 dias"], ["month", "Últimos 30 dias"]].forEach(([value, text]) => dateFilter.createEl("option", { value, text }));
    const commentsOnly = headerActions.createEl("button", { text: "Com comentário", attr: { "aria-pressed": "false" } });
    const exportButton = headerActions.createEl("button", { text: "Exportar para Markdown", attr: { "aria-label": "Exportar todos os destaques para Markdown" } });
    exportButton.addEventListener("click", () => void this.plugin.exportAllHighlights(true));
    const list = root.createDiv({ cls: "flow-highlights__list" });
    const entries = this.plugin.getAllAnnotations().sort((a, b) => b.annotation.updatedAt.localeCompare(a.annotation.updatedAt));
    [...new Map(entries.map((entry) => [entry.bookId, entry.book?.title ?? "Livro"]))].sort((left, right) => left[1].localeCompare(right[1], "pt-BR")).forEach(([id, title]) => bookFilter.createEl("option", { text: title, value: id }));
    [...new Set(entries.flatMap((entry) => entry.annotation.tags ?? []))].sort((left, right) => left.localeCompare(right, "pt-BR")).forEach((tag) => tagFilter.createEl("option", { text: `#${tag}`, value: tag }));
    if (!entries.length) list.createDiv({ cls: "flow-highlights__empty", text: "Seus próximos destaques aparecerão aqui." });
    entries.forEach(({ book, bookId, annotation }) => {
      const card = list.createDiv({ cls: `flow-highlights__card flow-highlights__card--${annotation.color}`, attr: { role: "button", tabindex: "0" } });
      card.dataset.search = `${book?.title ?? "Livro"} ${annotation.quote} ${annotation.comment} ${(annotation.tags ?? []).join(" ")}`.toLocaleLowerCase("pt-BR");
      card.dataset.book = bookId;
      card.dataset.color = annotation.color;
      card.dataset.comment = annotation.comment ? "true" : "false";
      card.dataset.tags = (annotation.tags ?? []).join("|");
      card.dataset.updated = annotation.updatedAt;
      const top = card.createDiv({ cls: "flow-highlights__top" });
      top.createSpan({ cls: "flow-highlights__book", text: book?.title ?? "Livro" });
      top.createSpan({ cls: "flow-highlights__chapter", text: `Capítulo ${annotation.chapterIndex + 1}` });
      card.createEl("blockquote", { text: annotation.quote });
      if (annotation.comment) card.createDiv({ cls: "flow-highlights__comment", text: annotation.comment });
      if (annotation.tags?.length) {
        const tags = card.createDiv({ cls: "flow-highlights__tags" });
        annotation.tags.forEach((tag) => tags.createSpan({ text: `#${tag}` }));
      }
      const actions = card.createDiv({ cls: "flow-highlights__card-actions" });
      const readButton = actions.createEl("button", { text: "Ir ao trecho", cls: "mod-cta" });
      const noteButton = actions.createEl("button", { text: "Abrir nota" });
      const copyButton = actions.createEl("button", { text: "Copiar" });
      const editButton = actions.createEl("button", { text: "Editar" });
      readButton.addEventListener("click", (event) => { event.stopPropagation(); void this.plugin.openBookById(bookId, annotation.chapterIndex, annotation.id); });
      noteButton.addEventListener("click", (event) => { event.stopPropagation(); void this.plugin.openHighlightsNote(bookId); });
      copyButton.addEventListener("click", (event) => {
        event.stopPropagation();
        const text = annotation.comment ? `“${annotation.quote}”\n\n${annotation.comment}` : annotation.quote;
        void navigator.clipboard.writeText(text).then(() => new Notice("Destaque copiado.")).catch(() => new Notice("Não foi possível copiar este destaque."));
      });
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        new AnnotationModal(this.app, annotation, (next) => { void this.plugin.saveAnnotation(bookId, next).then(() => this.renderHighlights()); }, () => { void this.plugin.deleteAnnotation(bookId, annotation.id).then(() => this.renderHighlights()); }).open();
      });
      card.addEventListener("click", () => void this.plugin.openBookById(bookId, annotation.chapterIndex, annotation.id));
      card.addEventListener("keydown", (event) => { if (event.key === "Enter") void this.plugin.openBookById(bookId, annotation.chapterIndex, annotation.id); });
    });
    let onlyComments = false;
    const filter = (): void => {
      const term = search.value.trim().toLocaleLowerCase("pt-BR");
      const now = Date.now();
      const maxAge = dateFilter.value === "today" ? 24 * 60 * 60 * 1000 : dateFilter.value === "week" ? 7 * 24 * 60 * 60 * 1000 : dateFilter.value === "month" ? 30 * 24 * 60 * 60 * 1000 : Infinity;
      list.querySelectorAll<HTMLElement>(".flow-highlights__card").forEach((card) => {
        const isTooOld = Number.isFinite(maxAge) && now - new Date(card.dataset.updated ?? 0).getTime() > maxAge;
        const hidden = (Boolean(term) && !(card.dataset.search ?? "").includes(term)) || (Boolean(bookFilter.value) && card.dataset.book !== bookFilter.value) || (Boolean(colorFilter.value) && card.dataset.color !== colorFilter.value) || (Boolean(tagFilter.value) && !(card.dataset.tags ?? "").split("|").includes(tagFilter.value)) || isTooOld || (onlyComments && card.dataset.comment !== "true");
        card.toggleClass("is-filtered", hidden);
      });
    };
    search.addEventListener("input", filter);
    bookFilter.addEventListener("change", filter);
    colorFilter.addEventListener("change", filter);
    tagFilter.addEventListener("change", filter);
    dateFilter.addEventListener("change", filter);
    commentsOnly.addEventListener("click", () => { onlyComments = !onlyComments; commentsOnly.toggleClass("is-active", onlyComments); commentsOnly.setAttribute("aria-pressed", String(onlyComments)); filter(); });
  }
}

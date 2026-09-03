import { App, Modal } from "obsidian";
import type { ParsedBook } from "./types";

export class BookSearchModal extends Modal {
  constructor(
    app: App,
    private readonly book: ParsedBook,
    private readonly onChoose: (chapterIndex: number, term: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Pesquisar no livro");
    const input = this.contentEl.createEl("input", {
      type: "search",
      cls: "flow-reader__search-input",
      attr: { placeholder: "Digite uma palavra ou frase…", "aria-label": "Pesquisar no livro" }
    });
    const results = this.contentEl.createDiv({ cls: "flow-reader__search-results" });
    const render = (): void => {
      results.empty();
      const query = input.value.trim().toLocaleLowerCase();
      if (query.length < 2) return;
      let count = 0;
      this.book.chapters.forEach((chapter, chapterIndex) => {
        if (count >= 50) return;
        const document = new DOMParser().parseFromString(chapter.html, "text/html");
        const text = document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const position = text.toLocaleLowerCase().indexOf(query);
        if (position < 0) return;
        count += 1;
        const start = Math.max(0, position - 70);
        const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, position + query.length + 100)}…`;
        const button = results.createEl("button", { cls: "flow-reader__search-result" });
        button.createEl("strong", { text: chapter.label });
        button.createEl("span", { text: excerpt });
        button.addEventListener("click", () => {
          this.close();
          this.onChoose(chapterIndex, input.value.trim());
        });
      });
      if (!count) results.createDiv({ cls: "flow-reader__search-empty", text: "Nenhum resultado." });
    };
    input.addEventListener("input", render);
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

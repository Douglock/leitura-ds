import { App, Modal, Notice } from "obsidian";
import type { BookAnnotation, HighlightColor } from "./types";

const COLORS: HighlightColor[] = ["yellow", "blue", "red", "purple", "green"];
const COLOR_NAMES: Record<HighlightColor, string> = {
  yellow: "amarelo",
  blue: "azul",
  red: "vermelho",
  purple: "roxo",
  green: "verde"
};

export class AnnotationModal extends Modal {
  private selectedColor: HighlightColor;

  constructor(
    app: App,
    private readonly annotation: BookAnnotation,
    private readonly onSave: (annotation: BookAnnotation) => void,
    private readonly onDelete?: () => void
  ) {
    super(app);
    this.selectedColor = annotation.color;
  }

  onOpen(): void {
    this.titleEl.setText(this.onDelete ? "Editar destaque" : "Criar destaque");
    this.contentEl.createEl("blockquote", { cls: "leitura-ds__annotation-quote", text: this.annotation.quote });
    const colors = this.contentEl.createDiv({ cls: "leitura-ds__annotation-colors" });
    const colorButtons = new Map<HighlightColor, HTMLButtonElement>();
    COLORS.forEach((color) => {
      const button = colors.createEl("button", {
        cls: `leitura-ds__color leitura-ds__color--${color}`,
        attr: { "aria-label": `Cor ${COLOR_NAMES[color]}`, title: COLOR_NAMES[color] }
      });
      colorButtons.set(color, button);
      button.addEventListener("click", () => {
        this.selectedColor = color;
        colorButtons.forEach((item, key) => item.toggleClass("is-selected", key === color));
      });
    });
    colorButtons.get(this.selectedColor)?.addClass("is-selected");
    const textarea = this.contentEl.createEl("textarea", {
      cls: "leitura-ds__annotation-comment",
      attr: { placeholder: "Escreva um comentário sobre este trecho…", "aria-label": "Comentário" }
    });
    textarea.value = this.annotation.comment;
    const tags = this.contentEl.createEl("input", {
      cls: "leitura-ds__annotation-tags",
      attr: { placeholder: "Etiquetas separadas por vírgula: ideia, ação", "aria-label": "Etiquetas" }
    });
    tags.value = (this.annotation.tags ?? []).join(", ");
    const actions = this.contentEl.createDiv({ cls: "leitura-ds__annotation-actions" });
    const copy = actions.createEl("button", { text: "Copiar destaque", attr: { "aria-label": "Copiar trecho e comentário" } });
    copy.addEventListener("click", () => void this.copyAnnotation(textarea.value.trim()));
    if (this.onDelete) {
      const remove = actions.createEl("button", { text: "Apagar", cls: "mod-warning" });
      remove.addEventListener("click", () => {
        this.close();
        this.onDelete?.();
      });
    }
    const save = actions.createEl("button", { text: "Salvar destaque", cls: "mod-cta" });
    save.addEventListener("click", () => {
      this.close();
      this.onSave({
        ...this.annotation,
        color: this.selectedColor,
        comment: textarea.value.trim(),
        tags: [...new Set(tags.value.split(",").map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))],
        updatedAt: new Date().toISOString()
      });
    });
    window.setTimeout(() => textarea.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async copyAnnotation(comment: string): Promise<void> {
    const text = comment ? `“${this.annotation.quote}”\n\n${comment}` : this.annotation.quote;
    try {
      await navigator.clipboard.writeText(text);
      new Notice("Destaque copiado.");
    } catch {
      const temporary = document.body.createEl("textarea");
      temporary.value = text;
      temporary.select();
      document.execCommand("copy");
      temporary.remove();
      new Notice("Destaque copiado.");
    }
  }
}

import { App, Modal } from "obsidian";
import type { ReaderAppearance, ReaderFont, ReaderTheme } from "./types";

const THEMES: Array<{ id: ReaderTheme; name: string; colors: [string, string, string] }> = [
  { id: "default", name: "Obsidian", colors: ["var(--background-primary)", "var(--text-normal)", "var(--interactive-accent)"] },
  { id: "paper", name: "Papel", colors: ["#faf7ef", "#2b2925", "#b96b3f"] },
  { id: "sepia", name: "Sépia", colors: ["#f3ead3", "#3e3427", "#9b633c"] },
  { id: "forest", name: "Floresta", colors: ["#e7efe3", "#243426", "#397452"] },
  { id: "midnight", name: "Meia-noite", colors: ["#0d1424", "#dbe7ff", "#668cff"] },
  { id: "dark", name: "Escuro", colors: ["#17181a", "#e8e8e8", "#a978ff"] }
];

const FOCUS_COLORS = ["#ff4d55", "#ef7d32", "#f0b429", "#35a76f", "#3689e6", "#9b65db"];
const DEFAULT_APPEARANCE: ReaderAppearance = {
  theme: "default", focusColor: "#ff4d55", fontSize: 18, fontFamily: "book",
  lineHeight: 1.75, pageWidth: 760, pageMargin: 16, textAlign: "left"
};

export class AppearanceModal extends Modal {
  private settings: ReaderAppearance;

  constructor(app: App, settings: ReaderAppearance, private readonly onApply: (settings: ReaderAppearance) => void) {
    super(app);
    this.settings = { ...settings };
  }

  onOpen(): void {
    this.titleEl.setText("Aparência da leitura");
    this.contentEl.createEl("h3", { text: "Tema" });
    const themeGrid = this.contentEl.createDiv({ cls: "leitura-ds__theme-grid" });
    const themeButtons = new Map<ReaderTheme, HTMLButtonElement>();
    THEMES.forEach((theme) => {
      const button = themeGrid.createEl("button", { cls: "leitura-ds__theme-card", attr: { "aria-label": `Tema ${theme.name}` } });
      button.style.setProperty("--theme-bg", theme.colors[0]);
      button.style.setProperty("--theme-text", theme.colors[1]);
      button.style.setProperty("--theme-accent", theme.colors[2]);
      button.createDiv({ cls: "leitura-ds__theme-preview", text: "Aa" });
      button.createSpan({ text: theme.name });
      themeButtons.set(theme.id, button);
      button.addEventListener("click", () => {
        this.settings.theme = theme.id;
        themeButtons.forEach((item, id) => item.toggleClass("is-selected", id === theme.id));
      });
    });
    themeButtons.get(this.settings.theme)?.addClass("is-selected");

    this.contentEl.createEl("h3", { text: "Cor da palavra em foco" });
    const colorRow = this.contentEl.createDiv({ cls: "leitura-ds__focus-colors" });
    const picker = colorRow.createEl("input", { type: "color", attr: { value: this.settings.focusColor, "aria-label": "Escolher qualquer cor" } });
    picker.value = this.settings.focusColor;
    const presetButtons: HTMLButtonElement[] = [];
    FOCUS_COLORS.forEach((color) => {
      const button = colorRow.createEl("button", { cls: "leitura-ds__focus-color", attr: { "aria-label": `Usar cor ${color}` } });
      button.style.backgroundColor = color;
      presetButtons.push(button);
      button.addEventListener("click", () => {
        this.settings.focusColor = color;
        picker.value = color;
        presetButtons.forEach((item) => item.removeClass("is-selected"));
        button.addClass("is-selected");
      });
      if (color.toLowerCase() === this.settings.focusColor.toLowerCase()) button.addClass("is-selected");
    });
    picker.addEventListener("input", () => {
      this.settings.focusColor = picker.value;
      presetButtons.forEach((item) => item.removeClass("is-selected"));
    });
    this.contentEl.createEl("h3", { text: "Texto e página" });
    const controls = this.contentEl.createDiv({ cls: "leitura-ds__appearance-controls" });
    this.addSelect<ReaderFont>(controls, "Fonte", this.settings.fontFamily, [
      ["book", "Fonte do livro"], ["serif", "Serifada"], ["sans", "Sem serifa"], ["system", "Sistema"]
    ], (value) => { this.settings.fontFamily = value; });
    this.addRange(controls, "Tamanho", this.settings.fontSize, 12, 40, 1, "px", (value) => { this.settings.fontSize = value; });
    this.addRange(controls, "Espaçamento", this.settings.lineHeight, 1.2, 2.4, .05, "×", (value) => { this.settings.lineHeight = value; });
    this.addRange(controls, "Largura da página", this.settings.pageWidth, 480, 1200, 20, "px", (value) => { this.settings.pageWidth = value; });
    this.addRange(controls, "Margens laterais", this.settings.pageMargin, 8, 96, 2, "px", (value) => { this.settings.pageMargin = value; });
    this.addSelect<"left" | "justify">(controls, "Alinhamento", this.settings.textAlign, [
      ["left", "À esquerda"], ["justify", "Justificado"]
    ], (value) => { this.settings.textAlign = value; });

    const actions = this.contentEl.createDiv({ cls: "leitura-ds__appearance-actions" });
    const reset = actions.createEl("button", { text: "Restaurar padrão" });
    reset.addEventListener("click", () => { this.onApply({ ...DEFAULT_APPEARANCE }); this.close(); });
    const apply = actions.createEl("button", { text: "Aplicar", cls: "mod-cta" });
    apply.addEventListener("click", () => { this.onApply({ ...this.settings }); this.close(); });
  }

  onClose(): void { this.contentEl.empty(); }

  private addRange(parent: HTMLElement, label: string, value: number, min: number, max: number, step: number, suffix: string, onChange: (value: number) => void): void {
    const row = parent.createDiv({ cls: "leitura-ds__appearance-row" });
    row.createSpan({ text: label });
    const input = row.createEl("input", { type: "range", attr: { min: String(min), max: String(max), step: String(step), value: String(value), "aria-label": label } });
    const output = row.createEl("output", { text: `${value}${suffix}` });
    input.addEventListener("input", () => { const next = Number(input.value); output.textContent = `${next}${suffix}`; onChange(next); });
  }

  private addSelect<T extends string>(parent: HTMLElement, label: string, value: T, options: Array<[T, string]>, onChange: (value: T) => void): void {
    const row = parent.createDiv({ cls: "leitura-ds__appearance-row" });
    row.createSpan({ text: label });
    const select = row.createEl("select", { attr: { "aria-label": label } });
    options.forEach(([id, name]) => { const option = select.createEl("option", { text: name, value: id }); option.selected = id === value; });
    select.addEventListener("change", () => onChange(select.value as T));
  }
}

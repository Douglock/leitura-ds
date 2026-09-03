import { ItemView, WorkspaceLeaf } from "obsidian";
import type LeituraDSPlugin from "./main";

export const LEITURA_DS_STATS_VIEW = "leitura-ds-stats";

export class LeituraDSStatsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: LeituraDSPlugin) { super(leaf); }
  getViewType(): string { return LEITURA_DS_STATS_VIEW; }
  getDisplayText(): string { return "Estatísticas de leitura"; }
  getIcon(): string { return "chart-no-axes-combined"; }
  async onOpen(): Promise<void> { this.renderStats(); }

  private renderStats(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("flow-stats");
    root.createEl("h2", { text: "Estatísticas de leitura" });
    root.createEl("p", { text: "Seu ritmo de leitura, sem pressão." });
    const days = this.plugin.readingStats.days;
    const today = new Date();
    const dates = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - offset));
      return date.toISOString().slice(0, 10);
    });
    const weekSeconds = dates.reduce((total, date) => total + (days[date]?.seconds ?? 0), 0);
    const totalSeconds = Object.values(days).reduce((total, day) => total + day.seconds, 0);
    const streak = this.getStreak(days, today);
    const todaySeconds = days[today.toISOString().slice(0, 10)]?.seconds ?? 0;
    const goalSeconds = this.plugin.leituraSettings.dailyGoalMinutes * 60;
    const cards = root.createDiv({ cls: "flow-stats__summary" });
    this.metric(cards, this.formatDuration(weekSeconds), "Nesta semana");
    this.metric(cards, `${streak} ${streak === 1 ? "dia" : "dias"}`, "Sequência atual");
    this.metric(cards, this.formatDuration(totalSeconds), "Total registrado");
    this.metric(cards, `${Math.min(100, Math.round((todaySeconds / Math.max(1, goalSeconds)) * 100))}%`, `Meta de hoje · ${this.plugin.leituraSettings.dailyGoalMinutes} min`);
    const chartSection = root.createDiv({ cls: "flow-stats__section" });
    chartSection.createEl("h3", { text: "Últimos 7 dias" });
    const maximum = Math.max(60, ...dates.map((date) => days[date]?.seconds ?? 0));
    const chart = chartSection.createDiv({ cls: "flow-stats__chart", attr: { role: "img", "aria-label": "Tempo de leitura dos últimos sete dias" } });
    dates.forEach((date) => {
      const seconds = days[date]?.seconds ?? 0;
      const column = chart.createDiv({ cls: "flow-stats__day", attr: { title: `${this.labelDate(date)}: ${this.formatDuration(seconds)}` } });
      const bar = column.createDiv({ cls: "flow-stats__bar" });
      bar.style.height = `${Math.max(seconds ? 8 : 2, (seconds / maximum) * 100)}%`;
      column.createSpan({ text: this.labelDate(date, true) });
    });
    const recent = root.createDiv({ cls: "flow-stats__section" });
    recent.createEl("h3", { text: "Livros em andamento" });
    const activeBooks = Object.entries(this.plugin.readingStats.days)
      .sort(([left], [right]) => right.localeCompare(left))
      .flatMap(([, day]) => day.books)
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, 5);
    if (!activeBooks.length) recent.createDiv({ cls: "flow-stats__empty", text: "Leia alguns minutos para começar a ver seus dados aqui." });
    activeBooks.forEach((bookId) => {
      const book = this.plugin.getBookRecord(bookId);
      const position = this.plugin.getPosition(bookId);
      const row = recent.createDiv({ cls: "flow-stats__book" });
      row.createSpan({ text: book?.title ?? "Livro" });
      row.createSpan({ text: position ? `${Math.round(position.progress * 100)}%` : "Em leitura" });
    });
  }

  private metric(parent: HTMLElement, value: string, label: string): void {
    const card = parent.createDiv({ cls: "flow-stats__metric" });
    card.createDiv({ cls: "flow-stats__value", text: value });
    card.createDiv({ cls: "flow-stats__label", text: label });
  }

  private getStreak(days: Record<string, { seconds: number }>, from: Date): number {
    let streak = 0;
    const cursor = new Date(from);
    while ((days[cursor.toISOString().slice(0, 10)]?.seconds ?? 0) > 0) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
    return streak;
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
  }

  private labelDate(date: string, short = false): string {
    return new Intl.DateTimeFormat("pt-BR", short ? { weekday: "narrow" } : { weekday: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`));
  }
}

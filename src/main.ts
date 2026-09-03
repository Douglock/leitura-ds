import { normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { FLOW_READER_VIEW, FlowReaderView } from "./reader-view";
import { FLOW_LIBRARY_VIEW, FlowLibraryView } from "./library-view";
import { FLOW_HIGHLIGHTS_VIEW, FlowHighlightsView } from "./highlights-view";
import { FLOW_STATS_VIEW, FlowStatsView } from "./stats-view";
import { FLOW_COMIC_VIEW, FlowComicView } from "./comic-view";
import type { BookAnnotation, BookMarker, BookRecord, ComicBook, FlowReaderData, FlowReaderSharedState, ParsedBook, ReadingPosition, ReadingStats } from "./types";
import type { FlowReaderSettings } from "./types";
import { FlowReaderSettingTab } from "./settings-tab";

const DEFAULT_SETTINGS: FlowReaderSettings = {
  baseFolder: "99 - SISTEMAS/Leitura DS", libraryFolder: "", exportFolder: "99 - SISTEMAS/Leitura DS/Destaques",
  defaultTheme: "default", defaultFontSize: 18, defaultFocusColor: "#ff4d55",
  fastWordsPerMinute: 300, fastFontSize: 56, focusWordsPerMinute: 240, automaticBackups: true, swipeNavigation: true, dailyGoalMinutes: 20, voiceRate: 1, defaultSocialMode: "normal"
};
const DEFAULT_DATA: FlowReaderData = { positions: {}, referencePoints: {}, annotations: {}, books: {}, markers: {}, annotationTombstones: {}, readingStats: { days: {} }, settings: DEFAULT_SETTINGS };

export default class FlowReaderPlugin extends Plugin {
  private data: FlowReaderData = DEFAULT_DATA;
  private writingSharedState = false;
  private lastSharedSaveAt = "";

  async onload(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<FlowReaderData> | null;
    this.data = { ...DEFAULT_DATA, ...loaded, settings: { ...DEFAULT_SETTINGS, ...(loaded?.settings ?? {}) } };
    await this.loadSharedReadingState();
    this.addSettingTab(new FlowReaderSettingTab(this.app, this));
    this.registerView(FLOW_READER_VIEW, (leaf) => new FlowReaderView(leaf, this));
    this.registerView(FLOW_LIBRARY_VIEW, (leaf) => new FlowLibraryView(leaf, this));
    this.registerView(FLOW_HIGHLIGHTS_VIEW, (leaf) => new FlowHighlightsView(leaf, this));
    this.registerView(FLOW_STATS_VIEW, (leaf) => new FlowStatsView(leaf, this));
    this.registerView(FLOW_COMIC_VIEW, (leaf) => new FlowComicView(leaf, this));
    this.registerExtensions(["epub"], FLOW_READER_VIEW);
    this.registerExtensions(["cbz", "cbr"], FLOW_COMIC_VIEW);
    this.addRibbonIcon("book-open", "Abrir Leitura DS", () => void this.openFirstBook());
    this.addRibbonIcon("library", "Minha biblioteca", () => void this.openLibrary());
    this.addCommand({
      id: "open-flow-reader",
      name: "Abrir leitor EPUB",
      callback: () => void this.openFirstBook()
    });
    this.addCommand({ id: "open-flow-library", name: "Abrir minha biblioteca", callback: () => void this.openLibrary() });
    this.addCommand({ id: "open-flow-highlights", name: "Abrir meus destaques", callback: () => void this.openHighlights() });
    this.addCommand({ id: "open-flow-stats", name: "Abrir estatísticas de leitura", callback: () => void this.openStats() });
    this.addCommand({ id: "continue-flow-reading", name: "Continuar última leitura", callback: () => void this.continueLastReading() });
    this.addCommand({ id: "export-flow-highlights", name: "Exportar destaques para Markdown", callback: () => void this.exportAllHighlights(true) });
    this.registerObsidianProtocolHandler("flow-reader", (params) => {
      const chapter = Number(params.chapter ?? "0");
      void this.openBookById(params.book ?? "", Number.isFinite(chapter) ? chapter : 0, params.annotation);
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!this.writingSharedState && file.path === this.getSharedStatePath()) void this.loadSharedReadingState();
    }));
    void this.exportAllHighlights();
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(FLOW_READER_VIEW);
  }

  getPosition(bookId: string): ReadingPosition | undefined {
    return this.data.positions[bookId];
  }

  getBookRecord(bookId: string): BookRecord | undefined {
    return this.data.books?.[bookId];
  }

  get readingStats(): ReadingStats {
    this.data.readingStats ??= { days: {} };
    return this.data.readingStats;
  }

  async recordReadingSeconds(bookId: string, seconds: number): Promise<void> {
    const safeSeconds = Math.round(Math.max(0, Math.min(seconds, 120)));
    if (!safeSeconds) return;
    const today = new Date().toISOString().slice(0, 10);
    const day = this.readingStats.days[today] ?? { seconds: 0, books: [] };
    day.seconds += safeSeconds;
    if (!day.books.includes(bookId)) day.books.push(bookId);
    this.readingStats.days[today] = day;
    this.readingStats.lastReadAt = new Date().toISOString();
    await this.saveData(this.data);
  }

  get flowSettings(): FlowReaderSettings { this.data.settings ??= { ...DEFAULT_SETTINGS }; return this.data.settings; }
  get comicRuntimeBaseUrl(): string { return this.app.vault.adapter.getResourcePath(`${this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`}/assets/`); }
  get sharedSaveTime(): string { return this.lastSharedSaveAt; }
  get syncDiagnostics(): { statePath: string; lastSavedAt: string; books: number; positions: number; highlights: number; backupFolder: string } {
    return {
      statePath: this.getSharedStatePath(), lastSavedAt: this.lastSharedSaveAt, books: Object.keys(this.data.books ?? {}).length,
      positions: Object.keys(this.data.positions).length, highlights: Object.values(this.data.annotations ?? {}).reduce((total, items) => total + items.length, 0),
      backupFolder: this.getSharedBackupFolder()
    };
  }
  async saveSettings(): Promise<void> { await this.saveData(this.data); }
  async resetSettings(): Promise<void> { this.data.settings = { ...DEFAULT_SETTINGS }; await this.saveData(this.data); }
  getVaultFolders(): string[] { return this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder).map((folder) => folder.path).sort(); }

  async setPosition(bookId: string, position: ReadingPosition): Promise<void> {
    this.data.positions[bookId] = position;
    await this.saveData(this.data);
    await this.saveSharedReadingState();
  }

  private getSharedStatePath(): string {
    const folder = this.flowSettings.baseFolder.trim() || "Leitura DS";
    return normalizePath(`${folder}/Leitura DS — Estado.json`);
  }

  /** Reads the previous filename once so an update never loses a synced reading point. */
  private getLegacySharedStatePath(): string {
    const folder = this.flowSettings.baseFolder.trim() || "Flow Reader";
    return normalizePath(`${folder}/Flow Reader — Estado.json`);
  }

  private getSharedBackupFolder(): string {
    const folder = this.flowSettings.baseFolder.trim() || "Leitura DS";
    return normalizePath(`${folder}/Backups`);
  }

  async createSharedStateBackup(): Promise<TFile | undefined> {
    const source = this.app.vault.getAbstractFileByPath(this.getSharedStatePath());
    if (!(source instanceof TFile)) return undefined;
    const folder = this.getSharedBackupFolder();
    await this.ensureFolder(folder);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = normalizePath(`${folder}/Leitura DS — Estado — ${stamp}.json`);
    return this.app.vault.create(path, await this.app.vault.read(source));
  }

  async openSharedStateFile(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.getSharedStatePath())
      ?? this.app.vault.getAbstractFileByPath(this.getLegacySharedStatePath());
    if (!(file instanceof TFile)) { new Notice("Ainda não há um estado de leitura salvo no Vault."); return; }
    await this.openMarkdownFile(file);
  }

  private async createDailyStateBackup(source: TFile): Promise<void> {
    if (!this.flowSettings.automaticBackups) return;
    const folder = this.getSharedBackupFolder();
    await this.ensureFolder(folder);
    const date = new Date().toISOString().slice(0, 10);
    const path = normalizePath(`${folder}/Leitura DS — Estado — ${date}.json`);
    if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.create(path, await this.app.vault.read(source));
  }

  private newerPosition(left: ReadingPosition | undefined, right: ReadingPosition | undefined): ReadingPosition | undefined {
    if (!left) return right;
    if (!right) return left;
    return new Date(left.updatedAt).getTime() >= new Date(right.updatedAt).getTime() ? left : right;
  }

  private mergePositions(remote: Record<string, ReadingPosition>): void {
    const ids = new Set([...Object.keys(this.data.positions), ...Object.keys(remote)]);
    const merged: Record<string, ReadingPosition> = {};
    ids.forEach((id) => {
      const latest = this.newerPosition(this.data.positions[id], remote[id]);
      if (latest) merged[id] = latest;
    });
    this.data.positions = merged;
  }

  private mergeAnnotations(remote: Record<string, BookAnnotation[]>, remoteTombstones: Record<string, string>): void {
    this.data.annotations ??= {};
    this.data.annotationTombstones ??= {};
    Object.entries(remoteTombstones).forEach(([key, deletedAt]) => {
      const local = this.data.annotationTombstones?.[key];
      if (!local || new Date(deletedAt).getTime() > new Date(local).getTime()) this.data.annotationTombstones![key] = deletedAt;
    });
    const bookIds = new Set([...Object.keys(this.data.annotations), ...Object.keys(remote)]);
    bookIds.forEach((bookId) => {
      const byId = new Map<string, BookAnnotation>();
      [...(this.data.annotations?.[bookId] ?? []), ...(remote[bookId] ?? [])].forEach((annotation) => {
        const current = byId.get(annotation.id);
        if (!current || new Date(annotation.updatedAt).getTime() > new Date(current.updatedAt).getTime()) byId.set(annotation.id, annotation);
      });
      this.data.annotations![bookId] = [...byId.values()].filter((annotation) => {
        const deletedAt = this.data.annotationTombstones?.[`${bookId}:${annotation.id}`];
        return !deletedAt || new Date(annotation.updatedAt).getTime() > new Date(deletedAt).getTime();
      });
    });
  }

  private mergeBooks(remote: Record<string, BookRecord>): void {
    this.data.books ??= {};
    Object.entries(remote).forEach(([id, book]) => { if (!this.data.books?.[id]) this.data.books![id] = book; });
  }

  private async readSharedReadingState(): Promise<FlowReaderSharedState | undefined> {
    const file = this.app.vault.getAbstractFileByPath(this.getSharedStatePath());
    if (!(file instanceof TFile)) return undefined;
    try {
      const parsed = JSON.parse(await this.app.vault.read(file)) as Partial<FlowReaderSharedState>;
      if (!parsed.positions || typeof parsed.positions !== "object") return undefined;
      return {
        version: 1, updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "", positions: parsed.positions,
        annotations: parsed.annotations && typeof parsed.annotations === "object" ? parsed.annotations : {},
        books: parsed.books && typeof parsed.books === "object" ? parsed.books : {},
        annotationTombstones: parsed.annotationTombstones && typeof parsed.annotationTombstones === "object" ? parsed.annotationTombstones : {}
      };
    } catch {
      new Notice("Leitura DS: não foi possível ler o estado sincronizado.");
      return undefined;
    }
  }

  private async loadSharedReadingState(): Promise<void> {
    const remote = await this.readSharedReadingState();
    if (!remote) return;
    this.lastSharedSaveAt = remote.updatedAt;
    this.mergePositions(remote.positions);
    this.mergeBooks(remote.books);
    this.mergeAnnotations(remote.annotations, remote.annotationTombstones);
    await this.saveData(this.data);
  }

  private async saveSharedReadingState(): Promise<void> {
    const folder = normalizePath(this.flowSettings.baseFolder.trim() || "Leitura DS");
    await this.ensureFolder(folder);
    const path = this.getSharedStatePath();
    const existing = this.app.vault.getAbstractFileByPath(path);
    const remote = await this.readSharedReadingState();
    if (remote) {
      this.mergePositions(remote.positions);
      this.mergeBooks(remote.books);
      this.mergeAnnotations(remote.annotations, remote.annotationTombstones);
    }
    const state: FlowReaderSharedState = {
      version: 1, updatedAt: new Date().toISOString(), positions: this.data.positions,
      annotations: this.data.annotations ?? {}, books: this.data.books ?? {}, annotationTombstones: this.data.annotationTombstones ?? {}
    };
    const content = JSON.stringify(state, null, 2);
    this.writingSharedState = true;
    try {
      if (existing instanceof TFile) {
        await this.createDailyStateBackup(existing);
        await this.app.vault.modify(existing, content);
      }
      else await this.app.vault.create(path, content);
      this.lastSharedSaveAt = state.updatedAt;
    } finally {
      this.writingSharedState = false;
    }
    await this.saveData(this.data);
  }

  getReferencePoint(bookId: string): ReadingPosition | undefined {
    return this.data.referencePoints?.[bookId];
  }

  async setReferencePoint(bookId: string, position: ReadingPosition): Promise<void> {
    this.data.referencePoints ??= {};
    this.data.referencePoints[bookId] = position;
    await this.saveData(this.data);
  }

  getMarkers(bookId: string): BookMarker[] { return this.data.markers?.[bookId] ?? []; }

  async saveMarker(bookId: string, marker: BookMarker): Promise<void> {
    this.data.markers ??= {};
    this.data.markers[bookId] = [...(this.data.markers[bookId] ?? []), marker];
    await this.saveData(this.data);
  }

  async deleteMarker(bookId: string, markerId: string): Promise<void> {
    this.data.markers ??= {};
    this.data.markers[bookId] = (this.data.markers[bookId] ?? []).filter((marker) => marker.id !== markerId);
    await this.saveData(this.data);
  }

  getAnnotations(bookId: string): BookAnnotation[] {
    return this.data.annotations?.[bookId] ?? [];
  }

  getAllAnnotations(): Array<{ bookId: string; book: BookRecord | undefined; annotation: BookAnnotation }> {
    return Object.entries(this.data.annotations ?? {}).flatMap(([bookId, annotations]) =>
      annotations.map((annotation) => ({ bookId, book: this.data.books?.[bookId], annotation }))
    );
  }

  async registerBook(book: ParsedBook | ComicBook): Promise<void> {
    this.data.books ??= {};
    const next = { id: book.id, path: book.path, title: book.title, author: book.author, chapters: book.chapters.map((chapter) => chapter.label), format: book.format ?? "epub" };
    const current = this.data.books[book.id];
    if (current && current.path === next.path && current.title === next.title && current.author === next.author && current.format === next.format && JSON.stringify(current.chapters) === JSON.stringify(next.chapters)) return;
    this.data.books[book.id] = next;
    await this.saveData(this.data);
    await this.saveSharedReadingState();
  }

  async migrateBookState(previousId: string, nextId: string): Promise<void> {
    if (!previousId || previousId === nextId) return;
    const previous = this.data.books?.[previousId];
    if (!previous) return;
    const previousPosition = this.data.positions[previousId];
    const nextPosition = this.data.positions[nextId];
    if (previousPosition && (!nextPosition || new Date(previousPosition.updatedAt).getTime() > new Date(nextPosition.updatedAt).getTime())) this.data.positions[nextId] = previousPosition;
    if (this.data.annotations?.[previousId]?.length) this.data.annotations[nextId] = [...(this.data.annotations[nextId] ?? []), ...this.data.annotations[previousId]].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
    if (this.data.markers?.[previousId]?.length) this.data.markers![nextId] = [...(this.data.markers[nextId] ?? []), ...this.data.markers[previousId]];
    if (this.data.referencePoints?.[previousId]) this.data.referencePoints![nextId] = this.data.referencePoints[previousId];
    delete this.data.positions[previousId];
    delete this.data.annotations?.[previousId];
    delete this.data.markers?.[previousId];
    delete this.data.referencePoints?.[previousId];
    delete this.data.books?.[previousId];
    await this.saveData(this.data);
    await this.saveSharedReadingState();
  }

  async saveAnnotation(bookId: string, annotation: BookAnnotation): Promise<void> {
    this.data.annotations ??= {};
    const annotations = this.data.annotations[bookId] ?? [];
    const index = annotations.findIndex((item) => item.id === annotation.id);
    if (index >= 0) annotations[index] = annotation;
    else annotations.push(annotation);
    this.data.annotations[bookId] = annotations;
    await this.saveData(this.data);
    await this.saveSharedReadingState();
    await this.exportBookHighlights(bookId);
  }

  async deleteAnnotation(bookId: string, annotationId: string): Promise<void> {
    this.data.annotations ??= {};
    this.data.annotationTombstones ??= {};
    this.data.annotations[bookId] = (this.data.annotations[bookId] ?? []).filter((item) => item.id !== annotationId);
    this.data.annotationTombstones[`${bookId}:${annotationId}`] = new Date().toISOString();
    await this.saveData(this.data);
    await this.saveSharedReadingState();
    await this.exportBookHighlights(bookId);
  }

  async exportAllHighlights(showNotice = false): Promise<void> {
    const bookIds = Object.keys(this.data.annotations ?? {});
    const files = (await Promise.all(bookIds.map((bookId) => this.exportBookHighlights(bookId)))).filter((file): file is TFile => Boolean(file));
    if (showNotice) {
      if (files[0]) {
        await this.openMarkdownFile(files[0]);
        new Notice(`Nota atualizada e aberta: ${files[0].path}`);
      } else new Notice("Nenhuma nota de destaques para exportar.");
    }
  }

  private async exportBookHighlights(bookId: string): Promise<TFile | undefined> {
    const book = this.data.books?.[bookId];
    if (!book) return undefined;
    const folder = normalizePath(this.flowSettings.exportFolder.trim() || DEFAULT_SETTINGS.exportFolder);
    await this.ensureFolder(folder);
    const safeTitle = this.safeFileName(book.title) || "Livro";
    const sameTitleBooks = Object.values(this.data.books ?? {}).filter((candidate) => candidate.title.trim().toLocaleLowerCase("pt-BR") === book.title.trim().toLocaleLowerCase("pt-BR"))
      .sort((left, right) => left.id.localeCompare(right.id));
    const duplicateIndex = sameTitleBooks.findIndex((candidate) => candidate.id === bookId);
    const suffix = duplicateIndex > 0 ? ` — ${this.safeFileName(book.author) || "Autor desconhecido"} — ${bookId.replace(/^book-/, "").slice(0, 6)}` : "";
    const path = normalizePath(`${folder}/${safeTitle}${suffix} — Destaques.md`);
    const annotations = [...this.getAnnotations(bookId)].sort((a, b) => a.chapterIndex - b.chapterIndex || a.startOffset - b.startOffset);
    const lines = [
      "---", `title: ${JSON.stringify(`${book.title} — Destaques`)}`, `book: ${JSON.stringify(book.title)}`,
      `author: ${JSON.stringify(book.author)}`, `epub: ${JSON.stringify(book.path)}`, `flow_reader_id: ${bookId}`,
      `updated: ${new Date().toISOString()}`, "tags:", "  - flow-reader", "  - destaque", "---", "",
      `# ${book.title}`, "", `**Autor:** ${book.author}`, `**Destaques:** ${annotations.length}`, ""
    ];
    if (!annotations.length) lines.push("> Nenhum destaque salvo neste livro.", "");
    let currentChapter = -1;
    annotations.forEach((annotation) => {
      if (annotation.chapterIndex !== currentChapter) {
        currentChapter = annotation.chapterIndex;
        lines.push(`## ${book.chapters?.[currentChapter] ?? `Capítulo ${currentChapter + 1}`}`, "");
      }
      const link = `obsidian://flow-reader?book=${encodeURIComponent(bookId)}&chapter=${annotation.chapterIndex}&annotation=${encodeURIComponent(annotation.id)}`;
      lines.push(`<!-- flow-reader:annotation=${annotation.id} -->`);
      lines.push(`> [!quote] Destaque · ${this.colorName(annotation.color)}`);
      annotation.quote.split(/\r?\n/).forEach((part) => lines.push(`> ${part}`));
      if (annotation.comment) lines.push(">", `> **Comentário:** ${annotation.comment.replace(/\n/g, " ")}`);
      if (annotation.tags?.length) lines.push(">", `> **Etiquetas:** ${annotation.tags.map((tag) => `#${tag.replace(/\s+/g, "-")}`).join(" ")}`);
      lines.push(">", `> [Abrir no Leitura DS](${link})`, "");
    });
    const content = lines.join("\n");
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) { await this.app.vault.modify(existing, content); return existing; }
    return this.app.vault.create(path, content);
  }

  async openHighlightsNote(bookId: string): Promise<void> {
    const file = await this.exportBookHighlights(bookId);
    if (!file) { new Notice("Nota de destaques não encontrada."); return; }
    await this.openMarkdownFile(file);
  }

  async importHighlightsFromMarkdown(): Promise<void> {
    const folder = normalizePath(this.flowSettings.exportFolder.trim() || DEFAULT_SETTINGS.exportFolder);
    const files = this.app.vault.getFiles().filter((file) => file.extension === "md" && (file.path === folder || file.path.startsWith(`${folder}/`)));
    const changedBooks = new Set<string>();
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const bookId = content.match(/^flow_reader_id:\s*(.+)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
      if (!bookId || !this.data.annotations?.[bookId]) continue;
      const blocks = [...content.matchAll(/<!--\s*flow-reader:annotation=([^\s]+)\s*-->([\s\S]*?)(?=<!--\s*flow-reader:annotation=|$)/g)];
      blocks.forEach((block) => {
        const id = block[1];
        const source = block[2] ?? "";
        const annotation = this.data.annotations?.[bookId]?.find((item) => item.id === id);
        if (!annotation) return;
        const comment = source.match(/> \*\*Comentário:\*\*\s*(.*)/)?.[1]?.trim() ?? annotation.comment;
        const tagLine = source.match(/> \*\*Etiquetas:\*\*\s*(.*)/)?.[1] ?? "";
        const tags = tagLine ? [...new Set([...tagLine.matchAll(/#([^\s#]+)/g)].map((match) => match[1].replace(/-/g, " ")))] : annotation.tags ?? [];
        if (comment !== annotation.comment || JSON.stringify(tags) !== JSON.stringify(annotation.tags ?? [])) {
          annotation.comment = comment;
          annotation.tags = tags;
          annotation.updatedAt = new Date().toISOString();
          changedBooks.add(bookId);
        }
      });
    }
    if (!changedBooks.size) { new Notice("Nenhuma alteração nova foi encontrada nas notas Markdown."); return; }
    await this.saveData(this.data);
    await this.saveSharedReadingState();
    await Promise.all([...changedBooks].map((bookId) => this.exportBookHighlights(bookId)));
    new Notice(`${changedBooks.size} ${changedBooks.size === 1 ? "livro atualizado" : "livros atualizados"} a partir das notas Markdown.`);
  }

  private async openMarkdownFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private colorName(color: string): string {
    return ({ yellow: "amarelo", blue: "azul", red: "vermelho", purple: "roxo", green: "verde" } as Record<string, string>)[color] ?? color;
  }

  private safeFileName(value: string): string {
    return value.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim();
  }

  private async openFirstBook(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const folder = this.flowSettings.libraryFolder.trim().replace(/\/+$/, "");
    const file = active && ["epub", "cbz", "cbr"].includes(active.extension.toLowerCase()) ? active : this.app.vault.getFiles().find((candidate) => ["epub", "cbz", "cbr"].includes(candidate.extension.toLowerCase()) && (!folder || candidate.path.startsWith(`${folder}/`)));
    if (!file) {
      new Notice("Adicione um arquivo EPUB, CBZ ou CBR ao Vault para começar.");
      return;
    }
    await this.openBook(file);
  }

  async openBook(file: TFile, chapterIndex?: number, annotationId?: string, legacyBookId?: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    const isComic = ["cbz", "cbr"].includes(file.extension.toLowerCase());
    await leaf.setViewState({ type: isComic ? FLOW_COMIC_VIEW : FLOW_READER_VIEW, active: true, state: isComic ? { file: file.path, pageIndex: chapterIndex, legacyBookId } : { file: file.path, chapterIndex, annotationId, legacyBookId } });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openBookById(bookId: string, chapterIndex?: number, annotationId?: string): Promise<void> {
    const record = this.data.books?.[bookId];
    const path = record?.path;
    let file = path ? this.app.vault.getFileByPath(path) : null;
    if (!file && record) {
      const originalName = path?.split("/").pop()?.toLocaleLowerCase("pt-BR");
      const candidates = this.app.vault.getFiles().filter((candidate) => ["epub", "cbz", "cbr"].includes(candidate.extension.toLowerCase()) && (candidate.name.toLocaleLowerCase("pt-BR") === originalName || candidate.basename.toLocaleLowerCase("pt-BR") === record.title.toLocaleLowerCase("pt-BR")));
      if (candidates.length === 1) {
        file = candidates[0]; record.path = file.path;
        await this.saveData(this.data); await this.saveSharedReadingState();
        new Notice(`Livro reconectado: ${file.path}`);
      }
    }
    if (!file) { new Notice("Livro do destaque não encontrado no Vault."); return; }
    await this.openBook(file, chapterIndex, annotationId, bookId);
  }

  async continueLastReading(): Promise<void> {
    const [bookId] = Object.entries(this.data.positions)
      .sort(([, left], [, right]) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0] ?? [];
    if (!bookId) { new Notice("Ainda não há uma leitura salva."); return; }
    await this.openBookById(bookId);
  }

  async openLibrary(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: FLOW_LIBRARY_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openHighlights(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: FLOW_HIGHLIGHTS_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openStats(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: FLOW_STATS_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}

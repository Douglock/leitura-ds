import { normalizePath, Notice, Plugin, TFile, TFolder } from "obsidian";
import { LEITURA_DS_VIEW, LeituraDSView } from "./reader-view";
import { LEITURA_DS_LIBRARY_VIEW, LeituraDSLibraryView } from "./library-view";
import { LEITURA_DS_HIGHLIGHTS_VIEW, LeituraDSHighlightsView } from "./highlights-view";
import { LEITURA_DS_STATS_VIEW, LeituraDSStatsView } from "./stats-view";
import { LEITURA_DS_COMIC_VIEW, LeituraDSComicView } from "./comic-view";
import type { BookAnnotation, BookMarker, BookRecord, ComicBook, LeituraDSData, LeituraDSSharedState, ParsedBook, ReadingPosition, ReadingStats } from "./types";
import type { LeituraDSSettings } from "./types";
import { LeituraDSSettingTab } from "./settings-tab";

const DEFAULT_SETTINGS: LeituraDSSettings = {
  baseFolder: "99 - SISTEMAS/Leitura DS", libraryFolder: "", exportFolder: "99 - SISTEMAS/Leitura DS/Destaques",
  defaultTheme: "default", defaultFontSize: 18, defaultFocusColor: "#ff4d55",
  fastWordsPerMinute: 300, fastFontSize: 56, focusWordsPerMinute: 240, automaticBackups: true, swipeNavigation: true, dailyGoalMinutes: 20, voiceRate: 1, defaultSocialMode: "normal",
  socialFontSize: 26, socialCardCharacters: 140, threadCharacters: 320, autoExportHighlights: true,
  defaultComicFitMode: "page", defaultComicSpreadMode: false, defaultComicReadingDirection: "ltr", preloadComicPages: true
};
const DEFAULT_DATA: LeituraDSData = { positions: {}, referencePoints: {}, annotations: {}, books: {}, markers: {}, markerTombstones: {}, annotationTombstones: {}, readingStats: { days: {}, bookSeconds: {} }, settings: DEFAULT_SETTINGS };

export default class LeituraDSPlugin extends Plugin {
  private data: LeituraDSData = DEFAULT_DATA;
  private writingSharedState = false;
  private lastSharedSaveAt = "";
  private sharedSavePromise: Promise<void> | null = null;
  private sharedSaveRequested = false;

  async onload(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<LeituraDSData> | null;
    // Import the previous Flow Reader data once so positions, annotations and
    // settings survive the product rename.
    const migrated = loaded ?? await this.readLegacyPluginData();
    const settings = { ...DEFAULT_SETTINGS, ...(migrated?.settings ?? {}) };
    const previousBaseFolder = settings.baseFolder;
    const renamedBaseFolder = this.renameLegacyFolderPath(previousBaseFolder);
    let settingsMigrated = false;
    if (renamedBaseFolder !== previousBaseFolder && await this.moveLegacyBaseFolder(previousBaseFolder, renamedBaseFolder)) {
      settings.baseFolder = renamedBaseFolder;
      settings.exportFolder = this.renameLegacyFolderPath(settings.exportFolder);
      if (settings.libraryFolder) settings.libraryFolder = this.renameLegacyFolderPath(settings.libraryFolder);
      settingsMigrated = true;
    }
    this.data = { ...DEFAULT_DATA, ...migrated, settings };
    if ((!loaded && migrated) || settingsMigrated) await this.saveData(this.data);
    await this.loadSharedReadingState();
    this.addSettingTab(new LeituraDSSettingTab(this.app, this));
    this.registerView(LEITURA_DS_VIEW, (leaf) => new LeituraDSView(leaf, this));
    this.registerView(LEITURA_DS_LIBRARY_VIEW, (leaf) => new LeituraDSLibraryView(leaf, this));
    this.registerView(LEITURA_DS_HIGHLIGHTS_VIEW, (leaf) => new LeituraDSHighlightsView(leaf, this));
    this.registerView(LEITURA_DS_STATS_VIEW, (leaf) => new LeituraDSStatsView(leaf, this));
    this.registerView(LEITURA_DS_COMIC_VIEW, (leaf) => new LeituraDSComicView(leaf, this));
    this.registerExtensions(["epub"], LEITURA_DS_VIEW);
    this.registerExtensions(["cbz", "cbr"], LEITURA_DS_COMIC_VIEW);
    this.addRibbonIcon("book-open", "Abrir Leitura DS", () => void this.openFirstBook());
    this.addRibbonIcon("library", "Minha biblioteca", () => void this.openLibrary());
    this.addCommand({
      id: "open-leitura-ds",
      name: "Abrir leitor EPUB",
      callback: () => void this.openFirstBook()
    });
    this.addCommand({ id: "open-leitura-ds-library", name: "Abrir minha biblioteca", callback: () => void this.openLibrary() });
    this.addCommand({ id: "open-leitura-ds-highlights", name: "Abrir meus destaques", callback: () => void this.openHighlights() });
    this.addCommand({ id: "open-leitura-ds-stats", name: "Abrir estatísticas de leitura", callback: () => void this.openStats() });
    this.addCommand({ id: "continue-leitura-ds-reading", name: "Continuar última leitura", callback: () => void this.continueLastReading() });
    this.addCommand({ id: "export-leitura-ds-highlights", name: "Exportar destaques para Markdown", callback: () => void this.exportAllHighlights(true) });
    this.registerObsidianProtocolHandler("leitura-ds", (params) => {
      const chapter = Number(params.chapter ?? "0");
      void this.openBookById(params.book ?? "", Number.isFinite(chapter) ? chapter : 0, params.annotation);
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!this.writingSharedState && file.path === this.getSharedStatePath()) void this.loadSharedReadingState();
    }));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(LEITURA_DS_VIEW);
  }

  getPosition(bookId: string): ReadingPosition | undefined {
    return this.data.positions[bookId];
  }

  getBookRecord(bookId: string): BookRecord | undefined {
    return this.data.books?.[bookId];
  }

  getBookRecordByPath(path: string): BookRecord | undefined {
    return Object.values(this.data.books ?? {}).find((book) => book.path === path);
  }

  get readingStats(): ReadingStats {
    this.data.readingStats ??= { days: {}, bookSeconds: {} };
    this.data.readingStats.bookSeconds ??= {};
    return this.data.readingStats;
  }

  async recordReadingSeconds(bookId: string, seconds: number): Promise<void> {
    const safeSeconds = Math.round(Math.max(0, Math.min(seconds, 120)));
    if (!safeSeconds) return;
    const today = this.localDateKey(new Date());
    const day = this.readingStats.days[today] ?? { seconds: 0, books: [] };
    day.seconds += safeSeconds;
    if (!day.books.includes(bookId)) day.books.push(bookId);
    this.readingStats.days[today] = day;
    this.readingStats.bookSeconds![bookId] = (this.readingStats.bookSeconds?.[bookId] ?? 0) + safeSeconds;
    this.readingStats.lastReadAt = new Date().toISOString();
    await this.saveData(this.data);
  }

  private localDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  get leituraSettings(): LeituraDSSettings { this.data.settings ??= { ...DEFAULT_SETTINGS }; return this.data.settings; }
  get comicRuntimeBaseUrl(): string { return this.app.vault.adapter.getResourcePath(`${this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`}/assets/`); }
  get sharedSaveTime(): string { return this.lastSharedSaveAt; }
  get syncDiagnostics(): { statePath: string; lastSavedAt: string; books: number; positions: number; highlights: number; backupFolder: string } {
    return {
      statePath: this.getSharedStatePath(), lastSavedAt: this.lastSharedSaveAt, books: Object.keys(this.data.books ?? {}).length,
      positions: Object.keys(this.data.positions).length, highlights: Object.values(this.data.annotations ?? {}).reduce((total, items) => total + items.length, 0),
      backupFolder: this.getSharedBackupFolder()
    };
  }

  private async readLegacyPluginData(): Promise<Partial<LeituraDSData> | null> {
    try {
      const legacyPath = ".obsidian/plugins/flow-reader/data.json";
      if (!(await this.app.vault.adapter.exists(legacyPath))) return null;
      return JSON.parse(await this.app.vault.adapter.read(legacyPath)) as Partial<LeituraDSData>;
    } catch (error) {
      console.warn("Leitura DS could not import the previous plugin data", error);
      return null;
    }
  }

  private renameLegacyFolderPath(path: string): string {
    return normalizePath(path.split("/").map((part) => part === "Flow Reader" ? "Leitura DS" : part).join("/"));
  }

  private async moveLegacyBaseFolder(previousPath: string, nextPath: string): Promise<boolean> {
    const previous = this.app.vault.getAbstractFileByPath(normalizePath(previousPath));
    const next = this.app.vault.getAbstractFileByPath(normalizePath(nextPath));
    if (next instanceof TFolder) return true;
    if (!(previous instanceof TFolder)) return false;
    try {
      await this.app.fileManager.renameFile(previous, normalizePath(nextPath));
      new Notice(`Pasta do Leitura DS movida para ${nextPath}.`);
      return true;
    } catch (error) {
      console.warn("Leitura DS could not rename the legacy data folder", error);
      return false;
    }
  }
  async saveSettings(): Promise<void> { await this.saveData(this.data); }
  async resetSettings(): Promise<void> { this.data.settings = { ...DEFAULT_SETTINGS }; await this.saveData(this.data); }
  getVaultFolders(): string[] { return this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder).map((folder) => folder.path).sort(); }

  async setPosition(bookId: string, position: ReadingPosition): Promise<void> {
    this.data.positions[bookId] = position;
    await this.saveSharedReadingState();
  }

  private getSharedStatePath(): string {
    const folder = this.leituraSettings.baseFolder.trim() || "Leitura DS";
    return normalizePath(`${folder}/Leitura DS — Estado.json`);
  }

  /** Reads the previous filename once so an update never loses a synced reading point. */
  private getLegacySharedStatePath(): string {
    const folder = this.leituraSettings.baseFolder.trim() || "Flow Reader";
    return normalizePath(`${folder}/Flow Reader — Estado.json`);
  }

  private getSharedBackupFolder(): string {
    const folder = this.leituraSettings.baseFolder.trim() || "Leitura DS";
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
    if (!this.leituraSettings.automaticBackups) return;
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

  private mergeReferencePoints(remote: Record<string, ReadingPosition>): void {
    this.data.referencePoints ??= {};
    const ids = new Set([...Object.keys(this.data.referencePoints), ...Object.keys(remote)]);
    const merged: Record<string, ReadingPosition> = {};
    ids.forEach((id) => {
      const latest = this.newerPosition(this.data.referencePoints?.[id], remote[id]);
      if (latest) merged[id] = latest;
    });
    this.data.referencePoints = merged;
  }

  private mergeMarkers(remote: Record<string, BookMarker[]>, remoteTombstones: Record<string, string>): void {
    this.data.markers ??= {};
    this.data.markerTombstones ??= {};
    Object.entries(remoteTombstones).forEach(([key, deletedAt]) => {
      const local = this.data.markerTombstones?.[key];
      if (!local || new Date(deletedAt).getTime() > new Date(local).getTime()) this.data.markerTombstones![key] = deletedAt;
    });
    const bookIds = new Set([...Object.keys(this.data.markers), ...Object.keys(remote)]);
    bookIds.forEach((bookId) => {
      const byId = new Map<string, BookMarker>();
      [...(this.data.markers?.[bookId] ?? []), ...(remote[bookId] ?? [])].forEach((marker) => byId.set(marker.id, marker));
      this.data.markers![bookId] = [...byId.values()].filter((marker) => {
        const deletedAt = this.data.markerTombstones?.[`${bookId}:${marker.id}`];
        return !deletedAt || new Date(marker.createdAt).getTime() > new Date(deletedAt).getTime();
      });
    });
  }

  private async readSharedReadingState(): Promise<LeituraDSSharedState | undefined> {
    const file = this.app.vault.getAbstractFileByPath(this.getSharedStatePath());
    if (!(file instanceof TFile)) return undefined;
    try {
      const parsed = JSON.parse(await this.app.vault.read(file)) as Partial<LeituraDSSharedState>;
      if (!parsed.positions || typeof parsed.positions !== "object") return undefined;
      return {
        version: 1, updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "", positions: parsed.positions,
        annotations: parsed.annotations && typeof parsed.annotations === "object" ? parsed.annotations : {},
        books: parsed.books && typeof parsed.books === "object" ? parsed.books : {},
        annotationTombstones: parsed.annotationTombstones && typeof parsed.annotationTombstones === "object" ? parsed.annotationTombstones : {},
        markers: parsed.markers && typeof parsed.markers === "object" ? parsed.markers : {},
        markerTombstones: parsed.markerTombstones && typeof parsed.markerTombstones === "object" ? parsed.markerTombstones : {},
        referencePoints: parsed.referencePoints && typeof parsed.referencePoints === "object" ? parsed.referencePoints : {}
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
    this.mergeMarkers(remote.markers ?? {}, remote.markerTombstones ?? {});
    this.mergeReferencePoints(remote.referencePoints ?? {});
    await this.saveData(this.data);
  }

  private async saveSharedReadingState(): Promise<void> {
    this.sharedSaveRequested = true;
    if (this.sharedSavePromise) return this.sharedSavePromise;
    this.sharedSavePromise = (async () => {
      while (this.sharedSaveRequested) {
        this.sharedSaveRequested = false;
        await this.writeSharedReadingState();
      }
    })();
    try {
      await this.sharedSavePromise;
    } finally {
      this.sharedSavePromise = null;
    }
  }

  private async writeSharedReadingState(): Promise<void> {
    const folder = normalizePath(this.leituraSettings.baseFolder.trim() || "Leitura DS");
    try {
      await this.ensureFolder(folder);
      const path = this.getSharedStatePath();
      const existing = this.app.vault.getAbstractFileByPath(path);
      const remote = await this.readSharedReadingState();
      if (remote) {
        this.mergePositions(remote.positions);
        this.mergeBooks(remote.books);
        this.mergeAnnotations(remote.annotations, remote.annotationTombstones);
        this.mergeMarkers(remote.markers ?? {}, remote.markerTombstones ?? {});
        this.mergeReferencePoints(remote.referencePoints ?? {});
      }
      const state: LeituraDSSharedState = {
        version: 1, updatedAt: new Date().toISOString(), positions: this.data.positions,
        annotations: this.data.annotations ?? {}, books: this.data.books ?? {}, annotationTombstones: this.data.annotationTombstones ?? {},
        markers: this.data.markers ?? {}, markerTombstones: this.data.markerTombstones ?? {}, referencePoints: this.data.referencePoints ?? {}
      };
      const content = JSON.stringify(state, null, 2);
      this.writingSharedState = true;
      if (existing instanceof TFile) {
        await this.createDailyStateBackup(existing);
        await this.app.vault.modify(existing, content);
      }
      else await this.app.vault.create(path, content);
      this.lastSharedSaveAt = state.updatedAt;
    } finally {
      this.writingSharedState = false;
      await this.saveData(this.data);
    }
  }

  getReferencePoint(bookId: string): ReadingPosition | undefined {
    return this.data.referencePoints?.[bookId];
  }

  async setReferencePoint(bookId: string, position: ReadingPosition): Promise<void> {
    this.data.referencePoints ??= {};
    this.data.referencePoints[bookId] = position;
    await this.saveSharedReadingState();
  }

  getMarkers(bookId: string): BookMarker[] { return this.data.markers?.[bookId] ?? []; }

  async saveMarker(bookId: string, marker: BookMarker): Promise<void> {
    this.data.markers ??= {};
    this.data.markers[bookId] = [...(this.data.markers[bookId] ?? []), marker];
    await this.saveSharedReadingState();
  }

  async deleteMarker(bookId: string, markerId: string): Promise<void> {
    this.data.markers ??= {};
    this.data.markerTombstones ??= {};
    this.data.markers[bookId] = (this.data.markers[bookId] ?? []).filter((marker) => marker.id !== markerId);
    this.data.markerTombstones[`${bookId}:${markerId}`] = new Date().toISOString();
    await this.saveSharedReadingState();
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
    await this.saveSharedReadingState();
  }

  async saveAnnotation(bookId: string, annotation: BookAnnotation): Promise<void> {
    this.data.annotations ??= {};
    const annotations = this.data.annotations[bookId] ?? [];
    const index = annotations.findIndex((item) => item.id === annotation.id);
    if (index >= 0) annotations[index] = annotation;
    else annotations.push(annotation);
    this.data.annotations[bookId] = annotations;
    await this.saveSharedReadingState();
    if (this.leituraSettings.autoExportHighlights) await this.exportBookHighlights(bookId);
  }

  async deleteAnnotation(bookId: string, annotationId: string): Promise<void> {
    this.data.annotations ??= {};
    this.data.annotationTombstones ??= {};
    this.data.annotations[bookId] = (this.data.annotations[bookId] ?? []).filter((item) => item.id !== annotationId);
    this.data.annotationTombstones[`${bookId}:${annotationId}`] = new Date().toISOString();
    await this.saveSharedReadingState();
    if (this.leituraSettings.autoExportHighlights) await this.exportBookHighlights(bookId);
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
    const folder = normalizePath(this.leituraSettings.exportFolder.trim() || DEFAULT_SETTINGS.exportFolder);
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
      `author: ${JSON.stringify(book.author)}`, `epub: ${JSON.stringify(book.path)}`, `leitura_ds_id: ${bookId}`,
      `updated: ${new Date().toISOString()}`, "tags:", "  - leitura-ds", "  - destaque", "---", "",
      `# ${book.title}`, "", `**Autor:** ${book.author}`, `**Destaques:** ${annotations.length}`, ""
    ];
    if (!annotations.length) lines.push("> Nenhum destaque salvo neste livro.", "");
    let currentChapter = -1;
    annotations.forEach((annotation) => {
      if (annotation.chapterIndex !== currentChapter) {
        currentChapter = annotation.chapterIndex;
        lines.push(`## ${book.chapters?.[currentChapter] ?? `Capítulo ${currentChapter + 1}`}`, "");
      }
      const link = `obsidian://leitura-ds?book=${encodeURIComponent(bookId)}&chapter=${annotation.chapterIndex}&annotation=${encodeURIComponent(annotation.id)}`;
      lines.push(`<!-- leitura-ds:annotation=${annotation.id} -->`);
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
    const folder = normalizePath(this.leituraSettings.exportFolder.trim() || DEFAULT_SETTINGS.exportFolder);
    const files = this.app.vault.getFiles().filter((file) => file.extension === "md" && (file.path === folder || file.path.startsWith(`${folder}/`)));
    const changedBooks = new Set<string>();
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const bookId = (content.match(/^leitura_ds_id:\s*(.+)$/m)?.[1] ?? content.match(/^flow_reader_id:\s*(.+)$/m)?.[1])?.trim().replace(/^"|"$/g, "");
      if (!bookId || !this.data.annotations?.[bookId]) continue;
      const blocks = [...content.matchAll(/<!--\s*(?:leitura-ds|flow-reader):annotation=([^\s]+)\s*-->([\s\S]*?)(?=<!--\s*(?:leitura-ds|flow-reader):annotation=|$)/g)];
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
    const folder = this.leituraSettings.libraryFolder.trim().replace(/\/+$/, "");
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
    await leaf.setViewState({ type: isComic ? LEITURA_DS_COMIC_VIEW : LEITURA_DS_VIEW, active: true, state: isComic ? { file: file.path, pageIndex: chapterIndex, legacyBookId } : { file: file.path, chapterIndex, annotationId, legacyBookId } });
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
    await leaf.setViewState({ type: LEITURA_DS_LIBRARY_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openHighlights(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: LEITURA_DS_HIGHLIGHTS_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openStats(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: LEITURA_DS_STATS_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}

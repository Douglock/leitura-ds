export interface FastReaderOptions {
  wordsPerMinute: number;
  wordsPerGroup: number;
}

export class FastReader {
  private tokens: string[] = [];
  private index = 0;
  private displayedIndex = 0;
  private timer: number | null = null;

  constructor(
    private readonly output: HTMLElement,
    private readonly onPosition: (index: number, progress: number) => void,
    private options: FastReaderOptions
  ) {}

  load(text: string, startIndex = 0): void {
    this.pause();
    this.tokens = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    this.index = Math.max(0, Math.min(startIndex, Math.max(0, this.tokens.length - 1)));
    this.render();
  }

  play(): void {
    if (!this.tokens.length || this.timer !== null) return;
    this.tick();
  }

  pause(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  toggle(): boolean {
    if (this.timer === null) {
      this.play();
      return true;
    }
    this.pause();
    return false;
  }

  seek(delta: number): void {
    this.index = Math.max(0, Math.min(this.tokens.length - 1, this.index + delta));
    this.render();
  }

  setIndex(index: number): void {
    this.index = Math.max(0, Math.min(this.tokens.length - 1, index));
    this.render();
  }

  setOptions(options: Partial<FastReaderOptions>): void {
    this.options = { ...this.options, ...options };
  }

  destroy(): void {
    this.pause();
  }

  getIndex(): number {
    return this.index;
  }

  getDisplayedIndex(): number {
    return this.displayedIndex;
  }

  getRemainingMinutes(): number {
    const remainingWords = Math.max(0, this.tokens.length - this.index);
    return remainingWords / this.options.wordsPerMinute;
  }

  private tick(): void {
    if (this.index >= this.tokens.length) {
      this.pause();
      return;
    }
    const group = this.currentGroup();
    this.render();
    const punctuationPause = /[.!?…][”"')\]]?$/.test(group) ? 1.8 : /[,;:][”"')\]]?$/.test(group) ? 1.35 : 1;
    const interval = (60_000 / this.options.wordsPerMinute) * this.options.wordsPerGroup * punctuationPause;
    this.timer = window.setTimeout(() => {
      this.index = Math.min(this.tokens.length, this.index + this.options.wordsPerGroup);
      this.tick();
    }, interval);
  }

  private currentGroup(): string {
    return this.tokens.slice(this.index, this.index + this.options.wordsPerGroup).join(" ");
  }

  private render(): void {
    const word = this.currentGroup();
    this.displayedIndex = this.index;
    this.renderOrpWord(word || "Fim do capítulo");
    this.onPosition(this.displayedIndex, this.tokens.length ? this.displayedIndex / this.tokens.length : 0);
  }

  private renderOrpWord(word: string): void {
    const focusIndex = optimalRecognitionPoint(word);
    const prefix = document.createElement("span");
    const focus = document.createElement("span");
    const suffix = document.createElement("span");
    prefix.className = "leitura-ds__orp-prefix";
    focus.className = "leitura-ds__orp-focus";
    suffix.className = "leitura-ds__orp-suffix";
    prefix.textContent = word.slice(0, focusIndex);
    focus.textContent = word.charAt(focusIndex) || " ";
    suffix.textContent = word.slice(focusIndex + 1);
    this.output.replaceChildren(prefix, focus, suffix);
  }
}

export function optimalRecognitionPoint(word: string): number {
  const lettersBefore = word.match(/^[“"'([{¿¡]*/)?.[0].length ?? 0;
  const readableLength = Math.max(1, word.length - lettersBefore);
  const offset = readableLength <= 1 ? 0 : readableLength <= 5 ? 1 : readableLength <= 9 ? 2 : readableLength <= 13 ? 3 : 4;
  return Math.min(word.length - 1, lettersBefore + offset);
}

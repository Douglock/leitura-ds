export interface BookChapter {
  id: string;
  href: string;
  label: string;
  html: string;
}

export interface ParsedBook {
  id: string;
  path: string;
  title: string;
  author: string;
  coverUrl?: string;
  chapters: BookChapter[];
  resources: string[];
  format?: "epub" | "cbz" | "cbr";
  /** Keeps a malformed or unsupported local file visible in the shelf. */
  error?: string;
}

/** A comic is an ordered sequence of images kept locally inside a CBZ archive. */
export interface ComicBook {
  id: string;
  path: string;
  title: string;
  author: string;
  coverUrl?: string;
  pages: string[];
  chapters: BookChapter[];
  resources: string[];
  format: "cbz" | "cbr";
  /** CBZ pages are decoded only when the reader needs them. */
  loadPage?: (index: number) => Promise<string>;
}

export interface BookRecord {
  id: string;
  path: string;
  title: string;
  author: string;
  chapters?: string[];
  format?: "epub" | "cbz" | "cbr";
}

export interface ReadingPosition {
  chapterIndex: number;
  progress: number;
  fastWordIndex?: number;
  word?: string;
  contextBefore?: string[];
  contextAfter?: string[];
  scrollTop?: number;
  fontSize?: number;
  theme?: ReaderTheme;
  focusColor?: string;
  fontFamily?: ReaderFont;
  lineHeight?: number;
  pageWidth?: number;
  pageMargin?: number;
  textAlign?: "left" | "justify";
  fastFontSize?: number;
  fastWordsPerMinute?: number;
  focusWordsPerMinute?: number;
  colorFlow?: boolean;
  twoColumn?: boolean;
  updatedAt: string;
}

export interface BookMarker {
  id: string;
  name: string;
  position: ReadingPosition;
  createdAt: string;
}

export type ReaderTheme = "default" | "paper" | "sepia" | "forest" | "midnight" | "dark";
export type ReaderFont = "book" | "serif" | "sans" | "system";
export type SocialReadingMode = "normal" | "thread" | "stories" | "carousel";

export interface ReaderAppearance {
  theme: ReaderTheme;
  focusColor: string;
  fontSize: number;
  fontFamily: ReaderFont;
  lineHeight: number;
  pageWidth: number;
  pageMargin: number;
  textAlign: "left" | "justify";
}

export type HighlightColor = "yellow" | "blue" | "red" | "purple" | "green";

export interface BookAnnotation {
  id: string;
  chapterIndex: number;
  quote: string;
  startOffset: number;
  endOffset: number;
  color: HighlightColor;
  comment: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LeituraDSData {
  positions: Record<string, ReadingPosition>;
  referencePoints?: Record<string, ReadingPosition>;
  annotations?: Record<string, BookAnnotation[]>;
  books?: Record<string, BookRecord>;
  markers?: Record<string, BookMarker[]>;
  annotationTombstones?: Record<string, string>;
  readingStats?: ReadingStats;
  settings?: LeituraDSSettings;
}

export interface ReadingDayStats {
  seconds: number;
  books: string[];
}

export interface ReadingStats {
  days: Record<string, ReadingDayStats>;
  lastReadAt?: string;
}

export interface LeituraDSSharedState {
  version: 1;
  updatedAt: string;
  positions: Record<string, ReadingPosition>;
  annotations: Record<string, BookAnnotation[]>;
  books: Record<string, BookRecord>;
  annotationTombstones: Record<string, string>;
}

export interface LeituraDSSettings {
  baseFolder: string;
  libraryFolder: string;
  exportFolder: string;
  defaultTheme: ReaderTheme;
  defaultFontSize: number;
  defaultFocusColor: string;
  fastWordsPerMinute: number;
  fastFontSize: number;
  focusWordsPerMinute: number;
  automaticBackups: boolean;
  swipeNavigation: boolean;
  dailyGoalMinutes: number;
  voiceRate: number;
  defaultSocialMode: SocialReadingMode;
}

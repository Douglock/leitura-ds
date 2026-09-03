import JSZip from "jszip";
import { getUnrarModule } from "@unrar-browser/core";
import type { ComicBook, ParsedBook } from "./types";

const IMAGE = /\.(avif|gif|jpe?g|png|webp)$/i;

function comicId(path: string, title: string): string {
  let hash = 2166136261;
  for (const character of `${path}\u0000${title}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `book-${(hash >>> 0).toString(16)}`;
}

function titleFromPath(path: string): string {
  return (path.split("/").pop() ?? "Quadrinho").replace(/\.cbz$/i, "").replace(/[._-]+/g, " ").trim();
}

function mime(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

async function imageEntries(buffer: ArrayBuffer): Promise<{ zip: JSZip; names: string[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.values(zip.files)
    .filter((entry) => !entry.dir && IMAGE.test(entry.name) && !entry.name.startsWith("__MACOSX/"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
  if (!names.length) throw new Error("CBZ inválido: nenhuma página de imagem foi encontrada.");
  return { zip, names };
}

/** Lightweight pass for the shelf: it opens just the first page as the cover. */
export async function parseCbzCatalogEntry(buffer: ArrayBuffer, vaultPath: string): Promise<ParsedBook> {
  const { zip, names } = await imageEntries(buffer);
  const title = titleFromPath(vaultPath);
  const first = zip.file(names[0]);
  if (!first) throw new Error("CBZ inválido: capa não encontrada.");
  const blob = await first.async("blob");
  const coverUrl = URL.createObjectURL(blob.slice(0, blob.size, mime(names[0])));
  return {
    id: comicId(vaultPath, title), path: vaultPath, title, author: "Quadrinho", coverUrl,
    chapters: names.map((name, index) => ({ id: `page-${index}`, href: name, label: `Página ${index + 1}`, html: "" })),
    resources: [coverUrl], format: "cbz"
  };
}

export async function parseCbz(buffer: ArrayBuffer, vaultPath: string): Promise<ComicBook> {
  const { zip, names } = await imageEntries(buffer);
  const title = titleFromPath(vaultPath);
  const loadPage = async (index: number): Promise<string> => {
    const name = names[index];
    if (!name) throw new Error("Página do quadrinho não encontrada.");
    const image = zip.file(name);
    if (!image) throw new Error(`CBZ inválido: página ausente (${name}).`);
    const blob = await image.async("blob");
    return URL.createObjectURL(blob.slice(0, blob.size, mime(name)));
  };
  // Do not inflate every image of a comic at once. The view keeps only the current
  // page and its immediate neighbours alive, which is important on phones.
  const coverUrl = await loadPage(0);
  return {
    id: comicId(vaultPath, title), path: vaultPath, title, author: "Quadrinho", coverUrl, pages: Array.from({ length: names.length }, () => ""),
    chapters: names.map((name, index) => ({ id: `page-${index}`, href: name, label: `Página ${index + 1}`, html: "" })),
    resources: [coverUrl], format: "cbz", loadPage
  };
}

/** CBR follows the same reader flow, using the bundled local UnRAR WebAssembly runtime. */
export async function parseCbr(buffer: ArrayBuffer, vaultPath: string, runtimeBaseUrl: string): Promise<ComicBook> {
  const unrar = await getUnrarModule(runtimeBaseUrl);
  const archivePath = "/leitura-ds-comic.cbr";
  unrar.FS.writeFile(archivePath, new Uint8Array(buffer));
  const archive = new unrar.Archive(new unrar.CommandData());
  if (!archive.openFile(archivePath)) throw new Error("Não foi possível abrir este arquivo CBR.");
  const extracted: Array<{ name: string; bytes: Uint8Array }> = [];
  while (archive.readHeader() > 0) {
    if (archive.getHeaderType() === unrar.HeaderType.HEAD_FILE) {
      const name = archive.getFileName();
      const node = archive.readFileData();
      if (IMAGE.test(name) && node) extracted.push({ name, bytes: unrar.FS.getFileDataAsTypedArray(node) });
    }
    archive.seekToNext();
  }
  if (!extracted.length) throw new Error("Este CBR usa uma variante RAR que o leitor local ainda não consegue extrair. Converta-o para CBZ para ler em todos os seus dispositivos.");
  extracted.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
  const pages = extracted.map(({ name, bytes }) => URL.createObjectURL(new Blob([bytes], { type: mime(name) })));
  const title = (vaultPath.split("/").pop() ?? "Quadrinho").replace(/\.cbr$/i, "").replace(/[._-]+/g, " ").trim();
  return {
    id: comicId(vaultPath, title), path: vaultPath, title, author: "Quadrinho", coverUrl: pages[0], pages,
    chapters: extracted.map(({ name }, index) => ({ id: `page-${index}`, href: name, label: `Página ${index + 1}`, html: "" })),
    resources: pages, format: "cbr"
  };
}

export async function parseCbrCatalogEntry(buffer: ArrayBuffer, vaultPath: string, runtimeBaseUrl: string): Promise<ParsedBook> {
  const comic = await parseCbr(buffer, vaultPath, runtimeBaseUrl);
  comic.pages.slice(1).forEach((url) => URL.revokeObjectURL(url));
  return { id: comic.id, path: comic.path, title: comic.title, author: comic.author, coverUrl: comic.coverUrl, chapters: comic.chapters, resources: comic.coverUrl ? [comic.coverUrl] : [], format: "cbr" };
}

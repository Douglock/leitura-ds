import JSZip from "jszip";
import { dirname, resolvePath, xmlText } from "./path-utils";
import type { BookChapter, ParsedBook } from "./types";

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  css: "text/css",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf"
};

export async function parseEpub(buffer: ArrayBuffer, vaultPath: string): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buffer);
  const containerText = await requiredText(zip, "META-INF/container.xml");
  const container = parseXml(containerText, "application/xml");
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB inválido: pacote OPF não encontrado.");

  const opfText = await requiredText(zip, opfPath);
  const opf = parseXml(opfText, "application/xml");
  const opfDir = dirname(opfPath);
  const manifest = new Map<string, ManifestItem>();

  opf.querySelectorAll("manifest > item").forEach((node) => {
    const id = node.getAttribute("id") ?? "";
    if (!id) return;
    manifest.set(id, {
      id,
      href: node.getAttribute("href") ?? "",
      mediaType: node.getAttribute("media-type") ?? "",
      properties: node.getAttribute("properties") ?? ""
    });
  });

  const labels = await readNavigationLabels(zip, opf, manifest, opfDir);
  const resourceUrls = new Map<string, string>();
  const resources: string[] = [];

  for (const item of manifest.values()) {
    // Reader typography is controlled by Leitura DS. Inflating every embedded
    // font/audio file here wastes a large amount of memory on mobile devices.
    const fullPath = resolvePath(opfDir, item.href);
    const type = item.mediaType || mimeFromPath(fullPath);
    if (!type.startsWith("image/")) continue;
    const file = zip.file(fullPath);
    if (!file) continue;
    const blob = await file.async("blob");
    const url = URL.createObjectURL(type ? blob.slice(0, blob.size, type) : blob);
    resourceUrls.set(fullPath, url);
    resources.push(url);
  }

  const chapters: BookChapter[] = [];
  const spineItems = Array.from(opf.querySelectorAll("spine > itemref"));
  for (let index = 0; index < spineItems.length; index += 1) {
    const id = spineItems[index]?.getAttribute("idref") ?? "";
    const item = manifest.get(id);
    if (!item) continue;
    const fullPath = resolvePath(opfDir, item.href);
    const source = await requiredText(zip, fullPath);
    const document = parseXml(source, "application/xhtml+xml");
    await inlineStyles(zip, document, fullPath, resourceUrls);
    rewriteResourceAttributes(document, fullPath, resourceUrls);
    stripUnsafeElements(document);
    const body = document.querySelector("body");
    const fallback = document.querySelector("title")?.textContent?.trim() || `Capítulo ${index + 1}`;
    chapters.push({
      id,
      href: fullPath,
      label: labels.get(stripFragment(item.href)) ?? fallback,
      html: body?.innerHTML ?? source
    });
  }

  if (!chapters.length) throw new Error("EPUB inválido: nenhum capítulo legível foi encontrado.");
  const title = xmlText(opf, "metadata > title") || vaultPath.split("/").pop()?.replace(/\.epub$/i, "") || "Livro";
  const author = xmlText(opf, "metadata > creator") || "Autor desconhecido";
  const explicitCoverId = opf.querySelector('metadata meta[name="cover"]')?.getAttribute("content") ?? "";
  const coverItem = Array.from(manifest.values()).find((item) =>
    item.properties.split(/\s+/).includes("cover-image") || item.id === explicitCoverId || /(^|[-_])cover([-_.]|$)/i.test(item.id)
  );
  const coverUrl = coverItem ? resourceUrls.get(resolvePath(opfDir, coverItem.href)) : undefined;
  return { id: stableBookId(vaultPath, title), path: vaultPath, title, author, coverUrl, chapters, resources };
}

/** Lightweight EPUB pass used by the library: no chapter HTML, fonts or images are loaded. */
export async function parseEpubCatalogEntry(buffer: ArrayBuffer, vaultPath: string): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(buffer);
  const container = parseXml(await requiredText(zip, "META-INF/container.xml"), "application/xml");
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB inválido: pacote OPF não encontrado.");
  const opf = parseXml(await requiredText(zip, opfPath), "application/xml");
  const opfDir = dirname(opfPath);
  const manifest = new Map<string, ManifestItem>();
  opf.querySelectorAll("manifest > item").forEach((node) => {
    const id = node.getAttribute("id") ?? "";
    if (!id) return;
    manifest.set(id, { id, href: node.getAttribute("href") ?? "", mediaType: node.getAttribute("media-type") ?? "", properties: node.getAttribute("properties") ?? "" });
  });
  const labels = await readNavigationLabels(zip, opf, manifest, opfDir);
  const chapters: BookChapter[] = [];
  Array.from(opf.querySelectorAll("spine > itemref")).forEach((spineItem, index) => {
    const item = manifest.get(spineItem.getAttribute("idref") ?? "");
    if (!item) return;
    const href = resolvePath(opfDir, item.href);
    chapters.push({ id: item.id, href, label: labels.get(stripFragment(item.href)) ?? `Capítulo ${index + 1}`, html: "" });
  });
  const title = xmlText(opf, "metadata > title") || vaultPath.split("/").pop()?.replace(/\.epub$/i, "") || "Livro";
  const author = xmlText(opf, "metadata > creator") || "Autor desconhecido";
  const explicitCoverId = opf.querySelector('metadata meta[name="cover"]')?.getAttribute("content") ?? "";
  const coverItem = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/).includes("cover-image") || item.id === explicitCoverId || /(^|[-_])cover([-_.]|$)/i.test(item.id));
  let coverUrl: string | undefined;
  const resources: string[] = [];
  if (coverItem) {
    const coverPath = resolvePath(opfDir, coverItem.href);
    const cover = zip.file(coverPath);
    if (cover) {
      const blob = await cover.async("blob");
      coverUrl = URL.createObjectURL(blob.slice(0, blob.size, coverItem.mediaType || mimeFromPath(coverPath)));
      resources.push(coverUrl);
    }
  }
  if (!chapters.length) throw new Error("EPUB inválido: nenhum capítulo legível foi encontrado.");
  return { id: stableBookId(vaultPath, title), path: vaultPath, title, author, coverUrl, chapters, resources };
}

function parseXml(source: string, type: DOMParserSupportedType): Document {
  const document = new DOMParser().parseFromString(source, type);
  if (document.querySelector("parsererror")) {
    const html = new DOMParser().parseFromString(source, "text/html");
    return html;
  }
  return document;
}

async function requiredText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`EPUB inválido: arquivo ausente (${path}).`);
  return file.async("text");
}

async function readNavigationLabels(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, ManifestItem>,
  opfDir: string
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const navItem = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/).includes("nav"));
  if (navItem) {
    try {
      const navPath = resolvePath(opfDir, navItem.href);
      const nav = parseXml(await requiredText(zip, navPath), "application/xhtml+xml");
      nav.querySelectorAll("nav a[href]").forEach((anchor) => {
        const href = anchor.getAttribute("href") ?? "";
        const label = anchor.textContent?.trim() ?? "";
        if (href && label) labels.set(stripFragment(resolvePath(dirname(navPath), href)).replace(`${opfDir}/`, ""), label);
      });
      if (labels.size) return labels;
    } catch {
      // Some older EPUBs declare a missing navigation file but still include NCX.
    }
  }

  const tocId = opf.querySelector("spine")?.getAttribute("toc") ?? "";
  const ncxItem = manifest.get(tocId);
  if (!ncxItem) return labels;
  const ncxPath = resolvePath(opfDir, ncxItem.href);
  const ncxFile = zip.file(ncxPath);
  if (!ncxFile) return labels;
  const ncx = parseXml(await ncxFile.async("text"), "application/xml");
  ncx.querySelectorAll("navPoint").forEach((point) => {
    const href = point.querySelector("content")?.getAttribute("src") ?? "";
    const label = point.querySelector("navLabel > text")?.textContent?.trim() ?? "";
    if (href && label) labels.set(stripFragment(resolvePath(dirname(ncxPath), href)).replace(`${opfDir}/`, ""), label);
  });
  return labels;
}

async function inlineStyles(
  zip: JSZip,
  document: Document,
  chapterPath: string,
  resourceUrls: Map<string, string>
): Promise<void> {
  const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const cssPath = resolvePath(dirname(chapterPath), href);
    const file = zip.file(cssPath);
    if (!file) {
      link.remove();
      continue;
    }
    let css = await file.async("text");
    css = css.replace(/url\((['"]?)(.*?)\1\)/gi, (_match, quote: string, target: string) => {
      if (/^(data:|https?:|blob:)/i.test(target)) return `url(${quote}${target}${quote})`;
      const url = resourceUrls.get(resolvePath(dirname(cssPath), target));
      return url ? `url(${quote}${url}${quote})` : "none";
    });
    const style = document.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
  }
}

function rewriteResourceAttributes(document: Document, chapterPath: string, resources: Map<string, string>): void {
  for (const attribute of ["src", "poster"]) {
    document.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const value = element.getAttribute(attribute) ?? "";
      if (/^(data:|https?:|blob:|#)/i.test(value)) return;
      const url = resources.get(resolvePath(dirname(chapterPath), value));
      if (url) element.setAttribute(attribute, url);
    });
  }
  document.querySelectorAll("[srcset]").forEach((element) => {
    const value = element.getAttribute("srcset") ?? "";
    const rewritten = value.split(",").map((candidate) => {
      const [target, ...descriptor] = candidate.trim().split(/\s+/);
      if (!target || /^(data:|https?:|blob:)/i.test(target)) return candidate.trim();
      const url = resources.get(resolvePath(dirname(chapterPath), target));
      return url ? [url, ...descriptor].join(" ") : "";
    }).filter(Boolean).join(", ");
    if (rewritten) element.setAttribute("srcset", rewritten);
    else element.removeAttribute("srcset");
  });
  document.querySelectorAll("svg image[href], svg image[xlink\\:href]").forEach((element) => {
    for (const attribute of ["href", "xlink:href"]) {
      const value = element.getAttribute(attribute);
      if (!value || /^(data:|https?:|blob:|#)/i.test(value)) continue;
      const url = resources.get(resolvePath(dirname(chapterPath), value));
      if (url) element.setAttribute(attribute, url);
    }
  });
}

function stripUnsafeElements(document: Document): void {
  document.querySelectorAll("script, iframe, object, embed").forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
    }
  });
}

function stripFragment(value: string): string {
  const path = value.split("#")[0] ?? value;
  try { return decodeURIComponent(path); }
  catch { return path; }
}

function mimeFromPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "";
}

function stableBookId(path: string, title: string): string {
  let hash = 2166136261;
  for (const character of `${path}\u0000${title}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `book-${(hash >>> 0).toString(16)}`;
}

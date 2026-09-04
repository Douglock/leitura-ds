export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

export function resolvePath(baseDir: string, relative: string): string {
  if (!relative) return baseDir;
  const raw = relative.split("#")[0]?.split("?")[0] ?? relative;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); }
  catch {
    // Malformed EPUBs sometimes contain literal percent signs. Decode only
    // valid escape sequences so the rest of the book can still be opened.
    decoded = raw.replace(/%[0-9a-f]{2}/gi, (escape) => {
      try { return decodeURIComponent(escape); } catch { return escape; }
    });
  }
  const parts = `${baseDir}/${decoded}`.split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}

export function xmlText(parent: ParentNode, selector: string): string {
  return parent.querySelector(selector)?.textContent?.trim() ?? "";
}

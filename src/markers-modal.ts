import { App, Modal } from "obsidian";
import type { BookMarker } from "./types";

export class MarkersModal extends Modal {
  constructor(
    app: App,
    private readonly markers: BookMarker[],
    private readonly onAdd: (name: string) => void,
    private readonly onGo: (marker: BookMarker) => void,
    private readonly onDelete: (marker: BookMarker) => void,
    private readonly locationLabel = "Capítulo"
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Marcadores");
    const addRow = this.contentEl.createDiv({ cls: "leitura-ds__marker-add" });
    const input = addRow.createEl("input", { type: "text", attr: { placeholder: "Nome do marcador…", "aria-label": "Nome do marcador" } });
    const add = addRow.createEl("button", { text: "Adicionar aqui", cls: "mod-cta" });
    add.addEventListener("click", () => { this.onAdd(input.value.trim() || `Marcador ${this.markers.length + 1}`); this.close(); });
    const list = this.contentEl.createDiv({ cls: "leitura-ds__marker-list" });
    if (!this.markers.length) list.createDiv({ cls: "leitura-ds__search-empty", text: "Nenhum marcador adicional." });
    this.markers.forEach((marker) => {
      const row = list.createDiv({ cls: "leitura-ds__marker" });
      const info = row.createDiv();
      info.createDiv({ cls: "leitura-ds__marker-name", text: marker.name });
      info.createDiv({ cls: "leitura-ds__marker-location", text: `${this.locationLabel} ${marker.position.chapterIndex + 1} · ${marker.position.word ?? "posição salva"}` });
      const go = row.createEl("button", { text: "Ir" });
      go.addEventListener("click", () => { this.onGo(marker); this.close(); });
      const remove = row.createEl("button", { text: "×", attr: { "aria-label": `Apagar ${marker.name}` } });
      remove.addEventListener("click", () => { this.onDelete(marker); row.remove(); });
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

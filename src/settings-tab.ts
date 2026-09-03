import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LeituraDSPlugin from "./main";
import type { ReaderTheme, SocialReadingMode } from "./types";

const THEMES: Record<ReaderTheme, string> = {
  default: "Obsidian", paper: "Papel", sepia: "Sépia", forest: "Floresta", midnight: "Meia-noite", dark: "Escuro"
};

export class LeituraDSSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: LeituraDSPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.leituraSettings;
    const folderOptions: Record<string, string> = { "": "Raiz do Vault" };
    this.plugin.getVaultFolders().forEach((folder) => { folderOptions[folder] = folder; });
    if (settings.libraryFolder && !folderOptions[settings.libraryFolder]) folderOptions[settings.libraryFolder] = settings.libraryFolder;
    if (settings.baseFolder && !folderOptions[settings.baseFolder]) folderOptions[settings.baseFolder] = settings.baseFolder;
    if (settings.exportFolder && !folderOptions[settings.exportFolder]) folderOptions[settings.exportFolder] = settings.exportFolder;

    containerEl.createEl("h2", { text: "Leitura DS" });
    containerEl.createEl("p", { text: "Organize a biblioteca e escolha os padrões para novas leituras." });
    containerEl.createEl("h3", { text: "Biblioteca e notas" });
    new Setting(containerEl).setName("Pasta principal do Leitura DS").setDesc("Local padrão da pasta do sistema do Leitura DS, incluindo arquivos e notas gerados pelo plugin.")
      .addDropdown((drop) => drop.addOptions(folderOptions).setValue(settings.baseFolder).onChange(async (value) => { settings.baseFolder = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Pasta da biblioteca").setDesc("EPUBs, CBZs e CBRs desta pasta e de suas subpastas aparecerão em Minha biblioteca.")
      .addDropdown((drop) => drop.addOptions(folderOptions).setValue(settings.libraryFolder).onChange(async (value) => { settings.libraryFolder = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Pasta dos destaques").setDesc("Onde o Leitura DS salva as notas Markdown de cada livro.")
      .addDropdown((drop) => drop.addOptions(folderOptions).setValue(settings.exportFolder).onChange(async (value) => { settings.exportFolder = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Atualizar lista de pastas").setDesc("Use após criar, mover ou renomear pastas no Vault.")
      .addButton((button) => button.setButtonText("Atualizar").onClick(() => this.display()));

    containerEl.createEl("h3", { text: "Sincronização e segurança" });
    const diagnostics = this.plugin.syncDiagnostics;
    const lastSave = diagnostics.lastSavedAt ? new Date(diagnostics.lastSavedAt).toLocaleString("pt-BR") : "ainda não salvo";
    new Setting(containerEl).setName("Estado sincronizado").setDesc(`${diagnostics.positions} pontos de leitura · ${diagnostics.highlights} destaques · última atualização: ${lastSave}.`)
      .addButton((button) => button.setButtonText("Abrir arquivo").onClick(() => void this.plugin.openSharedStateFile()));
    new Setting(containerEl).setName("Cópia de segurança automática").setDesc(`Guarda uma cópia por dia antes de atualizar o estado. Local: ${diagnostics.backupFolder}`)
      .addToggle((toggle) => toggle.setValue(settings.automaticBackups).onChange(async (value) => { settings.automaticBackups = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Criar backup agora").setDesc("Cria uma cópia manual da posição, destaques e comentários sincronizados.")
      .addButton((button) => button.setButtonText("Criar backup").onClick(async () => {
        const backup = await this.plugin.createSharedStateBackup();
        new Notice(backup ? `Backup criado: ${backup.path}` : "Ainda não existe um estado salvo para fazer backup.");
      }));

    containerEl.createEl("h3", { text: "Aparência padrão" });
    containerEl.createEl("p", { text: "Aplicada aos livros que ainda não têm aparência salva individualmente." });
    new Setting(containerEl).setName("Tema").setDesc("Tema inicial usado na leitura.")
      .addDropdown((drop) => drop.addOptions(THEMES).setValue(settings.defaultTheme).onChange(async (value) => { settings.defaultTheme = value as ReaderTheme; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Tamanho do texto").setDesc("Tamanho inicial do texto dos livros.")
      .addSlider((slider) => slider.setLimits(12, 40, 1).setValue(settings.defaultFontSize).setDynamicTooltip().onChange(async (value) => { settings.defaultFontSize = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Cor da palavra em foco").setDesc("Usada na leitura rápida, no Foco em Linha e para marcar onde você parou.")
      .addColorPicker((picker) => picker.setValue(settings.defaultFocusColor).onChange(async (value) => { settings.defaultFocusColor = value; await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "Modos de leitura" });
    new Setting(containerEl).setName("Leitura rápida: velocidade").setDesc("Velocidade inicial em palavras por minuto.")
      .addSlider((slider) => slider.setLimits(100, 1000, 25).setValue(settings.fastWordsPerMinute).setDynamicTooltip().onChange(async (value) => { settings.fastWordsPerMinute = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Leitura rápida: tamanho da palavra").setDesc("Tamanho inicial da palavra exibida no centro da tela.")
      .addSlider((slider) => slider.setLimits(28, 100, 2).setValue(settings.fastFontSize).setDynamicTooltip().onChange(async (value) => { settings.fastFontSize = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Foco em Linha: velocidade").setDesc("Velocidade inicial para acompanhar uma palavra por vez no texto.")
      .addSlider((slider) => slider.setLimits(80, 600, 10).setValue(settings.focusWordsPerMinute).setDynamicTooltip().onChange(async (value) => { settings.focusWordsPerMinute = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Deslizar para trocar capítulo").setDesc("No celular, deslize para a esquerda ou direita para navegar entre capítulos. Não interfere quando houver texto selecionado.")
      .addToggle((toggle) => toggle.setValue(settings.swipeNavigation).onChange(async (value) => { settings.swipeNavigation = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Modo de leitura social padrão").setDesc("Alterna a apresentação do EPUB; a leitura normal continua disponível a qualquer momento.")
      .addDropdown((drop) => drop.addOptions({ normal: "Leitura normal", thread: "Thread", stories: "Stories", carousel: "Carrossel" }).setValue(settings.defaultSocialMode ?? "normal").onChange(async (value) => { settings.defaultSocialMode = value as SocialReadingMode; await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "Metas de leitura" });
    new Setting(containerEl).setName("Meta diária").setDesc("Tempo de leitura que você quer alcançar por dia.")
      .addSlider((slider) => slider.setLimits(5, 180, 5).setValue(settings.dailyGoalMinutes).setDynamicTooltip().onChange(async (value) => { settings.dailyGoalMinutes = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Leitura em voz alta: velocidade").setDesc("Velocidade usada ao ouvir um capítulo.")
      .addSlider((slider) => slider.setLimits(.6, 2, .1).setValue(settings.voiceRate).setDynamicTooltip().onChange(async (value) => { settings.voiceRate = value; await this.plugin.saveSettings(); }));

    containerEl.createEl("h3", { text: "Atalhos e dados" });
    new Setting(containerEl).setName("Minha biblioteca").setDesc("Abrir a estante de livros.")
      .addButton((button) => button.setButtonText("Abrir").onClick(() => void this.plugin.openLibrary()));
    new Setting(containerEl).setName("Continuar última leitura").setDesc("Abre o livro e a palavra que você leu por último.")
      .addButton((button) => button.setButtonText("Continuar").onClick(() => void this.plugin.continueLastReading()));
    new Setting(containerEl).setName("Meus destaques").setDesc("Ver todos os trechos marcados.")
      .addButton((button) => button.setButtonText("Abrir").onClick(() => void this.plugin.openHighlights()));
    new Setting(containerEl).setName("Estatísticas de leitura").setDesc("Ver tempo lido, sequência de dias e livros em andamento.")
      .addButton((button) => button.setButtonText("Abrir").onClick(() => void this.plugin.openStats()));
    new Setting(containerEl).setName("Exportar destaques").setDesc("Atualiza as notas Markdown de todos os livros.")
      .addButton((button) => button.setButtonText("Exportar").onClick(() => void this.plugin.exportAllHighlights(true)));
    new Setting(containerEl).setName("Importar edições das notas").setDesc("Lê comentários e etiquetas que você alterou nas notas Markdown exportadas.")
      .addButton((button) => button.setButtonText("Importar").onClick(() => void this.plugin.importHighlightsFromMarkdown()));
    new Setting(containerEl).setName("Restaurar configurações padrão").setDesc("Restaura apenas estas preferências; livros, destaques e marcadores não serão apagados.")
      .addButton((button) => button.setWarning().setButtonText("Restaurar").onClick(async () => { await this.plugin.resetSettings(); this.display(); }));
  }
}

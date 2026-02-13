import { ConfigPaths } from "../paths.js";
import fs from "fs/promises";
import path from "path";

export interface ModelEntry {
  providerID: string;
  modelID: string;
}

export interface ModelStoreData {
  recent: ModelEntry[];
  favorite: ModelEntry[];
  variant: Record<string, string>;
}

export class ModelStore {
  private data: ModelStoreData = {
    recent: [],
    favorite: [],
    variant: {},
  };
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(ConfigPaths.modelStore, "utf-8");
      const parsed = JSON.parse(content);
      this.data = {
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        favorite: Array.isArray(parsed.favorite) ? parsed.favorite : [],
        variant: typeof parsed.variant === "object" ? parsed.variant : {},
      };
      this.loaded = true;
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
        this.loaded = true;
        return;
      }
      console.warn("[ModelStore] Failed to load:", error);
      this.loaded = true;
    }
  }

  async save(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(ConfigPaths.modelStore);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(
      ConfigPaths.modelStore,
      JSON.stringify(this.data, null, 2)
    );
  }

  async getRecent(): Promise<ModelEntry[]> {
    await this.ensureLoaded();
    return this.data.recent;
  }

  async addRecent(providerID: string, modelID: string): Promise<void> {
    await this.ensureLoaded();
    this.data.recent = this.data.recent.filter(
      (m) => !(m.providerID === providerID && m.modelID === modelID)
    );
    this.data.recent.unshift({ providerID, modelID });
    this.data.recent = this.data.recent.slice(0, 10);
    await this.save();
  }

  async getFavorite(): Promise<ModelEntry[]> {
    await this.ensureLoaded();
    return this.data.favorite;
  }

  async toggleFavorite(providerID: string, modelID: string): Promise<boolean> {
    await this.ensureLoaded();
    const exists = this.data.favorite.some(
      (m) => m.providerID === providerID && m.modelID === modelID
    );

    if (exists) {
      this.data.favorite = this.data.favorite.filter(
        (m) => !(m.providerID === providerID && m.modelID === modelID)
      );
    } else {
      this.data.favorite.push({ providerID, modelID });
    }
    await this.save();
    return !exists;
  }

  async getVariant(providerID: string, modelID: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const key = `${providerID}/${modelID}`;
    return this.data.variant[key];
  }

  async setVariant(providerID: string, modelID: string, variant: string): Promise<void> {
    await this.ensureLoaded();
    const key = `${providerID}/${modelID}`;
    this.data.variant[key] = variant;
    await this.save();
  }

  async clear(): Promise<void> {
    this.data = { recent: [], favorite: [], variant: {} };
    await this.save();
  }
}

import { ConfigPaths } from "../paths.js";
import fs from "fs/promises";
import path from "path";

export interface EnvEntry {
  id: string;
  source: "local" | "global";
  selectedAt: number;  // timestamp
}

export interface EnvironmentStoreData {
  recent: EnvEntry[];
}

const MAX_RECENT = 5;

export class EnvironmentStore {
  private data: EnvironmentStoreData = {
    recent: [],
  };
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(ConfigPaths.envStore, "utf-8");
      const parsed = JSON.parse(content);
      this.data = {
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      };
      this.loaded = true;
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
        this.loaded = true;
        return;
      }
      console.warn("[EnvironmentStore] Failed to load:", error);
      this.loaded = true;
    }
  }

  async save(): Promise<void> {
    const dir = path.dirname(ConfigPaths.envStore);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(
      ConfigPaths.envStore,
      JSON.stringify(this.data, null, 2)
    );
  }

  async getRecent(): Promise<EnvEntry[]> {
    await this.ensureLoaded();
    return this.data.recent.slice(0, MAX_RECENT);
  }

  async addRecent(id: string, source: "local" | "global"): Promise<void> {
    await this.ensureLoaded();
    
    // Remove if already exists
    this.data.recent = this.data.recent.filter(e => e.id !== id);
    
    // Add to front
    this.data.recent.unshift({
      id,
      source,
      selectedAt: Date.now(),
    });
    
    // Keep only MAX_RECENT
    this.data.recent = this.data.recent.slice(0, MAX_RECENT);
    
    await this.save();
  }

  async clear(): Promise<void> {
    this.data.recent = [];
    await this.save();
  }
}

// Singleton instance
let envStoreInstance: EnvironmentStore | null = null;

export function getEnvironmentStore(): EnvironmentStore {
  if (!envStoreInstance) {
    envStoreInstance = new EnvironmentStore();
  }
  return envStoreInstance;
}

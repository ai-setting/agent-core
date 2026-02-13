import type { ConfigSource, ConfigSourceRegistry } from "./source.js";

class ConfigSourceRegistryImpl implements ConfigSourceRegistry {
  private sources: ConfigSource[] = [];

  register(source: ConfigSource): void {
    this.sources.push(source);
  }

  unregister(name: string): boolean {
    const index = this.sources.findIndex(s => s.name === name);
    if (index !== -1) {
      this.sources.splice(index, 1);
      return true;
    }
    return false;
  }

  clear(): void {
    this.sources.length = 0;
  }

  getSources(): ConfigSource[] {
    return [...this.sources].sort((a, b) => a.priority - b.priority);
  }

  /** 获取注册来源数量（用于测试） */
  size(): number {
    return this.sources.length;
  }
}

export const configRegistry = new ConfigSourceRegistryImpl();

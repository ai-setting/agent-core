import { configRegistry } from "./registry.js";
import type { Config } from "./types.js";
import { mergeDeep } from "./merge.js";
import { resolveConfig } from "./resolver.js";

export async function loadConfig(): Promise<Config.Info> {
  const sources = configRegistry.getSources();
  let result: Config.Info = {};

  for (const source of sources) {
    try {
      const loaded = await source.load();
      if (loaded) {
        console.log(`[Config] Loaded from "${source.name}"`);
        result = mergeDeep(result, loaded);
      }
    } catch (error) {
      console.warn(`[Config] Failed to load config from "${source.name}":`, error);
    }
  }

  // Resolve variable references like ${auth:provider-name} or ${ENV_VAR}
  return await resolveConfig(result);
}

import os from "os";
import path from "path";

const APP_NAME = "tong_work";

// Allow test to override the home directory dynamically
let _testHomeOverride: string | undefined = undefined;

export function Paths_setTestHome(home: string | undefined): void {
  _testHomeOverride = home;
}

export function Paths_clearTestHome(): void {
  _testHomeOverride = undefined;
}

function getHome(): string {
  const home = _testHomeOverride || process.env.AGENT_CORE_TEST_HOME || os.homedir();
  if (!home) {
    // Fallback to current working directory if no home is found
    return process.cwd();
  }
  return home;
}

function getXdgPaths(home: string) {
  // When test home is overridden, use simple fallback paths
  // Otherwise use xdg-basedir if available
  if (_testHomeOverride) {
    return {
      config: path.join(home, ".config"),
      state: path.join(home, ".local", "state"),
      data: path.join(home, ".local", "share"),
      cache: path.join(home, ".cache"),
    };
  }
  
  // For normal operation, try to use xdg-basedir
  try {
    const xdg = require("xdg-basedir");
    return {
      config: xdg.xdgConfig || path.join(home, ".config"),
      state: xdg.xdgState || path.join(home, ".local", "state"),
      data: xdg.xdgData || path.join(home, ".local", "share"),
      cache: xdg.xdgCache || path.join(home, ".cache"),
    };
  } catch {
    return {
      config: path.join(home, ".config"),
      state: path.join(home, ".local", "state"),
      data: path.join(home, ".local", "share"),
      cache: path.join(home, ".cache"),
    };
  }
}

function getPaths() {
  const _home = getHome();
  const xdg = getXdgPaths(_home);
  const _appDir = path.join(APP_NAME, "agent-core");

  return {
    home: _home,
    config: path.join(xdg.config, _appDir),
    state: path.join(xdg.state, _appDir),
    data: path.join(xdg.data, _appDir),
    cache: path.join(xdg.cache, _appDir),
    prompts: path.join(xdg.config, _appDir, "prompts"),
    environments: path.join(xdg.config, _appDir, "environments"),
    modelsCache: path.join(xdg.cache, _appDir, "models.json"),
    modelStore: path.join(xdg.state, _appDir, "model.json"),
    kvStore: path.join(xdg.state, _appDir, "kv.json"),
    authStore: path.join(xdg.data, _appDir, "auth.json"),
    mcpAuthStore: path.join(xdg.data, _appDir, "mcp-auth.json"),
    storage: path.join(xdg.data, _appDir, "storage"),
  };
}

class ConfigPathsClass {
  get home() { return getPaths().home; }
  get config() { return getPaths().config; }
  get state() { return getPaths().state; }
  get data() { return getPaths().data; }
  get cache() { return getPaths().cache; }
  get prompts() { return getPaths().prompts; }
  get environments() { return getPaths().environments; }
  get modelsCache() { return getPaths().modelsCache; }
  get modelStore() { return getPaths().modelStore; }
  get kvStore() { return getPaths().kvStore; }
  get authStore() { return getPaths().authStore; }
  get mcpAuthStore() { return getPaths().mcpAuthStore; }
  get storage() { return getPaths().storage; }
}

export const ConfigPaths = new ConfigPathsClass();

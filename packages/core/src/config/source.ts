import type { Config } from "./types.js";

export interface ConfigSource {
  /** 来源标识，用于日志和排查 */
  readonly name: string;

  /** 优先级：低 = 先加载，高 = 后加载（覆盖前者） */
  readonly priority: number;

  /** 加载配置，返回 null 表示跳过 */
  load(): Promise<Config.Info | null>;
}

export interface ConfigSourceRegistry {
  /** 注册配置来源 */
  register(source: ConfigSource): void;

  /** 清空所有已注册来源 */
  clear(): void;

  /** 获取已注册并按优先级排序的来源列表 */
  getSources(): ConfigSource[];
}

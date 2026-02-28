export interface TraceConfig {
  /** span 存储路径，默认使用 ConfigPaths.traces */
  storagePath?: string;

  /** 是否启用追踪，默认 true */
  enabled?: boolean;

  /** 是否记录返回值，默认 false（避免大对象） */
  recordResult?: boolean;

  /** 是否记录参数，默认 true */
  recordParams?: boolean;

  /** 是否打印 enter/quit/error 日志到 server.log，默认 false */
  log?: boolean;

  /** 日志和 trace 中参数/结果的最大截取长度，默认 500 字符 */
  maxLogSize?: number;
}

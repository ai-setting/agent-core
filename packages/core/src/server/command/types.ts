/**
 * @fileoverview Command Types - Command 接口定义
 *
 * 定义 Command 机制的核心类型
 */

import type { ServerEnvironment } from "../environment.js";

/**
 * Command 接口 - 定义一个可执行的命令
 */
export interface Command {
  /** Command 名称，用于触发（如 "echo" 对应 "/echo"） */
  name: string;

  /** 显示名称 */
  displayName?: string;

  /** 描述 */
  description: string;

  /** 是否支持参数 */
  hasArgs?: boolean;

  /** 参数描述（用于提示） */
  argsDescription?: string;

  /** 执行函数 */
  execute: (context: CommandContext, args: string) => Promise<CommandResult>;
}

/**
 * Command 执行上下文
 */
export interface CommandContext {
  /** Session ID，如果为 undefined 则为全局执行 */
  sessionId?: string;

  /** ServerEnvironment 实例 */
  env: ServerEnvironment;
}

/**
 * Command 执行结果
 */
export interface CommandResult {
  /** 是否成功 */
  success: boolean;

  /** 返回消息 */
  message?: string;

  /** 附加数据 */
  data?: unknown;
}

/**
 * 用于前端显示的 Command 信息（不包含 execute 函数）
 */
export interface CommandInfo {
  name: string;
  displayName?: string;
  description: string;
  hasArgs?: boolean;
  argsDescription?: string;
}

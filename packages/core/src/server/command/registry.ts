/**
 * @fileoverview Command Registry - Command 注册中心
 *
 * 管理所有可用 Command 的注册、获取和列表
 */

import type { Command, CommandInfo } from "./types.js";

/**
 * Command 注册中心 - 单例模式
 */
export class CommandRegistry {
  private commands = new Map<string, Command>();
  private static instance: CommandRegistry;

  /**
   * 获取 CommandRegistry 单例实例
   */
  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  /**
   * 注册一个 Command
   */
  register(command: Command): void {
    if (this.commands.has(command.name)) {
      console.warn(`[CommandRegistry] Command '${command.name}' already exists, overwriting`);
    }
    this.commands.set(command.name, command);
    console.log(`[CommandRegistry] Registered command: ${command.name}`);
  }

  /**
   * 取消注册一个 Command
   */
  unregister(name: string): boolean {
    const deleted = this.commands.delete(name);
    if (deleted) {
      console.log(`[CommandRegistry] Unregistered command: ${name}`);
    }
    return deleted;
  }

  /**
   * 获取指定名称的 Command
   */
  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * 获取所有 Command 列表
   */
  list(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * 获取所有 Command 的 Info 列表（用于前端展示）
   */
  listInfo(): CommandInfo[] {
    return this.list().map(cmd => ({
      name: cmd.name,
      displayName: cmd.displayName,
      description: cmd.description,
      hasArgs: cmd.hasArgs,
      argsDescription: cmd.argsDescription,
    }));
  }

  /**
   * 检查是否存在指定 Command
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * 清空所有 Command
   */
  clear(): void {
    this.commands.clear();
    console.log("[CommandRegistry] All commands cleared");
  }
}

/**
 * @fileoverview Session Filtering Utilities
 * 
 * 统一的 Session 和 Message 过滤逻辑
 * 被 CLI (离线/在线模式) 和服务端 API 共用
 */

import type { MessageWithParts } from "../core/session/types.js";

/**
 * 时间过滤选项
 */
export interface TimeFilterOptions {
  startTime?: number;
  endTime?: number;
}

/**
 * 列表过滤选项
 */
export interface ListFilterOptions {
  limit?: number;
  offset?: number;
}

/**
 * 消息过滤结果
 */
export interface MessageFilterResult {
  messages: any[];
  total: number;
}

/**
 * Session 信息
 */
export interface SessionInfo {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Session 过滤结果
 */
export interface SessionFilterResult {
  sessions: SessionInfo[];
  total: number;
}

/**
 * 解析时间范围字符串
 * 格式: "2026-01-01" -> 当天 00:00:00 UTC
 * 格式: "2026-01-01 00:00:00" -> 精确时间 (本地时间转换为 UTC)
 * 
 * 注意: 存储的时间是 UTC 时间戳，所以需要将输入转换为 UTC 时间戳
 */
export function parseTimeRange(startTimeStr?: string, endTimeStr?: string): {
  startTime?: number;
  endTime?: number;
} {
  const result: { startTime?: number; endTime?: number } = {};

  if (startTimeStr) {
    const date = parseToUTC(startTimeStr);
    if (date) {
      result.startTime = date.getTime();
    } else {
      console.warn(`Invalid startTime format: ${startTimeStr}, expected "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"`);
    }
  }

  if (endTimeStr) {
    const date = parseToUTC(endTimeStr, true);
    if (date) {
      result.endTime = date.getTime();
    } else {
      console.warn(`Invalid endTime format: ${endTimeStr}, expected "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"`);
    }
  }

  return result;
}

/**
 * 将日期时间字符串解析为 UTC Date 对象
 */
function parseToUTC(str: string, isEndTime?: boolean): Date | null {
  // 如果是 ISO 格式 (包含 T 或 Z)，直接解析
  if (str.includes("T") || str.includes("Z")) {
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
  }

  // 如果有时间部分 (包含 :)
  if (str.includes(":")) {
    const [datePart, timePart] = str.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute, second] = timePart.split(":").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return isNaN(date.getTime()) ? null : date;
  }

  // 只有日期部分 "YYYY-MM-DD"
  const [year, month, day] = str.split("-").map(Number);
  if (isEndTime) {
    const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    return isNaN(date.getTime()) ? null : date;
  } else {
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    return isNaN(date.getTime()) ? null : date;
  }
}

/**
 * 过滤 Session 列表
 */
export function filterSessions(
  sessions: SessionInfo[],
  options: {
    timeRange?: TimeFilterOptions;
    query?: string;
  } & ListFilterOptions
): SessionFilterResult {
  let result = [...sessions];

  // 时间过滤
  if (options.timeRange?.startTime !== undefined) {
    result = result.filter(s => 
      (s.createdAt ?? 0) >= (options.timeRange!.startTime ?? 0)
    );
  }
  if (options.timeRange?.endTime !== undefined) {
    result = result.filter(s => 
      (s.createdAt ?? 0) <= (options.timeRange!.endTime ?? Number.MAX_SAFE_INTEGER)
    );
  }

  // 标题过滤
  if (options.query) {
    const lowerQuery = options.query.toLowerCase();
    result = result.filter(s => 
      s.title?.toLowerCase().includes(lowerQuery)
    );
  }

  const total = result.length;

  // 分页
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  result = result.slice(offset, offset + limit);

  return { sessions: result, total };
}

/**
 * 过滤 Messages
 * @param messages - Message 数组或可迭代对象
 * @param options - 过滤选项
 */
export function filterMessages(
  messages: MessageWithParts[] | Iterable<MessageWithParts>,
  options: {
    timeRange?: TimeFilterOptions;
  } & ListFilterOptions
): MessageFilterResult {
  // 确保是数组
  const msgArray = Array.isArray(messages) 
    ? [...messages] 
    : Array.from(messages);

  let result = msgArray;

  // 时间过滤 - 先排序确保时间顺序正确
  if (options.timeRange?.startTime !== undefined || options.timeRange?.endTime !== undefined) {
    result.sort((a, b) => a.info.timestamp - b.info.timestamp);
    result = result.filter(m => {
      const ts = m.info.timestamp;
      if (options.timeRange!.startTime !== undefined && ts < options.timeRange!.startTime!) return false;
      if (options.timeRange!.endTime !== undefined && ts > options.timeRange!.endTime!) return false;
      return true;
    });
  }

  const total = result.length;

  // 限制数量 - 获取最新的 N 条
  const limit = options.limit ?? 50;
  if (result.length > limit) {
    result = result.slice(-limit);
  }

  return { messages: result, total };
}

/**
 * 搜索 Messages 中的关键字
 */
export function searchMessages(
  messages: MessageWithParts[] | Iterable<MessageWithParts>,
  query: string,
  options?: ListFilterOptions
): MessageFilterResult {
  // 确保是数组
  const msgArray = Array.isArray(messages) 
    ? [...messages] 
    : Array.from(messages);

  const lowerQuery = query.toLowerCase();
  const matches: MessageWithParts[] = [];

  for (const msg of msgArray) {
    const content = (msg.parts || [])
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n")
      .toLowerCase();
    
    if (content.includes(lowerQuery)) {
      matches.push(msg);
    }
  }

  const total = matches.length;

  // 限制数量
  const limit = options?.limit ?? 10;
  const result = matches.slice(0, limit);

  return { messages: result, total };
}

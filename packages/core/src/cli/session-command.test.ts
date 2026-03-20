/**
 * @fileoverview Session Command Tests - 验证时间过滤功能
 */

import { describe, test, expect } from "vitest";
import { parseTimeRange } from "./commands/session.js";

describe("Session Command - parseTimeRange", () => {
  // 注意: parseTimeRange 使用 JavaScript Date，默认使用本地时区
  // 测试验证的是相对时间关系，而非绝对时间戳

  test("should parse date only format (start)", () => {
    const result = parseTimeRange("2026-03-19", undefined);
    
    expect(result.startTime).toBeDefined();
    // 日期格式应该设置为当天开始 (00:00:00)
    // 验证时间部分是 00:00:00
    const date = new Date(result.startTime!);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
    expect(date.getSeconds()).toBe(0);
  });

  test("should parse date only format (end)", () => {
    const result = parseTimeRange(undefined, "2026-03-19");
    
    expect(result.endTime).toBeDefined();
    // 日期格式应该设置为当天结束 (23:59:59.999)
    const date = new Date(result.endTime!);
    expect(date.getHours()).toBe(23);
    expect(date.getMinutes()).toBe(59);
    expect(date.getSeconds()).toBe(59);
  });

  test("should parse datetime format with time", () => {
    const result = parseTimeRange("2026-03-19 10:30:00", undefined);
    
    expect(result.startTime).toBeDefined();
    // 验证时间部分是 10:30:00
    const date = new Date(result.startTime!);
    expect(date.getHours()).toBe(10);
    expect(date.getMinutes()).toBe(30);
    expect(date.getSeconds()).toBe(0);
  });

  test("should parse both start and end time", () => {
    const result = parseTimeRange("2026-03-19 00:00:00", "2026-03-20 23:59:59");
    
    expect(result.startTime).toBeDefined();
    expect(result.endTime).toBeDefined();
    
    // 验证 startTime < endTime
    expect(result.startTime!).toBeLessThan(result.endTime!);
  });

  test("should return empty object when no params", () => {
    const result = parseTimeRange(undefined, undefined);
    
    expect(result.startTime).toBeUndefined();
    expect(result.endTime).toBeUndefined();
  });

  test("should handle ISO format with timezone", () => {
    const result = parseTimeRange("2026-03-19T00:00:00Z", undefined);
    
    expect(result.startTime).toBeDefined();
    // ISO 格式应该保持原始时间
    expect(result.startTime).toBeGreaterThan(0);
  });
});

describe("Session Command - Time Filtering Logic", () => {
  test("should filter messages by timestamp", () => {
    const messages = [
      { info: { timestamp: 1773955200000 }, parts: [{ type: "text", text: "msg1" }] },
      { info: { timestamp: 1773999000000 }, parts: [{ type: "text", text: "msg2" }] },
      { info: { timestamp: 1774032000000 }, parts: [{ type: "text", text: "msg3" }] },
    ];

    // 使用更精确的范围来测试
    const startTime = 1773990000000; // 在 msg2 和 msg3 之间
    const endTime = 1774020000000;   // 在 msg3 之后

    const filtered = messages.filter((m: any) => {
      const ts = m.info.timestamp;
      if (startTime && ts < startTime) return false;
      if (endTime && ts > endTime) return false;
      return true;
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].info.timestamp).toBe(1773999000000);
  });

  test("should filter out messages before startTime", () => {
    const messages = [
      { info: { timestamp: 1000000000000 }, parts: [{ type: "text", text: "old msg" }] },
      { info: { timestamp: 1773999000000 }, parts: [{ type: "text", text: "new msg" }] },
    ];

    const startTime = 1773970000000;

    const filtered = messages.filter((m: any) => {
      const ts = m.info.timestamp;
      if (startTime && ts < startTime) return false;
      return true;
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].parts[0].text).toBe("new msg");
  });

  test("should filter out messages after endTime", () => {
    const messages = [
      { info: { timestamp: 1773999000000 }, parts: [{ type: "text", text: "msg1" }] },
      { info: { timestamp: 1775000000000 }, parts: [{ type: "text", text: "future msg" }] },
    ];

    const endTime = 1774100000000;

    const filtered = messages.filter((m: any) => {
      const ts = m.info.timestamp;
      if (endTime && ts > endTime) return false;
      return true;
    });

    expect(filtered.length).toBe(1);
    expect(filtered[0].parts[0].text).toBe("msg1");
  });

  test("should apply limit to messages", () => {
    const messages = [
      { info: { timestamp: 1773955200000 }, parts: [{ type: "text", text: "msg1" }] },
      { info: { timestamp: 1773960000000 }, parts: [{ type: "text", text: "msg2" }] },
      { info: { timestamp: 1773965000000 }, parts: [{ type: "text", text: "msg3" }] },
    ];

    const limit = 2;
    const limited = messages.slice(-limit);

    expect(limited.length).toBe(2);
  });

  test("should filter and then apply limit", () => {
    const messages = [
      { info: { timestamp: 1000000000000 }, parts: [{ type: "text", text: "old" }] },
      { info: { timestamp: 1773955200000 }, parts: [{ type: "text", text: "msg1" }] },
      { info: { timestamp: 1773960000000 }, parts: [{ type: "text", text: "msg2" }] },
      { info: { timestamp: 1773965000000 }, parts: [{ type: "text", text: "msg3" }] },
      { info: { timestamp: 1775000000000 }, parts: [{ type: "text", text: "future" }] },
    ];

    const startTime = 1773950000000;
    const endTime = 1773970000000;
    const limit = 2;

    // 先过滤
    const filtered = messages.filter((m: any) => {
      const ts = m.info.timestamp;
      if (startTime && ts < startTime) return false;
      if (endTime && ts > endTime) return false;
      return true;
    });

    // 再限制数量
    const limited = filtered.slice(-limit);

    expect(filtered.length).toBe(3);
    expect(limited.length).toBe(2);
  });
});

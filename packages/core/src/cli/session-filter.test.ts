/**
 * @fileoverview Session Filter Tests - 验证统一过滤逻辑
 */

import { describe, test, expect } from "vitest";
import { 
  filterSessions, 
  filterMessages, 
  searchMessages,
  TimeFilterOptions,
  ListFilterOptions
} from "./session-filter.js";

describe("Session Filter - filterSessions", () => {
  const mockSessions = [
    { id: "s1", title: "Session A", createdAt: 1773955200000 },  // 2026-03-19
    { id: "s2", title: "Session B", createdAt: 1773971800000 },  // 2026-03-20
    { id: "s3", title: "Session C", createdAt: 1773980000000 },  // 2026-03-20 later
  ];

  test("should filter by time range (start)", () => {
    const result = filterSessions(mockSessions, {
      timeRange: { startTime: 1773960000000 }  // 2026-03-20
    });
    
    expect(result.sessions.length).toBe(2);
    expect(result.total).toBe(2);
  });

  test("should filter by time range (end)", () => {
    const result = filterSessions(mockSessions, {
      timeRange: { endTime: 1773960000000 }
    });
    
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].id).toBe("s1");
  });

  test("should filter by time range (both)", () => {
    const result = filterSessions(mockSessions, {
      timeRange: { startTime: 1773960000000, endTime: 1773975000000 }
    });
    
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].id).toBe("s2");
  });

  test("should apply limit", () => {
    const result = filterSessions(mockSessions, {
      limit: 2
    });
    
    expect(result.sessions.length).toBe(2);
  });

  test("should filter by query", () => {
    const result = filterSessions(mockSessions, {
      query: "session b"
    });
    
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].id).toBe("s2");
  });
});

describe("Session Filter - filterMessages", () => {
  const mockMessages = [
    { info: { timestamp: 1773955200000 }, parts: [{ type: "text", text: "msg1" }] },
    { info: { timestamp: 1773971800000 }, parts: [{ type: "text", text: "msg2" }] },
    { info: { timestamp: 1773980000000 }, parts: [{ type: "text", text: "msg3" }] },
  ] as any[];

  test("should filter by time range (start)", () => {
    const result = filterMessages(mockMessages, {
      timeRange: { startTime: 1773960000000 }
    });
    
    expect(result.messages.length).toBe(2);
  });

  test("should filter by time range (both)", () => {
    const result = filterMessages(mockMessages, {
      timeRange: { startTime: 1773960000000, endTime: 1773975000000 }
    });
    
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].info.timestamp).toBe(1773971800000);
  });

  test("should apply limit", () => {
    const result = filterMessages(mockMessages, {
      limit: 2
    });
    
    // 默认获取最新的 N 条
    expect(result.messages.length).toBe(2);
  });

  test("should handle non-array iterable", () => {
    // 测试 Set 迭代器
    const msgSet = new Set([
      { info: { timestamp: 1773955200000, id: "m1", sessionID: "s1", role: "user" }, parts: [{ type: "text", text: "msg1" }] },
      { info: { timestamp: 1773971800000, id: "m2", sessionID: "s1", role: "assistant" }, parts: [{ type: "text", text: "msg2" }] },
    ]);
    
    const result = filterMessages(msgSet, {
      limit: 1
    });
    
    expect(result.messages.length).toBe(1);
  });
});

describe("Session Filter - searchMessages", () => {
  const mockMessages = [
    { info: { timestamp: 1773955200000 }, parts: [{ type: "text", text: "Hello world" }] },
    { info: { timestamp: 1773971800000 }, parts: [{ type: "text", text: "Test message" }] },
    { info: { timestamp: 1773980000000 }, parts: [{ type: "text", text: "Hello again" }] },
  ] as any[];

  test("should search by keyword", () => {
    const result = searchMessages(mockMessages, "hello");
    
    expect(result.messages.length).toBe(2);
    expect(result.total).toBe(2);
  });

  test("should search case insensitive", () => {
    const result = searchMessages(mockMessages, "TEST");
    
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].info.timestamp).toBe(1773971800000);
  });

  test("should apply limit", () => {
    const result = searchMessages(mockMessages, "hello", { limit: 1 });
    
    expect(result.messages.length).toBe(1);
  });
});

/**
 * @fileoverview Unit tests for withEventHook and withEventHookVoid
 */

import { describe, it, expect } from "bun:test";
import { withEventHook, withEventHookVoid } from "./with-event-hook.js";

describe("withEventHook", () => {
  it("should invoke before hook before function execution", () => {
    const order: string[] = [];
    const fn = withEventHook(
      (x: number) => {
        order.push("fn");
        return x + 1;
      },
      {
        before: () => order.push("before"),
        after: () => order.push("after"),
      }
    );

    const result = fn(1);
    expect(result).toBe(2);
    expect(order).toEqual(["before", "fn", "after"]);
  });

  it("should invoke after hook with result and args", () => {
    let receivedSelf: any;
    let receivedResult: number | undefined;
    let receivedArgs: number[] = [];

    const ctx = { id: "ctx-1" };
    const fn = withEventHook(
      function (this: typeof ctx, x: number, y: number) {
        return x + y;
      },
      {
        after: (self, result, ...args) => {
          receivedSelf = self;
          receivedResult = result;
          receivedArgs = args;
        },
      }
    );

    const result = fn.call(ctx, 2, 3);
    expect(result).toBe(5);
    expect(receivedSelf).toBe(ctx);
    expect(receivedSelf.id).toBe("ctx-1");
    expect(receivedResult).toBe(5);
    expect(receivedArgs).toEqual([2, 3]);
  });

  it("should support before-only hook", () => {
    let beforeCalled = false;
    const fn = withEventHook(
      () => 42,
      { before: () => { beforeCalled = true; } }
    );
    expect(fn()).toBe(42);
    expect(beforeCalled).toBe(true);
  });

  it("should support after-only hook", () => {
    let afterResult: number | undefined;
    const fn = withEventHook(
      () => 99,
      { after: (_self, result) => { afterResult = result; } }
    );
    expect(fn()).toBe(99);
    expect(afterResult).toBe(99);
  });

  it("should support async function", async () => {
    const order: string[] = [];
    const fn = withEventHook(
      async (x: number) => {
        order.push("fn");
        return x * 2;
      },
      {
        before: () => order.push("before"),
        after: () => order.push("after"),
      }
    );

    const result = await fn(5);
    expect(result).toBe(10);
    expect(order).toEqual(["before", "fn", "after"]);
  });

  it("should propagate async result correctly", async () => {
    let capturedResult: string | undefined;
    const fn = withEventHook(
      async (msg: string) => {
        await new Promise((r) => setTimeout(r, 0));
        return `echo: ${msg}`;
      },
      { after: (_self, result) => { capturedResult = result; } }
    );

    const result = await fn("hello");
    expect(result).toBe("echo: hello");
    expect(capturedResult).toBe("echo: hello");
  });

  it("should propagate errors (not swallow them)", () => {
    const fn = withEventHook(
      () => { throw new Error("test error"); },
      { after: () => {} }
    );
    expect(() => fn()).toThrow("test error");
  });

  it("should propagate async errors", async () => {
    const fn = withEventHook(
      async () => { throw new Error("async error"); },
      { after: () => {} }
    );
    await expect(fn()).rejects.toThrow("async error");
  });
});

describe("withEventHookVoid", () => {
  it("should return void for sync function", () => {
    let afterResult: number | undefined;
    const fn = withEventHookVoid(
      (x: number, y: number): number => x + y,
      {
        after: (_self, result) => { afterResult = result; },
      }
    );

    const result = fn(1, 2);
    expect(result).toBeUndefined();
    expect(afterResult).toBe(3);
  });

  it("should return void (Promise) for async function", async () => {
    let afterResult: { deleted: boolean } | undefined;
    const fn = withEventHookVoid(
      async (id: string): Promise<{ deleted: boolean }> => {
        return { deleted: id.length > 0 };
      },
      {
        after: (_self, result) => { afterResult = result; },
      }
    );

    const result = await fn("ses_123");
    expect(result).toBeUndefined();
    expect(afterResult).toEqual({ deleted: true });
  });

  it("should allow conditional emit based on inner result", () => {
    const emitted: string[] = [];
    const fn = withEventHookVoid(
      (id: string): { deleted: boolean; sessionId: string } => {
        if (id === "valid") {
          return { deleted: true, sessionId: id };
        }
        return { deleted: false, sessionId: id };
      },
      {
        after: (_self, result) => {
          if (result.deleted) {
            emitted.push(`deleted: ${result.sessionId}`);
          }
        },
      }
    );

    fn("valid");
    expect(emitted).toEqual(["deleted: valid"]);

    emitted.length = 0;
    fn("invalid");
    expect(emitted).toEqual([]);
  });

  it("should invoke before hook", () => {
    const order: string[] = [];
    const fn = withEventHookVoid(
      () => true,
      {
        before: () => order.push("before"),
        after: () => order.push("after"),
      }
    );
    fn();
    expect(order).toEqual(["before", "after"]);
  });

  it("should preserve this context in hooks", () => {
    const ctx = { name: "test-ctx", count: 0 };
    const fn = withEventHookVoid(
      () => ({ ok: true }),
      {
        after: (self) => {
          (self as any).count++;
        },
      }
    );
    fn.call(ctx);
    expect(ctx.count).toBe(1);
  });
});

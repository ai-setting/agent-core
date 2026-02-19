/**
 * @fileoverview Unit tests for SessionAbortManager
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { SessionAbortManager } from "./abort-manager.js";

describe("SessionAbortManager", () => {
  let manager: SessionAbortManager;

  beforeEach(() => {
    manager = new SessionAbortManager();
  });

  describe("create", () => {
    it("should create an AbortController for a session", () => {
      const controller = manager.create("session-1");
      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(AbortController);
    });

    it("should allow multiple sessions", () => {
      const ctrl1 = manager.create("session-1");
      const ctrl2 = manager.create("session-2");
      expect(ctrl1).not.toBe(ctrl2);
    });
  });

  describe("has", () => {
    it("should return false for non-existent session", () => {
      expect(manager.has("non-existent")).toBe(false);
    });

    it("should return true after create", () => {
      manager.create("session-1");
      expect(manager.has("session-1")).toBe(true);
    });

    it("should return false after abort", () => {
      manager.create("session-1");
      manager.abort("session-1");
      expect(manager.has("session-1")).toBe(false);
    });

    it("should return false after remove", () => {
      manager.create("session-1");
      manager.remove("session-1");
      expect(manager.has("session-1")).toBe(false);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent session", () => {
      expect(manager.get("non-existent")).toBeUndefined();
    });

    it("should return the AbortSignal after create", () => {
      const ctrl = manager.create("session-1");
      const signal = manager.get("session-1");
      expect(signal).toBe(ctrl.signal);
    });
  });

  describe("abort", () => {
    it("should abort the session", () => {
      manager.create("session-1");
      const signal = manager.get("session-1");
      
      let aborted = false;
      if (signal) {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }
      
      manager.abort("session-1");
      expect(aborted).toBe(true);
    });

    it("should remove controller after abort", () => {
      manager.create("session-1");
      manager.abort("session-1");
      expect(manager.get("session-1")).toBeUndefined();
    });

    it("should handle aborting non-existent session gracefully", () => {
      expect(() => {
        manager.abort("non-existent");
      }).not.toThrow();
    });

    it("should allow abort signal to be used with fetch", () => {
      manager.create("session-1");
      const signal = manager.get("session-1");
      
      let aborted = false;
      if (signal) {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }
      
      manager.abort("session-1");
      
      expect(aborted).toBe(true);
    });
  });

  describe("remove", () => {
    it("should remove controller without triggering abort", () => {
      manager.create("session-1");
      const signal = manager.get("session-1");
      
      let aborted = false;
      if (signal) {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }
      
      manager.remove("session-1");
      expect(aborted).toBe(false);
      expect(manager.get("session-1")).toBeUndefined();
    });

    it("should handle removing non-existent session gracefully", () => {
      expect(() => {
        manager.remove("non-existent");
      }).not.toThrow();
    });
  });
});

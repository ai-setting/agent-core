/**
 * @fileoverview Tests for LSP language module
 */

import { describe, it, expect } from "bun:test";
import {
  LANGUAGE_EXTENSIONS,
  needsLSPDiagnostics,
  getLanguageId,
  getSupportedExtensions,
} from "./language.js";

describe("language.ts", () => {
  describe("LANGUAGE_EXTENSIONS", () => {
    it("should map .ts to typescript", () => {
      expect(LANGUAGE_EXTENSIONS[".ts"]).toBe("typescript");
    });

    it("should map .py to python", () => {
      expect(LANGUAGE_EXTENSIONS[".py"]).toBe("python");
    });

    it("should map .go to go", () => {
      expect(LANGUAGE_EXTENSIONS[".go"]).toBe("go");
    });

    it("should map .md to markdown", () => {
      expect(LANGUAGE_EXTENSIONS[".md"]).toBe("markdown");
    });

    it("should map .markdown to markdown", () => {
      expect(LANGUAGE_EXTENSIONS[".markdown"]).toBe("markdown");
    });

    it("should map various markdown extensions", () => {
      expect(LANGUAGE_EXTENSIONS[".mdown"]).toBe("markdown");
      expect(LANGUAGE_EXTENSIONS[".mkd"]).toBe("markdown");
      expect(LANGUAGE_EXTENSIONS[".mkdn"]).toBe("markdown");
      expect(LANGUAGE_EXTENSIONS[".mdwn"]).toBe("markdown");
      expect(LANGUAGE_EXTENSIONS[".mdtxt"]).toBe("markdown");
      expect(LANGUAGE_EXTENSIONS[".mdtext"]).toBe("markdown");
    });
  });

  describe("needsLSPDiagnostics", () => {
    it("should return true for TypeScript files", () => {
      expect(needsLSPDiagnostics("/path/to/file.ts")).toBe(true);
      expect(needsLSPDiagnostics("/path/to/file.tsx")).toBe(true);
      expect(needsLSPDiagnostics("/path/to/file.mts")).toBe(true);
    });

    it("should return true for Python files", () => {
      expect(needsLSPDiagnostics("/path/to/file.py")).toBe(true);
      expect(needsLSPDiagnostics("/path/to/file.pyi")).toBe(true);
    });

    it("should return true for Go files", () => {
      expect(needsLSPDiagnostics("/path/to/file.go")).toBe(true);
    });

    it("should return true for Rust files", () => {
      expect(needsLSPDiagnostics("/path/to/file.rs")).toBe(true);
    });

    it("should return true for Markdown files", () => {
      expect(needsLSPDiagnostics("/path/to/file.md")).toBe(true);
      expect(needsLSPDiagnostics("/path/to/file.markdown")).toBe(true);
      expect(needsLSPDiagnostics("/path/to/file.mdown")).toBe(true);
      expect(needsLSPDiagnostics("/path/to/file.mkd")).toBe(true);
    });

    it("should return false for text files", () => {
      expect(needsLSPDiagnostics("/path/to/file.txt")).toBe(false);
    });

    it("should return false for JSON files", () => {
      expect(needsLSPDiagnostics("/path/to/file.json")).toBe(false);
    });

    it("should return false for YAML files", () => {
      expect(needsLSPDiagnostics("/path/to/file.yaml")).toBe(false);
      expect(needsLSPDiagnostics("/path/to/file.yml")).toBe(false);
    });

    it("should handle uppercase extensions", () => {
      expect(needsLSPDiagnostics("/path/to/file.TS")).toBe(true);
      expect(needsLSPDiagnostics("/path/to/file.PY")).toBe(true);
    });
  });

  describe("getLanguageId", () => {
    it("should return language ID for TypeScript files", () => {
      expect(getLanguageId("/path/to/file.ts")).toBe("typescript");
      expect(getLanguageId("/path/to/file.tsx")).toBe("typescript");
    });

    it("should return language ID for Python files", () => {
      expect(getLanguageId("/path/to/file.py")).toBe("python");
    });

    it("should return language ID for Markdown files", () => {
      expect(getLanguageId("/path/to/file.md")).toBe("markdown");
      expect(getLanguageId("/path/to/file.markdown")).toBe("markdown");
      expect(getLanguageId("/path/to/file.mdown")).toBe("markdown");
    });

    it("should return undefined for unknown extensions", () => {
      expect(getLanguageId("/path/to/file.unknown")).toBeUndefined();
    });
  });

  describe("getSupportedExtensions", () => {
    it("should return an array of extensions", () => {
      const extensions = getSupportedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
    });

    it("should include common code extensions", () => {
      const extensions = getSupportedExtensions();
      expect(extensions).toContain(".ts");
      expect(extensions).toContain(".py");
      expect(extensions).toContain(".go");
      expect(extensions).toContain(".rs");
    });

    it("should include markdown extensions", () => {
      const extensions = getSupportedExtensions();
      expect(extensions).toContain(".md");
      expect(extensions).toContain(".markdown");
      expect(extensions).toContain(".mdown");
      expect(extensions).toContain(".mkd");
    });
  });
});

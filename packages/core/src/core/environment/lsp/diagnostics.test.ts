/**
 * @fileoverview Tests for LSP diagnostics module
 */

import { describe, it, expect } from "bun:test";
import {
  formatDiagnostic,
  filterBySeverity,
  getErrors,
  type LSPDiagnostic,
  type DiagnosticSeverity,
} from "./diagnostics.js";

describe("diagnostics.ts", () => {
  describe("formatDiagnostic", () => {
    it("should format error diagnostic", () => {
      const diagnostic: LSPDiagnostic = {
        range: {
          start: { line: 9, character: 4 },
          end: { line: 9, character: 7 },
        },
        severity: 1,
        message: "Cannot find name 'foo'",
        source: "typescript",
      };

      const result = formatDiagnostic(diagnostic);
      expect(result).toBe("ERROR [10:5] Cannot find name 'foo'");
    });

    it("should format warning diagnostic", () => {
      const diagnostic: LSPDiagnostic = {
        range: {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 10 },
        },
        severity: 2,
        message: "Unused variable 'x'",
        source: "typescript",
      };

      const result = formatDiagnostic(diagnostic);
      expect(result).toBe("WARNING [6:1] Unused variable 'x'");
    });

    it("should format info diagnostic", () => {
      const diagnostic: LSPDiagnostic = {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        severity: 3,
        message: "Some info",
      };

      const result = formatDiagnostic(diagnostic);
      expect(result).toBe("INFO [1:1] Some info");
    });

    it("should format hint diagnostic", () => {
      const diagnostic: LSPDiagnostic = {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        severity: 4,
        message: "Did you mean?",
      };

      const result = formatDiagnostic(diagnostic);
      expect(result).toBe("HINT [1:1] Did you mean?");
    });
  });

  describe("filterBySeverity", () => {
    const diagnostics: LSPDiagnostic[] = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "Error 1" },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, severity: 2, message: "Warning 1" },
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }, severity: 3, message: "Info 1" },
      { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } }, severity: 1, message: "Error 2" },
    ];

    it("should filter to only errors", () => {
      const result = filterBySeverity(diagnostics, 1);
      expect(result.length).toBe(2);
      expect(result.every((d) => d.severity === 1)).toBe(true);
    });

    it("should filter to errors and warnings", () => {
      const result = filterBySeverity(diagnostics, 2);
      expect(result.length).toBe(3);
    });
  });

  describe("getErrors", () => {
    const diagnostics: LSPDiagnostic[] = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: "Error 1" },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, severity: 2, message: "Warning 1" },
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }, severity: 1, message: "Error 2" },
    ];

    it("should return only error diagnostics", () => {
      const result = getErrors(diagnostics);
      expect(result.length).toBe(2);
      expect(result.every((d) => d.severity === 1)).toBe(true);
    });
  });
});

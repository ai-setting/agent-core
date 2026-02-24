/**
 * @fileoverview LSP Diagnostic types and utilities
 */

export type DiagnosticSeverity = 1 | 2 | 3 | 4;

export const DiagnosticSeverityNames: Record<DiagnosticSeverity, string> = {
  1: "ERROR",
  2: "WARNING",
  3: "INFO",
  4: "HINT",
};

export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string | number;
}

/**
 * Format a diagnostic for display
 * @param diagnostic - The diagnostic to format
 * @returns Formatted string like "ERROR [10:5] Cannot find name 'foo'"
 */
export function formatDiagnostic(diagnostic: LSPDiagnostic): string {
  const severity = DiagnosticSeverityNames[diagnostic.severity] || "ERROR";
  const line = diagnostic.range.start.line + 1;
  const col = diagnostic.range.start.character + 1;
  return `${severity} [${line}:${col}] ${diagnostic.message}`;
}

/**
 * Filter diagnostics by severity
 * @param diagnostics - Array of diagnostics
 * @param minSeverity - Minimum severity to include (1 = Error, 4 = Hint)
 * @returns Filtered diagnostics
 */
export function filterBySeverity(
  diagnostics: LSPDiagnostic[],
  minSeverity: DiagnosticSeverity = 1
): LSPDiagnostic[] {
  return diagnostics.filter((d) => d.severity <= minSeverity);
}

/**
 * Get only error-level diagnostics
 * @param diagnostics - Array of diagnostics
 * @returns Error diagnostics
 */
export function getErrors(diagnostics: LSPDiagnostic[]): LSPDiagnostic[] {
  return filterBySeverity(diagnostics, 1);
}

/**
 * Group diagnostics by file
 * @param diagnostics - Array of diagnostics
 * @returns Map of file path to diagnostics
 */
export function groupByFile(
  diagnostics: Array<{ uri: string; diagnostics: LSPDiagnostic[] }>
): Record<string, LSPDiagnostic[]> {
  const result: Record<string, LSPDiagnostic[]> = {};
  for (const { uri, diagnostics: diags } of diagnostics) {
    result[uri] = diags;
  }
  return result;
}

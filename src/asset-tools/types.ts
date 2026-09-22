export const ASSET_TOOL_MAX_BYTES = 64 * 1024 * 1024;
export const ASSET_TOOL_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const ASSET_TOOL_MAX_FILES = 256;
export const ASSET_TOOL_MAX_ISSUES = 1000;
export const ASSET_TOOL_TIMEOUT_MS = 30_000;
export interface ValidationIssue { code: string; message: string; severity: number; pointer?: string; }
export interface ValidationReport {
  validatorVersion: string;
  uri?: string;
  issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: ValidationIssue[]; truncated: boolean };
  info?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface DiagnosticResult {
  report: ValidationReport;
  unsupportedExtensions: string[];
  durationMs: number;
}
export interface OptimizationResult extends DiagnosticResult {
  bytes: Uint8Array<ArrayBuffer>;
  inputBytes: number;
  outputBytes: number;
  reduced: boolean;
  /** Byte-based accounting estimate, not a measured JS/GPU memory peak. */
  estimatedWorkingBytes: number;
}
export interface AssetToolFile { file: File; path: string; }
export type AssetToolRequest =
  | { operation: "validate-files"; files: AssetToolFile[]; primaryIndex: number }
  | { operation: "validate-bytes" | "optimize"; bytes: Uint8Array<ArrayBuffer>; name: string };
export type AssetToolResponse = { ok: true; result: DiagnosticResult | OptimizationResult } | { ok: false; message: string };

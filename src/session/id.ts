/**
 * @fileoverview ID generator - OpenCode-compatible ID format.
 *
 * Format: {prefix}_{12-char hex timestamp}{14-char random base62}
 * Example: ses_abc123def456gh789ijk012
 *
 * Based on OpenCode's Identifier implementation.
 */

import { randomBytes } from "crypto";

type IDPrefix = "session" | "message" | "part";

const PREFIXES: Record<IDPrefix, string> = {
  session: "ses",
  message: "msg",
  part: "prt",
};

const ID_LENGTH = 26;

// State for monotonic ID generation
let lastTimestamp = 0;
let counter = 0;

/**
 * Generate a random base62 string of given length.
 */
function randomBase62(length: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % 62];
  }
  return result;
}

/**
 * Generate an ID with monotonic ordering.
 */
function generateID(prefix: IDPrefix, descending: boolean, timestamp?: number): string {
  const currentTimestamp = timestamp ?? Date.now();

  // Reset counter if timestamp changed
  if (currentTimestamp !== lastTimestamp) {
    lastTimestamp = currentTimestamp;
    counter = 0;
  }
  counter++;

  // Combine timestamp and counter
  let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter);

  // For descending order, invert the value
  if (descending) {
    now = ~now;
  }

  // Convert to 6 bytes
  const timeBytes = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff));
  }

  // Format: prefix + _ + hex timestamp + random base62
  return `${PREFIXES[prefix]}_${timeBytes.toString("hex")}${randomBase62(ID_LENGTH - 12)}`;
}

/**
 * Generate an ascending ID (time-ordered, newer IDs have larger values).
 */
export function ascending(prefix: IDPrefix): string {
  return generateID(prefix, false);
}

/**
 * Generate a descending ID (reverse time-ordered, newer IDs have smaller values).
 * Useful for sorting sessions by creation time in descending order.
 */
export function descending(prefix: IDPrefix): string {
  return generateID(prefix, true);
}

/**
 * Validate that an ID has the correct prefix.
 */
export function validate(id: string, prefix: IDPrefix): boolean {
  return id.startsWith(`${PREFIXES[prefix]}_`);
}

/**
 * Extract timestamp from an ascending ID.
 * Note: This does not work with descending IDs.
 */
export function extractTimestamp(id: string): number {
  const parts = id.split("_");
  if (parts.length < 2) {
    throw new Error("Invalid ID format");
  }
  const prefix = parts[0];
  const hex = id.slice(prefix.length + 1, prefix.length + 13);
  const encoded = BigInt("0x" + hex);
  return Number(encoded / BigInt(0x1000));
}

/**
 * Get the prefix type from an ID.
 */
export function getPrefix(id: string): IDPrefix | undefined {
  for (const [type, prefix] of Object.entries(PREFIXES)) {
    if (id.startsWith(prefix + "_")) {
      return type as IDPrefix;
    }
  }
  return undefined;
}

export const ID = {
  ascending,
  descending,
  validate,
  extractTimestamp,
  getPrefix,
} as const;

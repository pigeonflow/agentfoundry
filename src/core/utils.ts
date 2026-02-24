import crypto from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function splitPromptIntoAtomicUnits(prompt: string): string[] {
  const byLines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (byLines.length >= 2) {
    return byLines;
  }

  return prompt
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
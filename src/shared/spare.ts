const falseWords = new Set([
  "-",
  "0",
  "no",
  "n",
  "none",
  "not",
  "false",
  "f",
  "na",
  "n/a",
  "nil",
  "null",
  "ไม่มี",
  "ไม่",
  "ไม่มีของ",
  "ไม่มีอะไหล่",
  "ไม่ใช่",
  "ไม่พบ",
  "no spare",
  "no stock",
  "not have",
  "dont have",
  "don't have"
]);

const trueWords = new Set([
  "yes",
  "y",
  "true",
  "t",
  "ok",
  "okay",
  "available",
  "stock",
  "spare",
  "have",
  "has",
  "มี",
  "มีของ",
  "มีอะไหล่",
  "พร้อม",
  "ใช่"
]);

function normalizeSpareText(value: string): string {
  return value
    .replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)))
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactSpareText(value: string): string {
  return normalizeSpareText(value).replace(/[._/\\|()[\]{}:;,]+/g, " ").replace(/\s+/g, " ").trim();
}

export function hasSpareValue(value: string): boolean {
  const normalized = compactSpareText(value);

  if (!normalized || /^[-\s]+$/.test(normalized)) {
    return false;
  }

  if (falseWords.has(normalized)) {
    return false;
  }

  if (trueWords.has(normalized)) {
    return true;
  }

  const numericMatches = normalized.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return Number(normalized) > 0;
  }

  if (numericMatches.length) {
    const hasPositiveNumber = numericMatches.some((match) => Number(match) > 0);
    const hasOnlyZeroNumbers = numericMatches.every((match) => Number(match) === 0);

    if (hasPositiveNumber) {
      return true;
    }

    if (hasOnlyZeroNumbers) {
      return false;
    }
  }

  const words = normalized.split(/\s+/);
  if (words.some((word) => trueWords.has(word))) {
    return true;
  }

  if (words.some((word) => falseWords.has(word))) {
    return false;
  }

  return true;
}

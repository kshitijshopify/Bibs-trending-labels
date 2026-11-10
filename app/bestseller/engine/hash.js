import { createHash } from "node:crypto";

/** JSON.stringify with recursively sorted object keys (Sets become sorted arrays). */
export function stableStringify(value) {
  return JSON.stringify(normalise(value));
}

function normalise(value) {
  if (value instanceof Set) return [...value].map(normalise).sort();
  if (value instanceof Map) {
    return normalise(Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), v])));
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalise(value[key])]),
    );
  }
  return value;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function hashOf(value) {
  return sha256(stableStringify(value));
}

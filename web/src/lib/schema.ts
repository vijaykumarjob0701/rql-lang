export type FieldSketch = {
  key: string;
  kinds: string[];
  samples: unknown[];
};

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function inferPayloadSchema(payloads: Record<string, unknown>[], maxSamples = 3): FieldSketch[] {
  const map = new Map<string, FieldSketch>();
  for (const payload of payloads) {
    for (const [key, value] of Object.entries(payload)) {
      const existing = map.get(key) ?? { key, kinds: [], samples: [] };
      const kind = kindOf(value);
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      if (existing.samples.length < maxSamples) existing.samples.push(value);
      map.set(key, existing);
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function payloadFields(payloads: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const p of payloads) {
    for (const k of Object.keys(p)) keys.add(k);
  }
  return [...keys].sort();
}

export function colorForValue(value: unknown, palette: string[]): string {
  const key = value == null ? "∅" : String(value);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

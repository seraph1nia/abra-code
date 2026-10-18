/** Operational receipts retain identities and proof, not native/provider payloads. */
export function safeEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeEvidence);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            ![
              "prompt",
              "body",
              "content",
              "input",
              "output",
              "args",
              "attachments",
              "metadata",
              "messages",
              "context",
              "system",
              "authorization",
              "apiKey",
              "credentials",
            ].includes(key),
        )
        .map(([key, entry]) => [key, safeEvidence(entry)]),
    );
  if (typeof value === "string") {
    // Some native tool receipts carry an encoded structured output.
    if (value.startsWith("[") || value.startsWith("{")) {
      try {
        return safeEvidence(JSON.parse(value));
      } catch {
        /* Bounded ordinary evidence. */
      }
    }
    return value.slice(0, 8192);
  }
  return value;
}

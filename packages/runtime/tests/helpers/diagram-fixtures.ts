export function mixedDiagrams(count = 32) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Diagram ${i + 1}`,
    source: [
      `flowchart LR\nStart${i} <--> Evidence${i}`,
      `sequenceDiagram\nAbra${i}->>Worker${i}: Inspect retained evidence\nWorker${i}-->>Abra${i}: Findings`,
      `stateDiagram-v2\n[*] --> Captured${i}\nCaptured${i} --> [*]`,
      `classDiagram\nEvidence${i} <|-- Finding${i}`,
      `erDiagram\nTASK${i} ||--o{ FINDING${i} : retains`,
      `gantt\n dateFormat YYYY-MM-DD\n section Evidence ${i}\n Capture :a${i}, 2026-11-16, 1d`,
      `mindmap\n root((Report ${i}))\n  Evidence\n  Findings`,
    ][i % 7]!,
  }));
}
export const denseFlowchart = `flowchart LR\n${Array.from({ length: 100 }, (_, i) => `N${i}["Step ${i}"] --> N${(i + 1) % 100}`).join("\n")}`;
export const longSequence = `sequenceDiagram\n${Array.from({ length: 50 }, (_, i) => `Abra->>Worker: Evidence message ${i}`).join("\n")}`;

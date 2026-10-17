declare module "*.mmd" {
  const diagram: import("./mermaid-diagram.tsx").PreparedDiagram;
  export default diagram;
}

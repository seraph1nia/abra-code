import mermaid from "mermaid";

// Authoring/build tooling only: this engine is never imported by the report.
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "base",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  themeVariables: {
    primaryColor: "#e4ebdf",
    primaryTextColor: "#26342e",
    primaryBorderColor: "#426c4d",
    lineColor: "#57635c",
    secondaryColor: "#f5f3ed",
    tertiaryColor: "#fffefb",
  },
});

let nextId = 0;

export async function renderDiagram(source: string) {
  // Rendering can fail after parsing, so validation deliberately does both.
  await mermaid.parse(source);
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-100000px;top:0;width:1080px";
  document.body.append(host);
  try {
    const { svg } = await mermaid.render(`report-mermaid-${++nextId}`, source, host);
    // Mermaid's percentage widths otherwise stretch narrow, tall diagrams.
    // Keep natural text size and let the component scroll wide diagrams locally.
    host.innerHTML = svg;
    const graphic = host.querySelector("svg");
    if (graphic) {
      const { width, height } = graphic.viewBox.baseVal;
      if (width > 0 && height > 0) {
        graphic.setAttribute("width", String(width));
        graphic.setAttribute("height", String(height));
        graphic.style.maxWidth = "none";
      }
    }
    return host.innerHTML;
  } finally {
    host.remove();
  }
}

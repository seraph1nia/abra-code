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
    // Template contents remain inert while inspecting strict compiler output.
    // Portable SVG cannot load external resources or carry executable nodes.
    const prepared = document.createElement("template");
    prepared.innerHTML = svg;
    if (prepared.content.querySelector("script,iframe,object,embed,video,audio"))
      throw new Error("Diagram output contains executable or external content");
    const inlineResource = (value: string) =>
      value.startsWith("#") || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value);
    const safeStyle = (value: string) =>
      !value.includes("\\") &&
      !/@import\b/i.test(value) &&
      [...value.matchAll(/url\(\s*["']?([^)'"\s]+)/gi)].every((match) => inlineResource(match[1]!));
    for (const element of prepared.content.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        if (["href", "src"].includes(attribute.localName) && !inlineResource(attribute.value))
          throw new Error("Diagram output requires an external resource");
        if (attribute.localName.startsWith("on"))
          throw new Error("Diagram output contains an event handler");
        if (
          (attribute.localName === "style" || /url\s*\(/i.test(attribute.value)) &&
          !safeStyle(attribute.value)
        )
          throw new Error("Diagram style requires an external resource");
      }
      if (element.localName === "style" && !safeStyle(element.textContent ?? ""))
        throw new Error("Diagram stylesheet requires an external resource");
    }
    host.replaceChildren(prepared.content.cloneNode(true));
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

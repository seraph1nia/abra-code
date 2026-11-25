// Parse in an inert template. Only SVG geometry, labels, and local paint references
// survive. Stylesheet rules become declarations on matching diagram nodes, so
// no selector from prepared data ever enters the host document's stylesheet.
const elements = new Set(
  "svg g defs marker clipPath linearGradient radialGradient stop path rect line polyline polygon circle ellipse text tspan title desc".split(
    " ",
  ),
);
const attributes = new Set(
  "id class role aria-label aria-labelledby aria-describedby aria-roledescription viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry dx dy d points transform textLength lengthAdjust refX refY markerWidth markerHeight markerUnits orient gradientUnits gradientTransform offset clipPathUnits".split(
    " ",
  ),
);
const properties = new Set(
  "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit opacity color font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline baseline-shift text-decoration letter-spacing white-space paint-order shape-rendering vector-effect stop-color stop-opacity marker-start marker-mid marker-end clip-path display visibility max-width".split(
    " ",
  ),
);
const svgNamespace = "http://www.w3.org/2000/svg";

function paintValue(value: string, ids: Set<string>) {
  const ref = /^url\(["']?#([\w.-]+)["']?\)$/i.exec(value);
  if (ref) return ids.has(ref[1]!) ? `url(#${ref[1]})` : undefined;
  if (/^[\w\s#.,%'"-]+$/.test(value) || /^(?:rgba?|hsla?)\([\d.,%\s/+-]+\)$/i.test(value))
    return value;
}

function applyStyle(target: SVGElement, style: CSSStyleDeclaration, ids: Set<string>) {
  for (const property of style) {
    if (!properties.has(property)) continue;
    const value = paintValue(style.getPropertyValue(property), ids);
    if (value) target.style.setProperty(property, value);
  }
}

export function sanitizeDiagramSVG(markup: string): SVGSVGElement | undefined {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const root = template.content.firstElementChild;
  if (root?.namespaceURI !== svgNamespace || root.localName !== "svg") return;
  const ids = new Set([root, ...root.querySelectorAll("[id]")].map((node) => node.id));
  const sheets: string[] = [];
  const inline: [SVGElement, string][] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element !== root && !root.contains(element)) continue;
    if (element.namespaceURI === svgNamespace && element.localName === "style")
      sheets.push(element.textContent ?? "");
    if (element.namespaceURI !== svgNamespace || !elements.has(element.localName)) {
      element.remove();
      continue;
    }
    for (const attr of Array.from(element.attributes)) {
      const { name, value } = attr;
      if (!attr.namespaceURI && attributes.has(name)) continue;
      if (name === "style") inline.push([element as SVGElement, value]);
      else if (properties.has(name) && paintValue(value, ids)) continue;
      element.removeAttributeNode(attr);
    }
  }
  for (const css of sheets) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      // Mermaid uses plain SVG type, ID and class selectors. Drop pseudo-elements,
      // at-rules, nesting and selectors dependent on state outside the SVG.
      if (!/^[\w\s.,#*>+~-]+$/.test(rule.selectorText)) continue;
      const matches = Array.from(root.querySelectorAll<SVGElement>(rule.selectorText));
      if (root.matches(rule.selectorText)) matches.push(root as SVGElement);
      for (const match of matches) applyStyle(match, rule.style, ids);
    }
  }
  const parsed = document.createElement("span").style;
  for (const [node, declarations] of inline) {
    parsed.cssText = declarations;
    applyStyle(node, parsed, ids);
  }
  return root as SVGSVGElement;
}

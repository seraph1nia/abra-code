import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { canonicalJson } from "@abracode/contracts/canonical-json";
import { canonicalJson as agentCanonicalJson } from "@abracode/agents/contracts";
import { canonicalJSON } from "../../src/presentation/identity.ts";
import { fingerprint } from "../../src/web/backend.ts";

// Runtime tsconfig does not enable --jsx, so load TSX presentation modules dynamically at test time.
const catalogMediaSpecifier: string = "@abracode/presentation/catalog-media";
const surfacesSpecifier: string = "@abracode/presentation/surfaces";

async function loadMediaUrl() {
  const mod = (await import(catalogMediaSpecifier)) as {
    mediaUrl: (
      value: unknown,
      frozen: boolean,
      kind?: "Image" | "Video" | "AudioPlayer",
    ) => string | undefined;
  };
  return mod.mediaUrl;
}

async function loadA2uiMarkdown() {
  const hadHTMLElement = "HTMLElement" in globalThis;
  if (!hadHTMLElement) {
    Object.defineProperty(globalThis, "HTMLElement", {
      value: class {},
      configurable: true,
      writable: true,
    });
  }
  try {
    const mod = (await import(surfacesSpecifier)) as {
      A2uiMarkdown: (props: { markdown: string }) => unknown;
    };
    return mod.A2uiMarkdown;
  } finally {
    if (!hadHTMLElement) delete (globalThis as Record<string, unknown>).HTMLElement;
  }
}

function collectElements(node: unknown, out: { type: unknown; props: Record<string, unknown> }[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, out);
    return;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if ("type" in element && element.props && typeof element.props === "object") {
    out.push({ type: element.type, props: element.props });
    collectElements(element.props.children, out);
  }
}

test("catalog-media URL sanitizer enforces strict data MIME allowlists and blocks XSS schemes", async () => {
  const mediaUrl = await loadMediaUrl();
  for (const dangerous of [
    "data:image/svg+xml,<svg onload=alert(1)>",
    "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "javascript:alert(1)",
    "  java\tscript:alert(1)",
    "vbscript:msgbox(1)",
    "//evil.invalid/image.png",
    "/\\evil.invalid/image.png",
    "https:///missing-host.png",
    "/api/workspace",
    "https://user:secret@example.invalid/image.png",
  ]) {
    assert.equal(mediaUrl(dangerous, false, "Image"), undefined, dangerous);
    assert.equal(mediaUrl(dangerous, true, "Image"), undefined, dangerous);
  }

  // Cross-kind data URLs are rejected
  assert.equal(mediaUrl("data:video/mp4;base64,AAAA", false, "Image"), undefined);
  assert.equal(mediaUrl("data:audio/mpeg;base64,AAAA", false, "Image"), undefined);
  assert.equal(mediaUrl("data:image/png;base64,iVBORw0KGgo=", false, "Video"), undefined);
  assert.equal(mediaUrl("data:image/png;base64,iVBORw0KGgo=", false, "AudioPlayer"), undefined);

  // Allowed raster image data URLs work both live and offline (frozen)
  for (const validImage of [
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
    "data:image/gif;base64,R0lGODlh",
    "data:image/webp;base64,UklGRh4=",
  ]) {
    assert.equal(mediaUrl(validImage, false, "Image"), validImage);
    assert.equal(mediaUrl(validImage, true, "Image"), validImage);
  }

  // Allowed audio and video data URLs match their kinds
  for (const validAudio of [
    "data:audio/mpeg;base64,AAAA",
    "data:audio/ogg;base64,AAAA",
    "data:audio/wav;base64,AAAA",
    "data:audio/webm;base64,AAAA",
  ]) {
    assert.equal(mediaUrl(validAudio, false, "AudioPlayer"), validAudio);
    assert.equal(mediaUrl(validAudio, true, "AudioPlayer"), validAudio);
  }
  for (const validVideo of ["data:video/mp4;base64,AAAA", "data:video/webm;base64,AAAA"]) {
    assert.equal(mediaUrl(validVideo, false, "Video"), validVideo);
    assert.equal(mediaUrl(validVideo, true, "Video"), validVideo);
  }

  // HTTPS URLs allowed live, blocked when frozen offline
  assert.equal(
    mediaUrl("https://example.com/photo.png", false, "Image"),
    "https://example.com/photo.png",
  );
  assert.equal(mediaUrl("https://example.com/photo.png", true, "Image"), undefined);
  assert.equal(mediaUrl("/assets/photo.png", false, "Image"), undefined);
  assert.equal(mediaUrl("/assets/photo.png", true, "Image"), undefined);
});

test("A2uiMarkdown renders safe Markdown elements without raw HTML or javascript links", async () => {
  const A2uiMarkdown = await loadA2uiMarkdown();
  const safeTree = A2uiMarkdown({
    markdown: "Hello **bold** and [docs](https://example.com/docs) with `code`",
  });
  const safeElements: { type: unknown; props: Record<string, unknown> }[] = [];
  collectElements(safeTree, safeElements);
  assert.ok(safeElements.some((el) => el.type === "strong" && el.props.children === "bold"));
  assert.ok(safeElements.some((el) => el.type === "code" && el.props.children === "code"));
  assert.ok(
    safeElements.some(
      (el) =>
        el.type === "a" &&
        el.props.href === "https://example.com/docs" &&
        el.props.rel === "noopener noreferrer",
    ),
  );

  const identifier = A2uiMarkdown({ markdown: "one_snake_case_name" });
  const identifiers: typeof safeElements = [];
  collectElements(identifier, identifiers);
  assert.ok(!identifiers.some((el) => el.type === "em"));
  assert.match(JSON.stringify(identifier), /one_snake_case_name/);

  const unsafeTree = A2uiMarkdown({
    markdown: "<script>alert(1)</script> [click](javascript:alert(1)) <img src=x onerror=alert(1)>",
  });
  const unsafeElements: { type: unknown; props: Record<string, unknown> }[] = [];
  collectElements(unsafeTree, unsafeElements);
  assert.equal(
    unsafeElements.some((el) => el.type === "script" || el.type === "img" || el.type === "a"),
    false,
  );
  assert.equal(
    unsafeElements.some((el) => "dangerouslySetInnerHTML" in el.props),
    false,
  );
});

test("canonicalJSON is deterministic across key order and uses UTF-16 code-unit sorting", () => {
  const first = { b: 1, a: 2, nested: { z: true, y: undefined, x: [3, { d: 4, c: 3 }] } };
  const second = { nested: { x: [3, { c: 3, d: 4 }], z: true }, a: 2, b: 1 };
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(canonicalJSON(first), canonicalJson(first));
  assert.equal(agentCanonicalJson(first), canonicalJson(first));

  // UTF-16 code-unit order always places uppercase 'B' (66) before lowercase 'a' (97)
  assert.equal(canonicalJSON({ a: 2, B: 1 }), '{"B":1,"a":2}');
  assert.equal(canonicalJson({ a: 2, B: 1 }), '{"B":1,"a":2}');
  assert.equal(agentCanonicalJson({ a: 2, B: 1 }), '{"B":1,"a":2}');
});

test("backend form fingerprint treats reordered answer keys as equivalent retries", () => {
  const answerA = {
    direction: "simple",
    details: { rationale: "keep scope tight", approved: true },
    notes: ["first", "second"],
  };
  const answerB = {
    notes: ["first", "second"],
    details: { approved: true, rationale: "keep scope tight" },
    direction: "simple",
  };
  assert.equal(fingerprint(answerA), fingerprint(answerB));
  assert.notEqual(fingerprint(answerA), fingerprint({ ...answerB, direction: "complete" }));
});

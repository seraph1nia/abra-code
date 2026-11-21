import { codeToTokens, isSupportedLanguage } from "@pierre/highlights";
import light from "@pierre/highlights/themes/github-light";
import dark from "@pierre/highlights/themes/github-dark";
import { memo, type ReactNode } from "react";

const themes = { light, dark };

export type HighlightedCodeProps = { code: string; language: string };

export default memo(function HighlightedCode({ code, language }: HighlightedCodeProps) {
  if (!isSupportedLanguage(language)) return code;
  try {
    const { tokens } = codeToTokens(code, {
      lang: language,
      themes,
      defaultColor: false,
      cssVariablePrefix: "--code-",
      tokenizeMaxLineLength: 2048,
    });
    const runs: ReactNode[] = [];
    let end = 0;
    for (const line of tokens) {
      for (const token of line) {
        if (!token.content) continue;
        // Tokens omit line endings. Copy gaps from the original to preserve CRLF and blank lines.
        if (token.offset > end) runs.push(code.slice(end, token.offset));
        end = token.offset + token.content.length;
        runs.push(
          <span key={token.offset} style={token.htmlStyle}>
            {code.slice(token.offset, end)}
          </span>,
        );
      }
    }
    runs.push(code.slice(end));
    return runs;
  } catch {
    return code;
  }
});

import {
  javascriptLanguage,
  jsxLanguage,
  typescriptLanguage,
  tsxLanguage,
} from "@codemirror/lang-javascript";
import { classHighlighter, highlightTree } from "@lezer/highlight";

export type CodeToken = { text: string; className?: string };
const aliases: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  txt: "text",
  plaintext: "text",
};
const parsers = {
  javascript: javascriptLanguage.parser,
  jsx: jsxLanguage.parser,
  typescript: typescriptLanguage.parser,
  tsx: tsxLanguage.parser,
};
export function codeLanguage(source: string, hint = ""): string {
  const normalized = hint.toLowerCase();
  const language = aliases[normalized] || normalized;
  if (language && language !== "text") return language;
  // Infer only inside unlabelled/plain-text fences, and require recognizable code.
  if (
    !/(?:^|\n)\s*(?:import\s+.+\s+from\s+['"]|export\s+(?:default\s+)?(?:function|class|const|interface|type)\b|(?:const|let|var)\s+\w+\s*(?:=|:)|(?:async\s+)?function\s+\w+\s*\()/.test(
      source,
    )
  )
    return "text";
  const typed =
    /\b(?:interface\s+\w+|type\s+\w+\s*=)|:\s*(?:string|number|boolean|unknown|never)\b/.test(
      source,
    );
  let jsx = false;
  if (source.length <= 64000 && source.includes("<"))
    tsxLanguage.parser.parse(source).iterate({
      enter: (node) => {
        if (node.name === "JSXElement") jsx = true;
      },
    });
  return jsx ? (typed ? "tsx" : "jsx") : typed ? "typescript" : "javascript";
}
export function highlightCode(source: string, language: string): CodeToken[] {
  const parser = parsers[language as keyof typeof parsers];
  if (!parser || source.length > 64000) return [{ text: source }];
  const tokens: CodeToken[] = [];
  let offset = 0;
  highlightTree(
    parser.parse(source),
    classHighlighter,
    (from, to, className) => {
      if (from > offset) tokens.push({ text: source.slice(offset, from) });
      tokens.push({ text: source.slice(from, to), className });
      offset = to;
    },
  );
  if (offset < source.length) tokens.push({ text: source.slice(offset) });
  return tokens;
}

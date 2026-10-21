import React, {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { codeLanguage, highlightCode } from "@/lib/code-highlight";
const plugins = [remarkGfm];
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((part) =>
      typeof part === "string" || typeof part === "number"
        ? String(part)
        : isValidElement<{ children?: ReactNode }>(part)
          ? textOf(part.props.children)
          : "",
    )
    .join("");
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  const child = Children.toArray(children)[0];
  const hint = isValidElement<{ className?: string }>(child)
    ? child.props.className?.replace("language-", "")
    : undefined;
  const source = textOf(children);
  const language = useMemo(() => codeLanguage(source, hint), [source, hint]);
  const tokens = useMemo(
    () => highlightCode(source, language),
    [source, language],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(source.replace(/\n$/, ""));
      setCopied(true);
      setError(false);
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="response-code">
      <div className="response-code-heading">
        <span>{language}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void copy()}
          aria-label="Copy code"
        >
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? "Copied" : error ? "Copy failed" : "Copy"}
        </Button>
      </div>
      <pre>
        <code className={`language-${language}`}>
          {tokens.map((token, index) =>
            token.className ? (
              <span key={index} className={token.className}>
                {token.text}
              </span>
            ) : (
              token.text
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
export const MarkdownResponse = React.memo(function MarkdownResponse({
  text,
}: {
  text: string;
}) {
  return (
    <div className="markdown-response">
      <ReactMarkdown
        remarkPlugins={plugins}
        skipHtml
        urlTransform={(url) => defaultUrlTransform(url)}
        components={{
          pre: CodeBlock,
          a: ({ children, href }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="markdown-image-label">
              [Image{alt ? `: ${alt}` : ""}]
            </span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

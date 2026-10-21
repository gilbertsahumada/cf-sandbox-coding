import { lazy, Suspense, memo } from "react";
const MarkdownResponse = lazy(() =>
  import("./markdown-response").then((module) => ({
    default: module.MarkdownResponse,
  })),
);
export const AgentResponse = memo(function AgentResponse({
  text,
}: {
  text: string;
}) {
  return (
    <Suspense fallback={<p className="editor-hint">Loading response…</p>}>
      <MarkdownResponse text={text} />
    </Suspense>
  );
});

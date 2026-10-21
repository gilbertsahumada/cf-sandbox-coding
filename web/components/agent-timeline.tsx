import { memo } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  FileText,
  Pencil,
  SquareTerminal,
} from "lucide-react";
import type { TimelineSnapshot, ToolActivity } from "@/lib/agent-timeline";
import { AgentResponse } from "./agent-response";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
const ToolRow = memo(function ToolRow({
  tool,
  active,
  onInteract,
}: {
  tool: ToolActivity;
  active: boolean;
  onInteract: () => void;
}) {
  const running = tool.state === "running" && active;
  const unavailable =
    tool.state === "unavailable" || (tool.state === "running" && !active);
  const ToolIcon = /read|glob|grep|list|search/i.test(tool.name)
    ? FileText
    : /edit|write|patch/i.test(tool.name)
      ? Pencil
      : SquareTerminal;
  return (
    <Collapsible
      className="inline-tool"
      data-result={tool.state}
      onOpenChange={onInteract}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="inline-tool-trigger"
          aria-label={`${tool.name}: ${tool.label}`}
        >
          {running ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : tool.state === "error" ? (
            <CircleAlert data-icon="inline-start" aria-label="Failed" />
          ) : unavailable ? (
            <CircleHelp
              data-icon="inline-start"
              aria-label="Result not available"
            />
          ) : (
            <Check data-icon="inline-start" aria-label="Completed" />
          )}
          <ToolIcon aria-hidden="true" />
          <span className="truncate" title={tool.label}>
            {tool.label}
          </span>
          <span className="inline-tool-state">
            {running
              ? "Running"
              : tool.state === "error"
                ? "Failed"
                : unavailable
                  ? "Result unavailable"
                  : "Done"}
          </span>
          <ChevronRight
            className="inline-tool-chevron"
            data-icon="inline-end"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="inline-tool-body">
        <div className="inline-tool-details">
          {tool.input ? (
            <>
              <span>Input</span>
              <pre>{tool.input}</pre>
            </>
          ) : null}
          <span>Output</span>
          <pre>
            {tool.output ||
              (running
                ? "Waiting for tool output…"
                : "No output was saved for this tool.")}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
export function AgentTimeline({
  snapshot,
  onInteract,
  active,
  response,
  fallback,
}: {
  snapshot?: TimelineSnapshot;
  onInteract: () => void;
  active: boolean;
  response: string;
  fallback: string;
}) {
  const items = snapshot?.items || [];
  if (!items.length) return <AgentResponse text={fallback} />;
  const text = items
    .filter((item) => item.kind === "text")
    .map((item) => item.text);
  const finalShown =
    response &&
    text.some(
      (_, index) => text.slice(index).join("\n").trim() === response.trim(),
    );
  return (
    <div className="agent-timeline">
      {snapshot?.omitted ? (
        <p className="timeline-note">
          Some earlier activity is not available in this view.
        </p>
      ) : null}
      {items.map((item) =>
        item.kind === "tool" ? (
          <ToolRow
            key={item.id}
            tool={item}
            active={active}
            onInteract={onInteract}
          />
        ) : item.kind === "error" ? (
          <p key={item.id} className="timeline-error">
            <CircleAlert aria-hidden="true" />
            {item.text}
          </p>
        ) : (
          <AgentResponse key={item.id} text={item.text} />
        ),
      )}
      {!active && response && !finalShown ? (
        <AgentResponse text={response} />
      ) : null}
    </div>
  );
}

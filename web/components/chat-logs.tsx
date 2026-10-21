import { ChevronDown, ChevronsDown, Pause, SquareTerminal } from "lucide-react";
import type { Runner } from "@/hooks/use-runner";
import { useState } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
export function ChatLogs({
  runner,
  expanded,
  onToggle,
  visible,
}: {
  runner: Runner;
  expanded: boolean;
  onToggle: () => void;
  visible: boolean;
}) {
  const [follow, setFollow] = useState(true);
  return (
    <Collapsible
      open={expanded && visible}
      onOpenChange={onToggle}
      className="chat-logs"
      data-open={expanded && visible}
      hidden={!visible}
    >
      <div className="chat-logs-heading">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="chat-logs-toggle"
            aria-label={
              expanded ? "Hide execution logs" : "Show execution logs"
            }
          >
            <SquareTerminal data-icon="inline-start" />
            Execution logs
            <Badge variant="secondary">{runner.activityCount}</Badge>
            <span className="chat-logs-status">
              {runner.streamState || "Waiting"}
            </span>
            <ChevronDown className="chat-logs-chevron" data-icon="inline-end" />
          </Button>
        </CollapsibleTrigger>
        {expanded ? (
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={follow}
            onClick={() => {
              setFollow((value) => !value);
              runner.followRef.current = !follow;
            }}
          >
            {follow ? (
              <ChevronsDown data-icon="inline-start" />
            ) : (
              <Pause data-icon="inline-start" />
            )}
            {follow ? "Following" : "Paused"}
          </Button>
        ) : null}
      </div>
      <CollapsibleContent
        forceMount
        className="chat-logs-content"
        inert={!expanded || !visible}
        aria-hidden={!expanded || !visible}
      >
        <div className="chat-logs-inner">
          <div
            className="activity-output"
            ref={runner.activityRef}
            tabIndex={0}
            aria-label="Execution logs"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

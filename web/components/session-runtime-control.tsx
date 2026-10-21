import React from "react";
import {
  CircleCheck,
  CirclePause,
  Cloud,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
export const SessionRuntimeControl = React.memo(function SessionRuntimeControl({
  running,
  active,
  checking,
  stopping,
  disabled,
  onRefresh,
  onStop,
  starting = false,
  canStart = false,
  startReason,
  onStart,
}: {
  running: boolean | null;
  active: boolean;
  checking: boolean;
  stopping: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onStop: () => void;
  starting?: boolean;
  canStart?: boolean;
  startReason?: string;
  onStart?: () => void;
}) {
  const label = starting
    ? "Starting session…"
    : stopping
      ? "Stopping session…"
      : checking
        ? "Checking session…"
        : running === true
          ? "Session running"
          : running === false
            ? "Session stopped"
            : "Session status unavailable";
  return (
    <div className="session-runtime-control">
      <span
        className="session-runtime-state"
        data-running={running === null ? "unknown" : String(running)}
        role="status"
      >
        {checking || stopping || starting || active ? (
          <Spinner aria-hidden="true" />
        ) : running === true ? (
          <CircleCheck aria-hidden="true" />
        ) : running === false ? (
          <CirclePause aria-hidden="true" />
        ) : (
          <Cloud aria-hidden="true" />
        )}
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Refresh session status"
        disabled={checking || stopping || starting || disabled}
        onClick={onRefresh}
      >
        <RefreshCw />
      </Button>
      {running === true || active ? (
        <Button
          variant="destructive"
          size="sm"
          disabled={disabled || stopping || starting || (checking && !active)}
          aria-busy={stopping}
          aria-label="Stop session"
          title="Stop session"
          onClick={onStop}
        >
          {stopping ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <Square data-icon="inline-start" />
          )}
          Stop
        </Button>
      ) : running === false || starting ? (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || checking || starting || !canStart}
          aria-busy={starting}
          aria-label={starting ? "Starting session…" : "Start session"}
          title={
            !canStart
              ? startReason ||
                "No current workspace recovery checkpoint is available."
              : "Restore the workspace without sending an agent instruction"
          }
          onClick={onStart}
        >
          {starting ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <Play data-icon="inline-start" />
          )}
          Start
        </Button>
      ) : null}
    </div>
  );
});

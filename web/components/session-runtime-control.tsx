import React from "react";
import { Cloud, RefreshCw, Square } from "lucide-react";
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
}: {
  running: boolean | null;
  active: boolean;
  checking: boolean;
  stopping: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onStop: () => void;
}) {
  const label = stopping
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
        {checking || stopping ? (
          <Spinner aria-hidden="true" />
        ) : (
          <Cloud aria-hidden="true" />
        )}
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Refresh session status"
        disabled={checking || stopping || disabled}
        onClick={onRefresh}
      >
        <RefreshCw />
      </Button>
      {running === true || active ? (
        <Button
          variant="destructive"
          size="sm"
          disabled={disabled || stopping || (checking && !active)}
          aria-busy={stopping}
          onClick={onStop}
        >
          {stopping ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <Square data-icon="inline-start" />
          )}
          Stop session
        </Button>
      ) : null}
    </div>
  );
});

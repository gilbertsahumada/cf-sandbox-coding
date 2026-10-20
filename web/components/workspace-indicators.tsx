import type { ComponentProps } from "react";
import {
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  FileCode2,
  FileJson2,
  FileText,
  Image,
  Palette,
  Terminal,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { isActive, stateNames, type RunState } from "@/lib/types";

export function TaskStateIcon({
  state,
  ...props
}: ComponentProps<"svg"> & { state: RunState }) {
  if (isActive(state)) return <Spinner aria-hidden="true" {...props} />;
  const Icon =
    state === "succeeded"
      ? CircleCheck
      : state === "cancelled"
        ? CirclePause
        : state === "failed" || state === "lost"
          ? CircleX
          : CircleHelp;
  return <Icon aria-hidden="true" {...props} />;
}
export function TaskBadge({ state }: { state: RunState }) {
  return (
    <Badge
      variant={
        state === "failed" || state === "lost" ? "destructive" : "secondary"
      }
    >
      <TaskStateIcon state={state} data-icon="inline-start" />
      {stateNames[state]}
    </Badge>
  );
}
export function FileIcon({
  path,
  ...props
}: ComponentProps<"svg"> & { path: string }) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const Icon = ["css", "scss"].includes(extension || "")
    ? Palette
    : ["json", "jsonc"].includes(extension || "")
      ? FileJson2
      : ["md", "txt", "mdx"].includes(extension || "")
        ? FileText
        : ["png", "jpg", "jpeg", "svg", "webp"].includes(extension || "")
          ? Image
          : ["sh", "bash", "zsh"].includes(extension || "")
            ? Terminal
            : FileCode2;
  return <Icon aria-hidden="true" {...props} />;
}

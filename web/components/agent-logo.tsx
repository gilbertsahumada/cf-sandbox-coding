import type { ComponentProps } from "react";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";

// Official marks are decorative: the adjacent agent name provides the label.
export function AgentLogo({
  agent,
  className,
  ...props
}: Omit<ComponentProps<"img">, "src" | "alt"> & { agent: Agent }) {
  return (
    <img
      {...props}
      src={`/assets/agents/${agent}.svg`}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      draggable={false}
      className={cn("agent-logo", `agent-logo-${agent}`, className)}
    />
  );
}

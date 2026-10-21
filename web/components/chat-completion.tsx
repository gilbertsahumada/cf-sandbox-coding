import React from "react";
import { ArrowUpRight, FileDiff, GitPullRequest } from "lucide-react";
import { githubPullRequestURL } from "@/lib/editor";
import { isActive, type Proposal, type RunState } from "@/lib/types";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export const ChatCompletion = React.memo(function ChatCompletion({
  state,
  changeCount,
  proposal,
  loading,
  hasUnsavedEdits,
  onReview,
  onPublish,
}: {
  state: RunState;
  changeCount: number;
  proposal: Proposal | null;
  loading: boolean;
  hasUnsavedEdits: boolean;
  onReview: () => void;
  onPublish: () => void;
}) {
  if (isActive(state) || state === "none") return null;
  const prURL = proposal?.pr ? githubPullRequestURL(proposal.pr.url) : null;
  const checking = loading || !proposal;
  const hasChanges = changeCount > 0 || proposal?.available || Boolean(prURL);
  const blockedReason = hasUnsavedEdits
    ? "Save or discard your file edits before creating a PR."
    : !proposal?.available && !prURL
      ? proposal?.reason
      : undefined;
  return (
    <section className="chat-completion" aria-label="Session changes">
      <div className="chat-completion-summary">
        {checking ? (
          <Spinner aria-hidden="true" />
        ) : (
          <FileDiff aria-hidden="true" />
        )}
        <strong>
          {checking
            ? "Checking changes…"
            : prURL
              ? "Draft PR created"
              : hasChanges
                ? "Changes ready for review"
                : "No file changes yet"}
        </strong>
        {!checking && changeCount > 0 ? (
          <span>
            {changeCount} {changeCount === 1 ? "file" : "files"} changed
          </span>
        ) : null}
      </div>
      {!checking ? (
        <>
          <p>
            {blockedReason ||
              (prURL
                ? "Continue here to refine the work, or open the pull request."
                : hasChanges
                  ? "Review the changes before publishing, or keep working in this chat."
                  : "You can keep working in this conversation.")}
          </p>
          {hasChanges ? (
            <div className="chat-completion-actions">
              <Button size="sm" variant="outline" onClick={onReview}>
                <FileDiff data-icon="inline-start" />
                Review changes
              </Button>
              {prURL ? (
                <Button asChild size="sm">
                  <a href={prURL} target="_blank" rel="noopener noreferrer">
                    <GitPullRequest data-icon="inline-start" />
                    View PR
                    <ArrowUpRight data-icon="inline-end" />
                  </a>
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!proposal?.available || hasUnsavedEdits}
                  onClick={onPublish}
                >
                  <GitPullRequest data-icon="inline-start" />
                  Create PR
                </Button>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
});

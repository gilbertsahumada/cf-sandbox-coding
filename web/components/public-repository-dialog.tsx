import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import {
  publicRepositoryUrl,
  type PublicRepository,
} from "@/lib/public-repository";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

export function PublicRepositoryDialog({
  open,
  initialUrl,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  initialUrl: string;
  onCancel: () => void;
  onConfirm: (repository: PublicRepository) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setError("");
    }
  }, [open, initialUrl]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const repository = publicRepositoryUrl(url);
    if (!repository) {
      setError(
        "Enter an HTTPS GitHub repository URL without credentials, query parameters, or a file path.",
      );
      return;
    }
    onConfirm(repository);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Use a public repository</DialogTitle>
          <DialogDescription>
            Confirm the repository for this new chat. This does not start a
            session.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="public-repository">
                GitHub repository URL
              </FieldLabel>
              <Input
                id="public-repository"
                type="url"
                required
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError("");
                }}
                placeholder="https://github.com/owner/repository"
                aria-invalid={Boolean(error)}
                aria-describedby="public-repository-help"
              />
              <FieldDescription id="public-repository-help">
                The repository must be public. Draft PRs require access through
                the owner’s GitHub App; otherwise, you can download the patch.
              </FieldDescription>
            </Field>
            {error ? (
              <Alert variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim()}>
              Use repository
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

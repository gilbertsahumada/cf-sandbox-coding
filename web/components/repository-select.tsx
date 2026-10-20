import type { Repository } from "@/lib/types";
import {
  Select, SelectTrigger, SelectValue, SelectContent,
  SelectGroup, SelectLabel, SelectItem,
} from "./ui/select";

export default function RepositorySelect({ selected, options, example, disabled, onSelect }: {
  selected: Repository | null;
  options: Repository[];
  example: boolean;
  disabled: boolean;
  onSelect: (repository: Repository) => void;
}) {
  const label = (repo: Repository) => `${repo.private ? "Private" : "Public"} · ${repo.fullName}`;
  return (
    <Select value={example ? "example" : selected?.url || ""} disabled={disabled} required
      onValueChange={value => {
        const repo = options.find(item => item.url === value) || (selected?.url === value ? selected : null);
        if (repo) onSelect(repo);
      }}>
      <SelectTrigger id="repo-select" className="w-full">
        <SelectValue placeholder="Select a repository" />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>
          <SelectLabel>Repositories</SelectLabel>
          {selected && !options.some(repo => repo.url === selected.url) ?
            <SelectItem value={selected.url}>{label(selected)}</SelectItem> : null}
          {options.map(repo => <SelectItem key={repo.url} value={repo.url}>{label(repo)}</SelectItem>)}
          {example ? <SelectItem value="example">octocat/Hello-World</SelectItem> : null}
          {!options.length && !selected && !example ?
            <SelectItem disabled value="no-results">No matching repositories</SelectItem> : null}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

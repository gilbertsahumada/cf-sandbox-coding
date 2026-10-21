export type PublicRepository = { fullName: string; url: string };

// This validates the URL shape only. GitHub visibility and app access stay server-side.
export function publicRepositoryUrl(value: string): PublicRepository | null {
  try {
    const url = new URL(value.trim());
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
    )
      return null;
    const fullName = url.pathname
      .slice(1)
      .replace(/\/$/, "")
      .replace(/\.git$/, "");
    return { fullName, url: `https://github.com/${fullName}` };
  } catch {
    return null;
  }
}

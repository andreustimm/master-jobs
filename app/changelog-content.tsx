/** Only receives HTML compiled by scripts/build-changelog.ts with the safe Markdown renderer. */
export function ChangelogContent({ html }: { html: string }) {
  return (
    <div
      className="grid min-w-0 gap-4 [&_blockquote>p]:text-inherit [&_li>p]:inline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

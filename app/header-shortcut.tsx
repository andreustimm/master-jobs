export function HeaderShortcut({ label }: { label: string }) {
  return (
    <a
      href="#application-header"
      data-testid="skip-to-header"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:border focus:bg-background focus:px-4 focus:py-3 focus:text-foreground focus:shadow-lg"
    >
      {label}
    </a>
  );
}

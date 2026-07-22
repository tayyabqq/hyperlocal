export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-ink" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

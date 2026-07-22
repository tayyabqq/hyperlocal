/** Errors state what happened and what to do next; they never apologise or blame. */
export function ErrorNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-card bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </p>
  );
}

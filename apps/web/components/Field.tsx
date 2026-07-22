export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate/60">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-card border border-line bg-white px-4 py-3.5 text-[15px] text-ink placeholder:text-slate/40 focus:border-ink focus:outline-none';

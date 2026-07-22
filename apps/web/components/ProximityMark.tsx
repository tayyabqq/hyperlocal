/**
 * Signature mark: concentric radius rings around a pin. The product's core
 * insight is that the people who need each other are usually inside 2km, so
 * the identity is the radius itself rather than a generic logo.
 */
export function ProximityMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label="Nearby work">
      <circle cx="60" cy="60" r="52" fill="none" stroke="#E4E0D8" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="36" fill="none" stroke="#E4E0D8" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="20" fill="none" stroke="#F2A93B" strokeWidth="1.5" />
      <circle cx="60" cy="60" r="6" fill="#14213D" />
      <circle cx="82" cy="42" r="4" fill="#3FA796" />
      <circle cx="38" cy="78" r="4" fill="#3FA796" />
      <circle cx="88" cy="76" r="3" fill="#3FA796" opacity="0.55" />
    </svg>
  );
}

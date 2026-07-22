'use client';

interface ButtonProps {
  children: React.ReactNode;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost';
}

export function Button({
  children,
  type = 'button',
  onClick,
  disabled,
  loading,
  variant = 'primary',
}: ButtonProps) {
  const base =
    'w-full rounded-card px-6 py-3.5 text-[15px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? `${base} bg-ink text-canvas hover:opacity-90`
      : `${base} border border-line bg-transparent text-slate hover:opacity-80`;

  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={styles}>
      {loading ? 'Working…' : children}
    </button>
  );
}

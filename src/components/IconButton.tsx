import type { ButtonHTMLAttributes, ReactNode } from 'react';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; children: ReactNode };
export function IconButton({label, active, className = '', children, ...props}: Props) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

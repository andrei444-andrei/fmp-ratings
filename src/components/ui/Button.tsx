'use client';

import { forwardRef } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'success' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-600 active:bg-brand-700 shadow-fk-sm',
  secondary: 'bg-surface-elev text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-2 hover:bg-black/5 hover:text-ink',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
  success: 'bg-up text-white hover:brightness-95 active:brightness-90 shadow-fk-sm',
  danger: 'bg-down text-white hover:brightness-95 active:brightness-90 shadow-fk-sm',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[15px] gap-2',
  lg: 'h-[52px] px-7 text-base gap-2.5',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth, loading, leftIcon, rightIcon, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-fk select-none whitespace-nowrap',
        'transition-[background-color,color,box-shadow,filter] duration-150',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--fk-ring)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

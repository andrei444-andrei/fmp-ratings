'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg', xl: 'sm:max-w-2xl' } as const;

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fk-root fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[rgba(15,23,41,0.45)] backdrop-blur-sm animate-overlay-in"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'w-full bg-surface-elev shadow-fk-lg animate-modal-in flex flex-col max-h-[90vh] overflow-hidden',
          'rounded-fk-lg',
          SIZES[size],
        )}
      >
        {(title || description) && (
          <div className="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
              {description && <p className="text-sm text-ink-2 mt-1">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="shrink-0 -mr-1 -mt-1 inline-flex h-9 w-9 items-center justify-center rounded-fk text-ink-3 hover:bg-black/5 hover:text-ink transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {children && <div className="px-5 pb-5 sm:px-6 overflow-auto min-h-0 text-[15px] text-ink-2">{children}</div>}
        {footer && (
          <div className="px-5 py-4 sm:px-6 border-t border-line flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

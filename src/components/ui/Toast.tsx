'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export type ToastVariant = 'neutral' | 'success' | 'error' | 'info';

export interface ToastOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const ACCENT: Record<ToastVariant, string> = {
  neutral: 'border-l-ink-3',
  success: 'border-l-up',
  error: 'border-l-down',
  info: 'border-l-brand',
};

const ICON: Record<ToastVariant, React.ReactNode> = {
  neutral: null,
  success: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-up-strong">
      <path d="m5 13 4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-down-strong">
      <path d="M12 8v5m0 3.5h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-brand-700">
      <path d="M12 11v5m0-8.5h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
};

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => setMounted(true), []);

  const remove = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = ++counter;
      setItems((cur) => [...cur, { id, variant: 'neutral', duration: 4000, ...opts }]);
      const duration = opts.duration ?? 4000;
      if (duration > 0) setTimeout(() => remove(id), duration);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div className="fk-root fixed inset-x-4 bottom-4 z-[120] flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-96">
            {items.map((t) => (
              <div
                key={t.id}
                role="status"
                className={cn(
                  'flex items-start gap-3 rounded-fk border border-line border-l-4 bg-surface-elev px-4 py-3 shadow-fk-lg animate-toast-in',
                  ACCENT[t.variant ?? 'neutral'],
                )}
              >
                {ICON[t.variant ?? 'neutral'] && <span className="mt-0.5 shrink-0">{ICON[t.variant ?? 'neutral']}</span>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{t.title}</p>
                  {t.description && <p className="text-sm text-ink-2 mt-0.5">{t.description}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  aria-label="Закрыть"
                  className="shrink-0 -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-fk-sm text-ink-3 hover:bg-black/5 hover:text-ink transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

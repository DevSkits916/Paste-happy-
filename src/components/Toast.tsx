import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  push: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const push = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-50 w-full max-w-xs -translate-x-1/2 space-y-2 px-3">
        <div className="pointer-events-none" role="region" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={
                'rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm shadow-lg backdrop-blur ' +
                variantClass(toast.variant)
              }
            >
              {toast.message}
            </div>
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

function variantClass(variant: ToastVariant): string {
  switch (variant) {
    case 'success':
      return 'border-emerald-400/40 text-emerald-200';
    case 'error':
      return 'border-rose-400/40 text-rose-200';
    default:
      return 'border-sky-400/40 text-sky-200';
  }
}

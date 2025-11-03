import React from 'react';

interface ToggleProps {
  id: string;
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function Toggle({ id, checked, label, onChange }: ToggleProps) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm font-medium">
      <span>{label}</span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-12 w-20 flex-shrink-0 items-center rounded-full border border-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80 ${
          checked ? 'bg-sky-500/80' : 'bg-slate-800'
        }`}
      >
        <span
          className={`inline-block h-9 w-9 transform rounded-full bg-white transition ${
            checked ? 'translate-x-9' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  );
}

import type { Config } from 'tailwindcss';

// UX Kit «светлый финтех» подключается через design-токены (CSS-переменные
// в src/components/ui/tokens.css). Здесь мы лишь маппим токены на Tailwind-ключи,
// чтобы в компонентах писать bg-surface / text-ink / text-up и т.д.
// Всё — только extend (additive): легаси-палитра (neutral/blue/red) не трогается.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--fk-brand)',
          50: 'var(--fk-brand-50)',
          100: 'var(--fk-brand-100)',
          600: 'var(--fk-brand-600)',
          700: 'var(--fk-brand-700)',
        },
        ink: {
          DEFAULT: 'var(--fk-text)',
          2: 'var(--fk-text-2)',
          3: 'var(--fk-text-3)',
        },
        surface: {
          DEFAULT: 'var(--fk-bg)',
          elev: 'var(--fk-surface-elev)',
          2: 'var(--fk-surface-2)',
        },
        line: {
          DEFAULT: 'var(--fk-line)',
          strong: 'var(--fk-line-strong)',
        },
        up: {
          DEFAULT: 'var(--fk-up)',
          soft: 'var(--fk-up-bg)',
          strong: 'var(--fk-up-text)',
        },
        down: {
          DEFAULT: 'var(--fk-down)',
          soft: 'var(--fk-down-bg)',
          strong: 'var(--fk-down-text)',
        },
        warn: {
          DEFAULT: 'var(--fk-warn)',
          soft: 'var(--fk-warn-bg)',
          strong: 'var(--fk-warn-text)',
        },
      },
      borderRadius: {
        fk: 'var(--fk-radius)',
        'fk-sm': 'var(--fk-radius-sm)',
        'fk-lg': 'var(--fk-radius-lg)',
        'fk-pill': '999px',
      },
      boxShadow: {
        'fk-sm': 'var(--fk-shadow-sm)',
        fk: 'var(--fk-shadow)',
        'fk-lg': 'var(--fk-shadow-lg)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '100% 0' },
          '100%': { backgroundPosition: '-100% 0' },
        },
        'overlay-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'modal-in': {
          from: { opacity: '0', transform: 'translateY(12px) scale(.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.4s ease-in-out infinite',
        'overlay-in': 'overlay-in .18s ease-out',
        'modal-in': 'modal-in .22s cubic-bezier(.16,1,.3,1)',
        'toast-in': 'toast-in .22s cubic-bezier(.16,1,.3,1)',
      },
    },
  },
  plugins: [],
};
export default config;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cyber: {
          950: '#06090e',
          900: '#0b1118',
          850: '#0f1722',
          800: '#141f2e',
          700: '#1d2e45',
          600: '#2b4363',
          500: '#3b82f6',
          400: '#60a5fa',
          accent: '#00f2fe',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#f43f5e',
          purple: '#a855f7'
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'glow-sm': '0 0 15px rgba(0, 242, 254, 0.15)',
        'glow-md': '0 0 25px rgba(0, 242, 254, 0.25)',
        'glow-emerald': '0 0 20px rgba(16, 185, 129, 0.25)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.25)',
        'glow-rose': '0 0 20px rgba(244, 63, 94, 0.25)',
      },
      backgroundImage: {
        'radial-gradient': 'radial-gradient(circle at 50% 0%, rgba(0, 242, 254, 0.08) 0%, transparent 70%)',
      }
    },
  },
  plugins: [],
};

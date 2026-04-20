import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Domain status palette — reused by StatusBadge and progress bars so
        // the same status always looks identical across the dashboard and
        // the portal.
        status: {
          pending: '#94a3b8',
          progress: '#3b82f6',
          done: '#10b981',
          failed: '#ef4444',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        lanme: { // Sea Blue (Primary)
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          900: '#1e3a8a',
          950: '#0f172a',
        },
        flanm: { // Flame Orange (Action)
          50: '#fff7ed',
          500: '#f97316',
          600: '#ea580c',
          900: '#7c2d12',
        },
        sab: { // Sand/White Gradients
          50: '#f8fafc',
          100: '#f1f5f9',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [],
};
export default config;

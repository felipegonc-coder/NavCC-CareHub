/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/*/src/**/*.{ts,tsx}'],
  },
  theme: {
    extend: {},
  },
  plugins: [],
};

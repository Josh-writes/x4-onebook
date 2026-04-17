/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        shelf: {
          bg:      '#1a1a1a',
          card:    '#242424',
          border:  '#333333',
          accent:  '#c8a96e',   // warm amber — like a reading lamp
          muted:   '#888888',
          text:    '#e8e8e8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

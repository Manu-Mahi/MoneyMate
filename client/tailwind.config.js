/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: '#19392F', 700: '#224A3E', 600: '#2B5A4C' },
        sage: { DEFAULT: '#43846E', soft: '#E4EEE9' },
        gold: { DEFAULT: '#E8D7AB', soft: '#F4ECD6', deep: '#9A7B2E' },
        clay: { DEFAULT: '#D68167', soft: '#F7E3DC', deep: '#A84F35' },
        cream: { DEFAULT: '#FAF7EF', 200: '#F2EDE0', 300: '#E6DFCC' },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(25,57,47,0.06), 0 4px 16px rgba(25,57,47,0.05)',
      },
    },
  },
  plugins: [],
};

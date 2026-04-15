/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        'dm-bg': '#3b4351', // Matching the blue-grey from image
        'dm-panel': '#2d333f', // Darker area for the grid
        'dm-pad-off': '#4a5568', // Inactive pad
        'dm-pad-on': '#f59e0b', // Orange pad
        'dm-pad-active': '#fbbf24', // Brighter orange when triggered
        'dm-text': '#e2e8f0',
        'dm-trim': '#1e293b'
      },
      fontFamily: {
        'mono': ['"Courier New"', 'Courier', 'monospace'],
        'sans': ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}

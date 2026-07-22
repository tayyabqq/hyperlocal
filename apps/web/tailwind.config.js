/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14213D',      // deep indigo — authority/trust, matters in a high-fraud-sensitivity market
        canvas: '#F7F5F1',   // warm off-white
        amber: '#F2A93B',    // the AED 10 colour: paid intent, urgency
        signal: '#3FA796',   // live / available
        slate: '#333B4A',    // body text
        line: '#E4E0D8',     // hairline borders
        danger: '#C2410C',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '14px' },
    },
  },
  plugins: [],
};

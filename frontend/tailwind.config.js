/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        node: {
          0: '#3b82f6', // blue - reception
          1: '#8b5cf6', // violet - input DTO
          2: '#f59e0b', // amber - transform
          3: '#10b981', // emerald - output DTO
          4: '#ef4444', // red - send
        }
      }
    },
  },
  plugins: [],
}

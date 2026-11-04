/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: "#1c1b19",
        paper: "#faf9f7",
        line: "#e7e2da",
        accent: "#1f5f4a",
        accentsoft: "#e8f0ec",
        muted: "#6f6a61",
        danger: "#b4442f",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Georgia", "ui-serif", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,27,25,.04), 0 8px 24px rgba(28,27,25,.04)",
      },
    },
  },
  plugins: [],
};

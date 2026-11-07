/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Alle Tokens laufen über CSS-Variablen (styles.css) und wechseln
        // damit automatisch zwischen hellem und dunklem Design.
        paper: "rgb(var(--c-paper-rgb) / <alpha-value>)",
        surface: "rgb(var(--c-surface-rgb) / <alpha-value>)",
        surface2: "rgb(var(--c-surface2-rgb) / <alpha-value>)",
        line: "rgb(var(--c-line-rgb) / <alpha-value>)",
        ink: "rgb(var(--c-ink-rgb) / <alpha-value>)",
        muted: "rgb(var(--c-muted-rgb) / <alpha-value>)",
        accent: "rgb(var(--c-accent-rgb) / <alpha-value>)",
        accentsoft: "rgb(var(--c-accentsoft-rgb) / <alpha-value>)",
        accenttext: "rgb(var(--c-accenttext-rgb) / <alpha-value>)",
        danger: "rgb(var(--c-danger-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Georgia", "ui-serif", "serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Semantic, theme-aware tokens backed by CSS variables in globals.css.
        // Toggling the `.light` class on <html> flips every token at once.
        app:            "rgb(var(--app) / <alpha-value>)",
        surface:        "rgb(var(--surface) / <alpha-value>)",
        elevated:       "rgb(var(--elevated) / <alpha-value>)",
        edge:           "rgb(var(--edge) / <alpha-value>)",
        content:        "rgb(var(--content) / <alpha-value>)",
        muted:          "rgb(var(--muted) / <alpha-value>)",
        faint:          "rgb(var(--faint) / <alpha-value>)",
        accent:         "rgb(var(--accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-hover) / <alpha-value>)",
      },
      animation: {
        "cursor-blink": "blink 1s step-end infinite",
      },
      keyframes: {
        blink: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0 } },
      },
    },
  },
  plugins: [],
};

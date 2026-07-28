/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
      },
      colors: {
        // Tokens temáticos (CSS variables — cambian con data-theme)
        canvas: "var(--bg)",
        canvas2: "var(--bg-soft)",
        panel: "var(--surface)",
        panel2: "var(--surface-2)",
        line: "var(--border)",
        line2: "var(--border-strong)",
        ink: "var(--text)",
        mute: "var(--muted)",
        faint: "var(--faint)",
        accent: "var(--accent)",
        acfg: "var(--accent-fg)",
        danger: "var(--danger)",
      },
      borderRadius: {
        el: "var(--radius)",
        "el-lg": "var(--radius-lg)",
      },
      borderWidth: {
        el: "var(--bw)",
      },
      boxShadow: {
        el: "var(--shadow)",
        "el-lg": "var(--shadow-lg)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "scale-in": "scale-in 0.15s ease-out",
      },
    },
  },
  plugins: [],
};

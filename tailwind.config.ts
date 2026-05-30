import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette from old site Elementor kit
        burgundy: {
          DEFAULT: "#801B2B",
          50: "#fdf2f4",
          100: "#fbe5e9",
          200: "#f5cad2",
          300: "#eda3b1",
          400: "#e0708a",
          500: "#cd4666",
          600: "#b62f51",
          700: "#992643",
          800: "#801B2B", // primary
          900: "#6b1a28",
        },
        ink: {
          // Neutral premium grey ramp. PR-2: 50/100/200/300/400/600/800 were
          // undefined, so border-ink-200 / divide-ink-100 / text-ink-400 fell
          // back to Tailwind's gray-200 / inherited colour — the main "flat"
          // cause. 500/700/900 keep their original values.
          DEFAULT: "#29292A", // near-black for text + dark sections
          900: "#29292A",
          800: "#313132",
          700: "#3a3a3b",
          600: "#5c5c5e",
          500: "#848484",
          400: "#9a9a9d",
          300: "#c8c8cc",
          200: "#e3e3e6",
          100: "#eeeeef",
          50: "#f6f6f7",
        },
        cream: "#FAB89F", // soft cream accent
        bg: {
          gray: "#F7F8FA", // light section bg
          warm: "#FCFAF6", // warm cross-link block bg
        },
        elementGray: "#D3D3D9",
      },
      fontFamily: {
        // Serif — headings (Prata)
        serif: ["var(--font-prata)", "Georgia", "serif"],
        // Sans body (Roboto)
        sans: ["var(--font-roboto)", "system-ui", "-apple-system", "sans-serif"],
        // UI / forms (Poppins)
        ui: ["var(--font-poppins)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Type scale from design-system.md
        "hero-desktop": ["55px", { lineHeight: "1.2", letterSpacing: "0.02em" }],
        "hero-tablet": ["42px", { lineHeight: "1.2" }],
        "hero-mobile": ["28px", { lineHeight: "1.2" }],
        "section-desktop": ["32px", { lineHeight: "1.4" }],
        "section-tablet": ["22px", { lineHeight: "1.4" }],
        "section-mobile": ["20px", { lineHeight: "1.4" }],
      },
      maxWidth: {
        container: "1200px",
        prose: "72ch",
      },
      spacing: {
        "section-y": "5rem",
        "section-y-tablet": "3.5rem",
        "section-y-mobile": "2.5rem",
      },
    },
  },
  plugins: [],
};

export default config;

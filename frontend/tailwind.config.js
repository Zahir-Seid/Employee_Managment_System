// Theme tokens that must flip between light and dark are backed by CSS
// variables (defined in src/index.css, as space-separated RGB channels) so the
// existing bg-*/text-*/border-* classes, including opacity modifiers such as
// bg-ems-primary/40, switch automatically with the `dark` class on <html>.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // --- EMS UI Theme (colors-only refresh — blue primary,
        // light neutral surfaces throughout). Token names/structure are
        // unchanged from before so every existing component picks up the
        // new values automatically. ---
        ems: {
          primary: v("ems-primary"),
          primaryHover: v("ems-primary-hover"),
          primaryLight: v("primary-light"), // badges, active nav background
          primaryLightText: v("primary-light-text"), // text on primaryLight backgrounds
          chartFill: "#2563C4", // chart bars/segments/area fill
          chartTrack: v("primary-light"), // donut unfilled portion
          chartSecondary: "#0E9AA8", // teal — 2nd chart series so blue isn't the only chart color
        },
        pagebg: v("pagebg"),
        sidebar: {
          bg: v("sidebar-bg"),
          border: v("sidebar-border"),
        },
        searchbg: v("surface-muted"),
        pill: {
          success: "#1D9E75",
          successLight: v("pill-success-light"),
          successText: "#1D9E75", // "Completed" badge text
          warning: "#E58A2E",
          warningLight: v("pill-warning-light"),
          danger: "#2563C4", // Urgent/Error — reuses brand primary, same convention as before
          dangerLight: v("primary-light"),
          neutralBg: v("pill-neutral-bg"), // "In Progress/Neutral" / archived
          neutralText: v("pill-neutral-text"),
          // New secondary/status colors added by this pass
          purple: "#7C5CD6", // drafts / secondary category
          purpleLight: v("pill-purple-light"),
          teal: "#0E9AA8", // registration / misc
          tealLight: v("pill-teal-light"),
        },
        // --- Existing tokens (still used by pages not yet migrated) ---
        // Institutional navy — the app's structural anchor (sidebar, headers).
        navy: {
          50: v("navy-50"),
          100: v("navy-100"),
          200: "#B9C5D3",
          300: v("navy-300"),
          400: "#6E7F99",
          500: v("navy-500"),
          600: v("navy-600"),
          700: v("navy-700"),
          800: "#212D42",
          900: "#171F2E",
        },
        // Signature category taxonomy — used as a consistent color code for
        // International / National / Sub-national / Internal everywhere in the
        // app (cards, tables, calendar, chart legends). Mapped onto the
        // nearest hue in the new secondary/status palette.
        category: {
          international: "#0E9AA8", // teal
          national: v("navy-700"), // dark navy
          regional: "#7C5CD6", // purple (Sub-national; token name kept)
          internal: "#E58A2E", // orange
        },
        surface: {
          DEFAULT: v("surface"),
          muted: v("surface-muted"),
          sunken: v("surface-sunken"),
        },
        ink: {
          DEFAULT: v("ink"),
          muted: v("ink-muted"),
          faint: v("ink-faint"),
        },
        line: v("line"),
        success: "#1D9E75",
        warning: "#E58A2E",
      },
      fontFamily: {
        // §12 typography: Roboto throughout, replacing the earlier
        // Inter/Space Grotesk pairing. `serif` is pinned to Roboto too
        // (not Tailwind's Georgia/Times default) so that if `font-serif`
        // is ever reached for again, it can't reintroduce a second,
        // inconsistent typeface the way it briefly did on the Home page's
        // spotlight headline.
        display: ["Roboto", "sans-serif"],
        sans: ["Roboto", "sans-serif"],
        serif: ["Roboto", "sans-serif"],
        // Sidebar-only face (matches the RPDMS sidebar). Everything else
        // stays Roboto.
        nav: ["Inter", "Roboto", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        card: "20px",
      },
      boxShadow: {
        // Soft, slightly lifted edge (thin border + bottom shadow) like the RPDMS cards.
        card: "0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 18px rgba(15, 23, 42, 0.07)",
        popover: "0 4px 16px rgba(18, 49, 74, 0.14)",
      },
      // TV Display screen-to-screen transition (Phase 11/54): a gentle,
      // near-invisible crossfade + very slight rise, not a hard cut, when
      // the rotation advances from one section/slide to the next. Kept
      // separate from the photo carousel's own opacity transition (a
      // plain CSS transition, not a keyframe) since that one fades
      // between two already-mounted images, while this one covers a full
      // component remount.
      keyframes: {
        "tv-fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // TV Display Settings queue management: the ⋮ menu pops in from its
        // corner, and inline editors ease down under their row — short and
        // subtle (not the slow TV-screen crossfade above).
        "menu-pop": {
          "0%": { opacity: "0", transform: "scale(0.96) translateY(-4px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "panel-in": {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "tv-fade-in": "tv-fade-in 700ms ease-out",
        "menu-pop": "menu-pop 120ms ease-out",
        "panel-in": "panel-in 160ms ease-out",
      },
    },
  },
  plugins: [],
};

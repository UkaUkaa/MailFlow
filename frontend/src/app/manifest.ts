import type { MetadataRoute } from "next";

/**
 * Makes the home-screen install a real standalone app. `scope: "/"` is the part that matters on
 * iOS: without a manifest Safari derives the scope from the page that was added (for example
 * `/en/mail/`), and every navigation outside it — settings, another locale, sign-in — opens with
 * the browser's address bar and back/forward controls on top of the app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "MailFlow",
    short_name: "MailFlow",
    // The locale proxy redirects "/" to the user's language, so one install serves both locales.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f5f7",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

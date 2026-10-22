import type { Metadata } from "next";
import { Frank_Ruhl_Libre, IBM_Plex_Sans_Hebrew } from "next/font/google";
import "./globals.css";

const frank = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-frank",
  display: "swap",
});

const plex = IBM_Plex_Sans_Hebrew({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "מערכת חוזים והתחייבויות | יחידת מתוו״ה",
  description: "שאלות על כל מסמך וטיוטות להסכמים חדשים, על בסיס החוזים וההתחייבויות של יחידת מתוו״ה",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${frank.variable} ${plex.variable}`}>
      <body>{children}</body>
    </html>
  );
}

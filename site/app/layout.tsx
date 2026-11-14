import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import "./globals.css";
import "./pages.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

const SITE = "https://omnipolymath.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Omnipolymath: the agent you can actually trust with your keys",
    template: "%s · Omnipolymath",
  },
  description:
    "Omnipolymath is an open-source AI assistant that runs on your own devices, with a Trust Firewall between the agent and your accounts. Does the work. Shows the receipts.",
  applicationName: "Omnipolymath",
  authors: [{ name: "Krishna Shahane", url: "https://github.com/krishnashahane" }],
  creator: "Krishna Shahane",
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "Omnipolymath",
    title: "Omnipolymath: the agent you can actually trust with your keys",
    description:
      "Autonomous, but never out of control. Approvals, an injection shield, a spend cap and a receipt for every run.",
  },
  twitter: { card: "summary_large_image", creator: "@krishnashahane_" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0d" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('omnipolymath-theme');if(t==='light'||t==='dark')d.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        <a href="#main" className="sr-only">
          Skip to content
        </a>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

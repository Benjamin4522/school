import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beulrock Serverside — #1 Server-Side Execution Platform",
  description:
    "The professional server-side execution platform for Roblox developers. Deploy events, manage scripts, and run operations with enterprise-grade security and 99.9% uptime.",
  keywords: [
    "Beulrock",
    "Serverside",
    "Roblox",
    "Server-Side Execution",
    "Script Hub",
    "HWID Security",
    "Game Development",
  ],
  authors: [{ name: "Beulrock Serverside" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Beulrock Serverside",
    description: "#1 Server-Side Execution Platform for Roblox Developers",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0a0a0a] text-white`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

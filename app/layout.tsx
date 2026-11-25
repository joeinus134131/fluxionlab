import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Nav from "./components/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FluxionLab",
  description: "Studio desain 3D dan PCB dengan AI dan MCP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Ekstensi browser (mis. Scribe) menambah atribut ke <html> sebelum React dimuat.
    // Opsi ini hanya meredam selisih atribut pada elemen ini, bukan pada isi halaman.
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Nav />
        {children}
      </body>
    </html>
  );
}

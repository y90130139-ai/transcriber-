import type { Metadata, Viewport } from 'next'
import { Archivo, Geist_Mono, Inter } from 'next/font/google'
import './globals.css'
import './inbox.css'

// Archivo is the brand's free stand-in for Neue Haas Grotesk Display.
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-archivo',
  display: 'swap',
})

// Inter + Geist Mono are the inbox's type (Geno, 2026-10-13): scoped to
// .inbox-full and .ix-dialog, the rest of the console keeps Archivo.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Transcriber',
  description: 'Drop links. Get labeled transcripts back.',
}

export const viewport: Viewport = {
  themeColor: '#171717',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${inter.variable} ${geistMono.variable}`}>
      <body
        style={
          {
            '--sc-font-display': 'var(--font-archivo), "Helvetica Neue", Helvetica, Arial, sans-serif',
            '--sc-font-text': 'var(--font-archivo), "Helvetica Neue", Helvetica, Arial, sans-serif',
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  )
}

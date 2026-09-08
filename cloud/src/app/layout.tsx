import type { Metadata, Viewport } from 'next'
import { Archivo } from 'next/font/google'
import './globals.css'

// Archivo is the brand's free stand-in for Neue Haas Grotesk Display.
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-archivo',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Transcriber',
  description: 'Drop links. Get labeled transcripts back.',
}

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
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

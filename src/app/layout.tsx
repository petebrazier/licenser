import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Bonza licences' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body style={{
        margin: 0, padding: '2rem', background: '#0f1115', color: '#e7e9ee',
        font: '14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      }}>
        {children}
      </body>
    </html>
  )
}

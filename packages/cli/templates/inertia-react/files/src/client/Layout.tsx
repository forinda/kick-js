import { Link, usePage } from '@inertiajs/react'
import type { ReactNode } from 'react'
import { Seo } from '@/client/Seo'

export function Layout({ children }: { children: ReactNode }) {
  const page = usePage<{ appName: string }>()
  const flash = page.flash as { success?: string }
  return (
    <main
      style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}
    >
      <Seo />
      <nav style={{ display: 'flex', gap: 12 }}>
        <strong>{page.props.appName}</strong>
        <Link href="/">Home</Link>
        <Link href="/posts">Posts</Link>
      </nav>
      {flash.success && <p style={{ color: 'green' }}>{flash.success}</p>}
      {children}
    </main>
  )
}

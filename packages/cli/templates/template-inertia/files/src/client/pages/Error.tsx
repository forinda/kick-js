import { Link } from '@inertiajs/react'
import { Layout } from '~/Layout'

// Rendered for unknown URLs (404) and errors thrown while handling a page.
// In production a 5xx message is replaced with a generic one.
export default function ErrorPage({ status, message }: { status: number; message: string }) {
  return (
    <Layout>
      <h1>{status}</h1>
      <p>{message}</p>
      <Link href="/">Back home</Link>
    </Layout>
  )
}

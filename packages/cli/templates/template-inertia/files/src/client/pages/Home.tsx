import { Layout } from '~/Layout'

export default function Home({ greeting }: { greeting: string }) {
  return (
    <Layout>
      <h1>{greeting}</h1>
      <p>
        Pages are React components in <code>src/client/pages</code>; their props come from the
        controller in <code>src/modules/pages</code>.
      </p>
    </Layout>
  )
}

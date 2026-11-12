<script lang="ts">
  import Layout from '../Layout.svelte'

  let { greeting }: { greeting: string } = $props()
</script>

<Layout>
  <h1>{greeting}</h1>
  <p>
    Pages are Svelte components in <code>src/client/pages</code>; their props come from the
    controller in <code>src/modules/pages</code>.
  </p>
</Layout>

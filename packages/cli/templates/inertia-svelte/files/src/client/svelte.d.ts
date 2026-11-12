// `tsc` doesn't read .svelte files: their imports type as plain components.
// svelte-check checks the components themselves.
declare module '*.svelte' {
  import type { Component } from 'svelte'
  const component: Component<any>
  export default component
}

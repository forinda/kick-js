// `tsc` doesn't read .vue files: their imports type as plain components.
// vue-tsc checks the components themselves.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}

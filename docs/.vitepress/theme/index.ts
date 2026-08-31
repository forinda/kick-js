import { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import HomeLayout from './HomeLayout.vue'
import PmCommand from './PmCommand.vue'
import './styles.css'

export default {
  extends: DefaultTheme,
  Layout: HomeLayout,
  enhanceApp({ app }) {
    // Global so any page can drop in <PmCommand add="…" /> without an import.
    app.component('PmCommand', PmCommand)
  },
} satisfies Theme

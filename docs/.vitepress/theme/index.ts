import { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import VersionSwitcher from 'vitepress-versioning-plugin/src/components/VersionSwitcher.vue'
import './styles.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('VersionSwitcher', VersionSwitcher)
  },
} satisfies Theme

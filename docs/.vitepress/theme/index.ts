import { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import HomeLayout from './HomeLayout.vue'
import './styles.css'

export default {
  extends: DefaultTheme,
  Layout: HomeLayout,
} satisfies Theme

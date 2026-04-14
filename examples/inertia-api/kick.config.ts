import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'minimal',
  modules: {
    dir: 'src/modules',
    repo: 'inmemory',
  },
})

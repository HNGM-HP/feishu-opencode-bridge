import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shiki core engine (themes/langs auto-split by dynamic import)
          if (id.includes('@shikijs/core') || id.includes('@shikijs/engine-javascript')) return 'shiki'
          // Vue ecosystem core — always loaded
          if (
            /\/node_modules\/(vue|@vue|vue-router|pinia)\//.test(id)
          ) return 'vue-vendor'
          // markdown-it — used only by Markdown component
          if (id.includes('/markdown-it/')) return 'markdown'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4098',
        changeOrigin: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5222,
    proxy: {
      '/api': {
        target: 'http://localhost:3122',
        changeOrigin: true
      }
    }
  }
})

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue(), cesium()],

  root: 'frontend',
  publicDir: 'public',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name].[ext]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vue')) return 'vue-vendor'
            if (id.includes('three')) return 'three-vendor'
            if (id.includes('leaflet')) return 'leaflet-vendor'
            return 'vendor'
          }
        }
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    sourcemap: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1000
  },

  server: {
    port: 5173
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, './frontend/src')
    }
  }
})

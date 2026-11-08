import { defineConfig } from 'vite'

export default defineConfig({
  // Rutas relativas: funciona igual en GitHub Pages (/Lapticon/), Vercel o Netlify.
  base: './',
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/gsap') || id.includes('node_modules/lenis')) return 'vendor-motion'
          if (id.includes('node_modules/d3-') || id.includes('node_modules/topojson')) return 'vendor-geo'
        },
      },
    },
  },
})

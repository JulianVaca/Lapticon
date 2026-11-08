import { defineConfig } from 'vite'

export default defineConfig({
  // Rutas relativas: funciona igual en GitHub Pages (/Lapticon/), Vercel o Netlify.
  base: './',
  worker: { format: 'es' },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // GSAP y d3 quedan en chunks aparte que solo se descargan al usarse (globo / app)
        manualChunks(id) {
          if (id.includes('node_modules/gsap')) return 'vendor-motion'
          if (id.includes('node_modules/d3-') || id.includes('node_modules/topojson')) return 'vendor-geo'
        },
      },
    },
  },
})

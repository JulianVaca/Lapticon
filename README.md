# Lapticon

Portal de encomiendas aéreas panamericanas con seguimiento de vuelo en vivo sobre un globo terráqueo interactivo.

**Sitio:** https://julianvaca.github.io/Lapticon/

## Tecnologías

- **Vite**: empaquetado y servidor de desarrollo
- **GSAP + ScrollTrigger**: animaciones de entrada, parallax y revelados al hacer scroll
- **Lenis**: scroll suave
- **d3-geo + world-atlas (Natural Earth)**: globo 3D y mapa plano con cartografía real, rutas de gran círculo y distancias reales
- Firebase Auth (REST) + backend Lapticon en Render

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/
```

## Ramas

| Rama | Uso |
| --- | --- |
| `main` | Rama principal; cada push publica en GitHub Pages |
| `produccion` | Versión estable |
| `desarrollo` | Trabajo en curso |

Fotografías: Unsplash. Cartografía: Natural Earth.

// Conversión TopoJSON → capas del globo (países con color de bioma, fronteras y costa).
// Se ejecuta normalmente en un Web Worker (atlas-worker.js) para no bloquear el scroll.
import { geoCentroid } from 'd3-geo'
import { feature, mesh } from 'topojson-client'

// Biomas aproximados por latitud del centroide de cada país: paleta tierra real.
const BIOMES = {
  ice: [226, 233, 228],
  tundra: [150, 160, 132],
  boreal: [78, 104, 70],
  temperate: [104, 128, 76],
  arid: [196, 163, 108],
  savanna: [150, 140, 84],
  tropical: [58, 98, 56],
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rgb = (c, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

function biomeColor(lon, lat, seed) {
  const a = Math.abs(lat)
  let base
  if (a > 66) base = BIOMES.ice
  else if (a > 56) base = BIOMES.tundra
  else if (a > 46) base = BIOMES.boreal
  else if (a > 34) base = BIOMES.temperate
  else if (a > 16) base = (lon > -20 && lon < 75) || (lon > 112 && lat < 0) ? BIOMES.arid : BIOMES.savanna
  else if (a > 9) base = BIOMES.savanna
  else base = BIOMES.tropical
  // 5 tonos por bioma: permite agrupar países y pintar ~35 rellenos en vez de ~180
  const j = 0.88 + (Math.round(seed * 4) / 4) * 0.24
  return rgb(base.map((v) => clamp(v * j, 0, 255)))
}

export function buildLayer(topo) {
  const obj = topo.objects.countries
  const countries = feature(topo, obj).features
  for (const f of countries) {
    const [lon, lat] = geoCentroid(f)
    f.fill = biomeColor(lon, lat, hash(String(f.id ?? f.properties.name)))
  }
  const byFill = new Map()
  for (const f of countries) {
    if (!byFill.has(f.fill)) byFill.set(f.fill, { type: 'FeatureCollection', features: [] })
    byFill.get(f.fill).features.push(f)
  }
  return {
    countries,
    groups: [...byFill].map(([fill, fc]) => ({ fill, fc })),
    borders: mesh(topo, obj, (a, b) => a !== b),
    coast: mesh(topo, obj, (a, b) => a === b),
  }
}

// Sin dependencias: la portada importa este archivo y no debe arrastrar d3
export const EARTH_RADIUS_KM = 6371

// Distancia angular de gran círculo (haversine), en radianes
function geoDistance([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLon = (lon2 - lon1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}
export const CRUISE_KMH = 850

// Coordenadas reales [longitud, latitud] de los 6 hubs autorizados
export const HUBS = {
  'Bogotá': { coords: [-74.0721, 4.711], code: 'BOG', country: 'Colombia' },
  'Medellín': { coords: [-75.5812, 6.2442], code: 'MDE', country: 'Colombia' },
  'São Paulo': { coords: [-46.6333, -23.5505], code: 'GRU', country: 'Brasil' },
  'New York': { coords: [-74.006, 40.7128], code: 'JFK', country: 'Estados Unidos' },
  'México': { coords: [-99.1332, 19.4326], code: 'MEX', country: 'México' },
  'Toronto': { coords: [-79.3832, 43.6532], code: 'YYZ', country: 'Canadá' },
}

export const CITY_LIST = Object.keys(HUBS)

export function distanceKm(a, b) {
  return geoDistance(HUBS[a].coords, HUBS[b].coords) * EARTH_RADIUS_KM
}

export function etaLabel(km) {
  const mins = Math.round((km / CRUISE_KMH) * 60) + 25 // + rodaje y ascenso
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

export const fmtKm = (km) => `${Math.round(km).toLocaleString('es-CO')} km`

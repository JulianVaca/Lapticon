// Descarga y procesa el atlas fuera del hilo principal.
import { buildLayer } from './atlas-layer.js'

self.onmessage = async ({ data: { id, url } }) => {
  try {
    const topo = await fetch(url).then((r) => r.json())
    self.postMessage({ id, layer: buildLayer(topo) })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}

import * as Cesium from 'cesium'

// DEM 瓦片走后端 provider 代理（Go 拉取 + MBTiles 缓存，与底图影像同管线）：
// webview 内同源请求，避免前端直连 AWS S3（国内不稳、失败静默变平地、无缓存）。
export const DEM_TILES = '/map/provider/dem_terrarium/{z}/{x}/{y}'
export const DEM_MAXZOOM = 14

const HEIGHTMAP_SIZE = 64
const FLAT_TILE = (): Float32Array => new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE)

function imageSize(img: HTMLImageElement | ImageBitmap): { w: number; h: number } {
  const w = (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width
  const h = (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height
  return { w, h }
}

function decodeTerrarium(img: HTMLImageElement | ImageBitmap): Float32Array {
  const { w, h } = imageSize(img)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return FLAT_TILE()
  ctx.drawImage(img as CanvasImageSource, 0, 0)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return FLAT_TILE()
  }
  const out = new Float32Array(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE)
  for (let row = 0; row < HEIGHTMAP_SIZE; row++) {
    const sy = Math.min(h - 1, Math.floor((row * h) / HEIGHTMAP_SIZE))
    for (let col = 0; col < HEIGHTMAP_SIZE; col++) {
      const sx = Math.min(w - 1, Math.floor((col * w) / HEIGHTMAP_SIZE))
      const i = (sy * w + sx) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      out[row * HEIGHTMAP_SIZE + col] = r * 256 + g + b / 256 - 32768
    }
  }
  return out
}

export function createTerrariumTerrainProvider(): Cesium.CustomHeightmapTerrainProvider {
  return new Cesium.CustomHeightmapTerrainProvider({
    width: HEIGHTMAP_SIZE,
    height: HEIGHTMAP_SIZE,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    callback: (x: number, y: number, level: number): Float32Array | Promise<Float32Array> | undefined => {
      if (level > DEM_MAXZOOM) return undefined
      const url = DEM_TILES.replace('{z}/{x}/{y}', `${level}/${x}/${y}`)
      return new Cesium.Resource({ url })
        .fetchImage()
        .then((img) => (img ? decodeTerrarium(img) : FLAT_TILE()))
        .catch(() => FLAT_TILE())
    },
  })
}

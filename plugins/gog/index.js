// GOG: game titles, box covers, years and genres for Dove's Games search, from GOG's catalog JSON (the endpoint
// gog.com's own store pages use; no key, no login). GOG sells DRM-free PC games, so every game is PC.

const catalog = "https://catalog.gog.com/v1/catalog"

/** GOG's `productType` → Dove's game types. GOG sells many games only as a pack of editions ("The Witcher 3: Wild
 *  Hunt — Game of the Year Edition"), so a pack is the game. */
const types = { game: "game", pack: "game", dlc: "dlc" }

globalThis.plugin = {
  manifest: {
    id: "gog.metadata",
    name: "GOG",
    version: "1.0.0",
    api: 1,
    summary: "Game titles, box covers, years and genres for Games from GOG's catalog (DRM-free PC games)",
    capabilities: ["metadata"],
    categories: ["games"],
    hosts: ["catalog.gog.com"],
  },

  async metadata({ query, category }) {
    if (category !== "games") return []
    const words = query.replace(/\s+/g, " ").trim()
    if (!words) return []
    const url = `${catalog}?query=like:${encodeURIComponent(words)}&limit=24&productType=in:game,pack,dlc&countryCode=US&locale=en-US&currencyCode=USD`
    const response = await dove.fetch(url, { headers: { Accept: "application/json" } })
    if (response.status !== 200) throw new Error(`GOG answered ${response.status}`)
    const body = response.json()
    return (body.products || [])
      .filter((product) => product && product.id != null && product.title)
      .map((product) => ({
        id: String(product.id),
        // GOG writes editions with a dash: "The Witcher 3: Wild Hunt — Game of the Year Edition".
        title: product.title,
        // "2016.08.30"
        year: product.releaseDate ? Number(String(product.releaseDate).slice(0, 4)) || undefined : undefined,
        platforms: ["PC"],
        cover: product.coverVertical || undefined,
        genres: (product.genres || []).map((genre) => genre.name).filter(Boolean),
        type: types[product.productType] || product.productType,
        link: product.storeLink || undefined,
      }))
  },
}

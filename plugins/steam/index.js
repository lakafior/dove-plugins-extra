// Steam: game titles, box covers, years and genres for Dove's Games search, from the Steam store's own JSON
// (storesearch and appdetails, the endpoints the store's pages use; no key, no login). Steam sells PC games, so
// every game is PC.

const store = "https://store.steampowered.com"
// Box art in the library's 2:3 shape; old games may lack it (Dove then shows its own cover).
const box = (id) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`
/** How many results get their year and genres (one appdetails call each; the store allows about 200 in 5 minutes). */
const detailed = 6

async function get(path) {
  const response = await dove.fetch(`${store}${path}`, { headers: { Accept: "application/json" } })
  if (response.status === 429) throw new Error("Steam: too many requests, try again in a minute")
  if (response.status !== 200) throw new Error(`Steam answered ${response.status}`)
  return response.json()
}

/** "Feb 24, 2022", "24 Feb, 2022", "2022" → 2022. */
function year(text) {
  const match = String(text || "").match(/\b(19[7-9]\d|20\d\d)\b/)
  return match ? Number(match[1]) : undefined
}

async function details(id) {
  try {
    const body = await get(`/api/appdetails?appids=${id}&l=english&cc=US`)
    const entry = body && body[String(id)]
    return entry && entry.success ? entry.data : null
  } catch {
    return null
  }
}

globalThis.plugin = {
  manifest: {
    id: "steam.metadata",
    name: "Steam",
    version: "1.0.0",
    api: 1,
    summary: "Game titles, box covers, years and genres for Games from the Steam store (PC games)",
    capabilities: ["metadata"],
    categories: ["games"],
    hosts: ["store.steampowered.com"],
  },

  async metadata({ query, category }) {
    if (category !== "games") return []
    const body = await get(`/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`)
    const apps = (body.items || []).filter((item) => item && item.type === "app" && item.id != null && item.name)
    const extra = await Promise.all(apps.slice(0, detailed).map((app) => details(app.id)))
    return apps.map((app, index) => {
      const data = extra[index]
      return {
        id: String(app.id),
        title: app.name,
        year: data && data.release_date && !data.release_date.coming_soon ? year(data.release_date.date) : undefined,
        platforms: ["PC"],
        cover: box(app.id),
        summary: data ? data.short_description : undefined,
        genres: data && data.genres ? data.genres.map((genre) => genre.description) : [],
        // appdetails says `game`, `dlc`, `demo`, `music` (soundtracks)…: add-ons sink below the game in Dove.
        type: data ? (data.type === "music" ? "soundtrack" : data.type) : undefined,
        link: `${store}/app/${app.id}/`,
      }
    })
  },
}

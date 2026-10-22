// SteamGridDB: box covers (600×900 grids) for Dove's Games search, from SteamGridDB's API with your own free key.
// It knows titles and years too, but its point is artwork: the same game from IGDB is one row in Dove, which takes
// this cover when IGDB has none.

const api = "https://www.steamgriddb.com/api/v2"
/** How many results get a cover (one call each). */
const covered = 8

async function get(path, key) {
  const response = await dove.fetch(`${api}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${key}` } })
  if (response.status === 401) throw new Error("SteamGridDB did not accept the API key (Settings › Plugins › SteamGridDB)")
  if (response.status === 404) return { data: [] }
  if (response.status !== 200) throw new Error(`SteamGridDB answered ${response.status}`)
  const body = response.json()
  if (body && body.success === false) throw new Error(`SteamGridDB: ${(body.errors || []).join(", ") || "refused"}`)
  return body
}

async function cover(id, key) {
  try {
    const body = await get(`/grids/game/${id}?dimensions=600x900&types=static&nsfw=false&humor=false`, key)
    const grid = (body.data || [])[0]
    return grid ? grid.url : undefined
  } catch {
    return undefined
  }
}

globalThis.plugin = {
  manifest: {
    id: "steamgriddb.metadata",
    name: "SteamGridDB",
    version: "1.0.0",
    api: 1,
    summary: "Box covers for Games from SteamGridDB, with your free API key",
    capabilities: ["metadata"],
    categories: ["games"],
    hosts: ["www.steamgriddb.com"],
    settings: [
      {
        key: "key",
        title: "API key",
        type: "secret",
        required: true,
        help: "Free: sign in at steamgriddb.com (with Steam), then Preferences › API › Generate API key.",
      },
    ],
  },

  async metadata({ query, category }, ctx) {
    if (category !== "games") return []
    const key = String(ctx.settings.key || "").trim()
    if (!key) throw new Error("SteamGridDB needs your API key in Settings › Plugins › SteamGridDB")
    const body = await get(`/search/autocomplete/${encodeURIComponent(query.replace(/\//g, " "))}`, key)
    const games = (body.data || []).filter((game) => game && game.id != null && game.name)
    const covers = await Promise.all(games.slice(0, covered).map((game) => cover(game.id, key)))
    return games.map((game, index) => ({
      id: String(game.id),
      title: game.name,
      // A Unix time in seconds.
      year: game.release_date ? new Date(game.release_date * 1000).getUTCFullYear() : undefined,
      cover: covers[index],
      link: `https://www.steamgriddb.com/game/${game.id}`,
    }))
  },
}

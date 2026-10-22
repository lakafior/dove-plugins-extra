// RAWG: game titles, years, platforms, genres and artwork for Dove's Games search, from RAWG's API with your own
// free key (rawg.io/apidocs). RAWG asks apps to name it and link back: Dove shows "RAWG" and links each game's page.
// Its images are landscape screenshots, not box covers.

const api = "https://api.rawg.io/api"

globalThis.plugin = {
  manifest: {
    id: "rawg.metadata",
    name: "RAWG",
    version: "1.0.0",
    api: 1,
    summary: "Game titles, years, platforms, genres and artwork for Games from RAWG, with your free API key",
    capabilities: ["metadata"],
    categories: ["games"],
    hosts: ["api.rawg.io"],
    settings: [
      {
        key: "key",
        title: "API key",
        type: "secret",
        required: true,
        help: "Free for personal use: sign up at rawg.io, then rawg.io/apidocs › Get API key.",
      },
    ],
  },

  async metadata({ query, category }, ctx) {
    if (category !== "games") return []
    const key = String(ctx.settings.key || "").trim()
    if (!key) throw new Error("RAWG needs your API key in Settings › Plugins › RAWG")
    const url = `${api}/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(query)}&page_size=20`
    const response = await dove.fetch(url, { headers: { Accept: "application/json" } })
    if (response.status === 401) throw new Error("RAWG did not accept the API key (Settings › Plugins › RAWG)")
    if (response.status !== 200) throw new Error(`RAWG answered ${response.status}`)
    const body = response.json()
    return (body.results || [])
      .filter((game) => game && game.id != null && game.name)
      .map((game) => ({
        id: String(game.id),
        title: game.name,
        // "2022-02-25"
        year: game.released ? Number(String(game.released).slice(0, 4)) || undefined : undefined,
        platforms: (game.platforms || []).map((entry) => entry && entry.platform && entry.platform.name).filter(Boolean),
        cover: game.background_image || undefined,
        genres: (game.genres || []).map((genre) => genre.name).filter(Boolean),
        link: game.slug ? `https://rawg.io/games/${game.slug}` : undefined,
      }))
  },
}

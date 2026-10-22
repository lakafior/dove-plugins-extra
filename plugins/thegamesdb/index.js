// TheGamesDB: game titles, box covers, platforms, years and descriptions for Dove's Games search, from
// TheGamesDB's API with your own key (its forum hands out free keys with a monthly allowance).

const api = "https://api.thegamesdb.net/v1.1"

globalThis.plugin = {
  manifest: {
    id: "thegamesdb.metadata",
    name: "TheGamesDB",
    version: "1.0.0",
    api: 1,
    summary: "Game titles, box covers, platforms and years for Games from TheGamesDB, with your API key",
    capabilities: ["metadata"],
    categories: ["games"],
    hosts: ["api.thegamesdb.net"],
    settings: [
      {
        key: "key",
        title: "API key",
        type: "secret",
        required: true,
        help: "Ask for a public key on forums.thegamesdb.net (API Keys board); it allows a number of searches a month.",
      },
    ],
  },

  async metadata({ query, category }, ctx) {
    if (category !== "games") return []
    const key = String(ctx.settings.key || "").trim()
    if (!key) throw new Error("TheGamesDB needs your API key in Settings › Plugins › TheGamesDB")
    const url = `${api}/Games/ByGameName?apikey=${encodeURIComponent(key)}&name=${encodeURIComponent(query)}` +
      "&fields=overview&include=boxart,platform"
    const response = await dove.fetch(url, { headers: { Accept: "application/json" } })
    let body = null
    try {
      body = response.json()
    } catch {
      body = null
    }
    if (response.status === 401 || response.status === 403 || (body && body.code === 401)) {
      throw new Error("TheGamesDB did not accept the API key (Settings › Plugins › TheGamesDB)")
    }
    if (response.status !== 200 || !body || !body.data) {
      throw new Error(`TheGamesDB answered ${(body && body.status) || response.status}`)
    }
    if (body.remaining_monthly_allowance === 0) dove.log("TheGamesDB: monthly allowance used up")
    const boxart = (body.include && body.include.boxart) || {}
    const base = (boxart.base_url && (boxart.base_url.medium || boxart.base_url.original)) || ""
    const platforms = (body.include && body.include.platform && body.include.platform.data) || {}
    return (body.data.games || [])
      .filter((game) => game && game.id != null && game.game_title)
      .map((game) => {
        const art = ((boxart.data && boxart.data[String(game.id)]) || []).find((image) => image.side === "front")
        const platform = platforms[String(game.platform)]
        return {
          id: String(game.id),
          title: game.game_title,
          // "1994-03-19"
          year: game.release_date ? Number(String(game.release_date).slice(0, 4)) || undefined : undefined,
          platforms: platform && platform.name ? [platform.name] : [],
          cover: art && base ? `${base}${art.filename}` : undefined,
          summary: game.overview || undefined,
          link: `https://thegamesdb.net/game.php?id=${game.id}`,
        }
      })
  },
}

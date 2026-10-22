// ScreenScraper: retro game titles, box covers, consoles, years and descriptions for Dove's Games search, from
// screenscraper.fr's API. It needs two logins: developer credentials (ScreenScraper gives them to the authors of
// front-ends on request, on its forum) and your own screenscraper.fr account, whose level sets how many searches a
// day you get. Covers whose addresses carry a login are left out: Dove keeps covers' addresses in its library files.

const api = "https://api.screenscraper.fr/api2"
const languages = ["en", "us", "wor", "eu", "ss"]

/** ScreenScraper's region- or language-tagged lists: the English (or world) entry, else the first. */
function pick(list, key) {
  if (!Array.isArray(list) || !list.length) return undefined
  for (const wanted of languages) {
    const found = list.find((entry) => entry[key] === wanted)
    if (found) return found
  }
  return list[0]
}

globalThis.plugin = {
  manifest: {
    id: "screenscraper.metadata",
    name: "ScreenScraper",
    version: "1.0.0",
    api: 1,
    summary: "Retro game titles, box covers, consoles and years for Games from ScreenScraper, with its developer credentials and your account",
    capabilities: ["metadata"],
    categories: ["games"],
    hosts: ["api.screenscraper.fr"],
    settings: [
      { key: "devid", title: "Developer ID", type: "text", required: true, help: "From ScreenScraper's forum: the API access developers ask for." },
      { key: "devpassword", title: "Developer password", type: "secret", required: true },
      { key: "ssid", title: "Your account", type: "text", required: false, help: "Your screenscraper.fr account: more searches a day than without one." },
      { key: "sspassword", title: "Your password", type: "secret", required: false },
    ],
  },

  async metadata({ query, category }, ctx) {
    if (category !== "games") return []
    const s = ctx.settings
    const devid = String(s.devid || "").trim()
    const devpassword = String(s.devpassword || "")
    if (!devid || !devpassword) throw new Error("ScreenScraper needs developer credentials in Settings › Plugins › ScreenScraper")
    const params = [
      `devid=${encodeURIComponent(devid)}`,
      `devpassword=${encodeURIComponent(devpassword)}`,
      "softname=Dove",
      "output=json",
      `recherche=${encodeURIComponent(query)}`,
    ]
    if (s.ssid) params.push(`ssid=${encodeURIComponent(String(s.ssid).trim())}`, `sspassword=${encodeURIComponent(String(s.sspassword || ""))}`)
    const response = await dove.fetch(`${api}/jeuRecherche.php?${params.join("&")}`, { headers: { Accept: "application/json" } })
    const text = response.body || ""
    // Errors come as plain French text: "Erreur de login : Vérifier vos identifiants développeur !"
    if (response.status === 401 || response.status === 403 || /identifiants/i.test(text.slice(0, 200))) {
      throw new Error("ScreenScraper did not accept the credentials (Settings › Plugins › ScreenScraper)")
    }
    if (response.status === 429 || /quota|maximum/i.test(text.slice(0, 200))) throw new Error("ScreenScraper: today's searches are used up")
    if (response.status !== 200) throw new Error(`ScreenScraper answered ${response.status}`)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`ScreenScraper: ${text.slice(0, 120) || "an answer Dove cannot read"}`)
    }
    const games = (body.response && body.response.jeux) || []
    return games
      .filter((game) => game && game.id != null && Array.isArray(game.noms) && game.noms.length)
      .map((game) => {
        const name = pick(game.noms, "region")
        const date = pick(game.dates, "region")
        const synopsis = pick(game.synopsis, "langue")
        const box = (game.medias || []).filter((media) => media.type === "box-2D" && media.url && !/password|ssid=/i.test(media.url))
        const cover = pick(box, "region")
        return {
          id: String(game.id),
          title: name.text,
          year: date && date.text ? Number(String(date.text).slice(0, 4)) || undefined : undefined,
          platforms: game.systeme && game.systeme.text ? [game.systeme.text] : [],
          cover: cover ? cover.url : undefined,
          summary: synopsis ? synopsis.text : undefined,
          genres: (game.genres || []).map((genre) => (pick(genre.noms, "langue") || {}).text).filter(Boolean),
          aliases: game.noms.map((entry) => entry.text).filter((text) => text && text !== name.text),
          link: `https://www.screenscraper.fr/gameinfos.php?gameid=${game.id}`,
        }
      })
  },
}

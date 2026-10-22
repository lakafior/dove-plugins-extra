// LaunchBox Games Database: game titles, box covers, platforms and years for Dove's Games search, strongest on retro
// consoles and ROM hacks. gamesdb.launchbox-app.com has no public API (its data comes as a download for the LaunchBox
// app), so this reads the site's own search page. No key, no login.

import { load } from "cheerio/slim"

const site = "https://gamesdb.launchbox-app.com"
const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
}

/** LaunchBox names platforms with their makers ("Sony Playstation 2", "Nintendo Game Boy Advance"); Dove reads
 *  those, but a few are clearer spelled its own way. */
const platforms = {
  "Sega Genesis": "megaDrive",
  "Sega Mega Drive": "megaDrive",
  "Sony Playstation": "ps1",
  "Sony PSP": "psp",
  "Sony Playstation Vita": "psVita",
  "Microsoft Xbox Series X/S": "xboxSeries",
  "Nintendo Switch 2": "switch",
}

globalThis.plugin = {
  manifest: {
    id: "launchbox.metadata",
    name: "LaunchBox Games DB",
    version: "1.0.0",
    api: 1,
    summary: "Game titles, box covers, platforms and years for Games from the LaunchBox Games Database: retro consoles and ROM hacks",
    capabilities: ["metadata"],
    categories: ["games"],
    hosts: ["gamesdb.launchbox-app.com"],
  },

  async metadata({ query, category }) {
    if (category !== "games") return []
    const words = query.replace(/[\/\\?#]/g, " ").replace(/\s+/g, " ").trim()
    if (!words) return []
    const response = await dove.fetch(`${site}/games/results/${encodeURIComponent(words)}`, { headers: browserHeaders })
    if (response.status !== 200) throw new Error(`LaunchBox answered ${response.status}`)
    const $ = load(response.body)
    const games = []
    $(".games-grid-card").each((_, element) => {
      const card = $(element)
      const href = card.find("a[href^='/games/details/']").first().attr("href") || ""
      const id = (href.match(/\/games\/details\/(\d+)/) || [])[1]
      const title = card.find(".cardTitle h3").first().text().replace(/\s+/g, " ").trim()
      if (!id || !title) return
      const platform = card.find(".cardTitle p").first().text().replace(/\s+/g, " ").trim()
      // "Released" with a date, or the kind of entry: "ROM Hack", "Homebrew"…
      const label = card.find(".releaseDate span").first().text().trim()
      const date = card.find(".releaseDate h5").first().text().trim()
      const year = (date.match(/\b(19[5-9]\d|20\d\d)\b/) || [])[1]
      const cover = card.find(".cardImgPart > img").first().attr("src")
      games.push({
        id,
        title,
        year: year ? Number(year) : undefined,
        platforms: platform ? [platforms[platform] || platform] : [],
        cover: cover && /^https:/.test(cover) ? cover : undefined,
        // ROM hacks sink below the games they change.
        type: /hack/i.test(label) ? "mod" : label && label !== "Released" ? label : "game",
        link: `${site}${href}`,
      })
    })
    // The site lists ROM hacks before the game they change: keep enough rows for Dove to rank the game first.
    return games.slice(0, 60)
  },
}

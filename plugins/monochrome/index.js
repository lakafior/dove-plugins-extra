// Monochrome (monochrome.st): Hi-Res FLACs, no account. The site is a single-page app — every path answers
// the same shell — so the pages are worth nothing to a plugin; its player talks to an API instance of
// LosslessAPI (tracks.monochrome.st), where a release search and a release's tracks are one JSON call each and
// /track/<id> is the file itself (FLAC, with byte ranges, no headers needed).
// A row is a release (album, EP, single); downloading it gives every track, one FLAC each, numbered, which Dove
// files as one folder and shows as one row in Downloads. The links are plain, so a cloud service can fetch them
// too.
import { norm, score } from "../_shared/text.js"

const host = "tracks.monochrome.st"

/** One API call; the instance answers 429 when asked too fast. */
async function api(path) {
  const response = await dove.fetch(`https://${host}${path}`, { headers: { Accept: "application/json" } })
  if (response.status === 429) throw new Error("Monochrome is limiting requests; wait a moment and try again")
  if (response.status === 404) throw new Error("Monochrome no longer has this release")
  if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
  return response.json()
}

/** The file address, the way the site's own player builds it. */
function trackUrl(id) {
  return `https://${host}/track/${encodeURIComponent(id)}`
}

const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()

/** "01 - Burnout.flac", "2-03 - Title.flac" when the release has several discs. */
function fileName(discNumber, trackNumber, title, discs) {
  const track = String(trackNumber || 1).padStart(2, "0")
  const number = discs > 1 ? `${discNumber || 1}-${track}` : track
  return `${number} - ${clean(title) || "track"}.flac`
}

/** Album is the default; the rest say so in the row ("Basket Case (Single)"). */
const releaseTypes = { EP: "EP", SINGLE: "Single", COMPILATION: "Compilation", LIVE: "Live" }

globalThis.plugin = {
  manifest: {
    id: "monochrome.music",
    name: "Monochrome",
    version: "1.0.0",
    api: 1,
    summary: "Hi-Res FLAC albums from monochrome.st: search in the app and download whole releases, no account",
    capabilities: ["search", "resolve"],
    categories: ["music"],
    hosts: [host],
    links: [
      // A release's page, pasted, shared or opened in Dove's browser: monochrome.st/album/<id>.
      `^https?://(?:[a-z0-9-]+\\.)?monochrome\\.st/album/(?<id>\\d{15,20})/?`,
    ],
  },

  /**
   * From an album's screen Dove passes the album: it is searched as "artist title" and its releases come first
   * (the same title by the same artist); otherwise the API's own order, which already puts an artist's albums
   * first for a bare artist name.
   */
  async search({ query, category, album }) {
    if (category !== "music") return []
    const artist = album && (album.artists || [])[0]
    const q = String(album ? [artist, album.title].filter(Boolean).join(" ") : query || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100)
    if (!q) return []
    const answer = await api(`/search/releases?q=${encodeURIComponent(q)}&limit=25`)
    const seen = new Set()
    const rows = ((answer && answer.releases) || [])
      .map((release, order) => {
        const id = release && String(release.id || release.releaseId || "")
        if (!id || !release.title) return null
        const artists = (release.artistNames || []).join(", ")
        const type = releaseTypes[String(release.releaseType || "").toUpperCase()]
        const title = clean(release.title)
        return {
          id,
          // "Artist - Title": the download's folder, and how the Library reads the artist back.
          title: (artists ? `${artists} - ${title}` : title) + (type ? ` (${type})` : ""),
          author: artists || undefined,
          kind: "music",
          format: "flac",
          year: Number(String(release.releaseDate || "").slice(0, 4)) || undefined,
          cover: release.artwork || undefined,
          link: `https://monochrome.st/album/${id}`,
          // Its title holding the album's ("Dookie (30th Anniversary Deluxe Edition)") beats a similar-looking one
          // ("¡DOS!"); then how close title and artist are.
          holds: album && norm(title).includes(norm(album.title)) ? 1 : 0,
          fits: album ? score(`${artist || ""} ${album.title}`, title, artists ? [artists] : []) : 0,
          order,
        }
      })
      .filter((row) => row && (seen.has(row.id) ? false : seen.add(row.id)))
    if (album) rows.sort((a, b) => b.holds - a.holds || Math.round((b.fits - a.fits) * 5) || a.order - b.order)
    return rows.map(({ holds, fits, order, ...row }) => row)
  },

  /** Every playable track of the release, in disc and track order. */
  async resolve({ id }) {
    const releaseId = String(id || "").trim()
    if (!/^\d{15,20}$/.test(releaseId)) throw new Error("Not a Monochrome release id")
    const release = await api(`/releases/${encodeURIComponent(releaseId)}`)
    const tracks = ((release && release.tracks) || [])
      .filter((track) => track && track.trackId && track.title && track.playable !== false)
      .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 1) - (b.trackNumber || 1))
    if (!tracks.length) throw new Error("Monochrome has no playable tracks for this release")
    const discs = new Set(tracks.map((track) => track.discNumber || 1)).size
    dove.log(`monochrome: ${tracks.length} tracks of ${release.title}`)
    return tracks.map((track) => ({
      url: trackUrl(track.trackId),
      fileName: fileName(track.discNumber, track.trackNumber, track.title, discs),
    }))
  },
}

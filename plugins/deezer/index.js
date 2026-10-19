// Deezer: album covers, titles, types and track lists for Dove's Music search, from Deezer's public API (no key,
// no login). Deezer's API terms do not allow use alongside downloading: installing this plugin is the user's call.

const api = "https://api.deezer.com"

// Deezer's `record_type` → Dove's album types.
const types = { album: "album", ep: "ep", single: "single", compile: "compilation" }

async function get(path) {
  const response = await dove.fetch(`${api}${path}`, { headers: { Accept: "application/json" } })
  if (response.status !== 200) throw new Error(`Deezer answered ${response.status}`)
  const body = response.json()
  // Errors come with status 200: {"error":{"type":"Exception","message":"Quota limit exceeded","code":4}}.
  if (body && body.error) {
    throw new Error(body.error.code === 4 ? "Deezer: too many requests, try again in a few seconds" : `Deezer: ${body.error.message}`)
  }
  return body
}

function album(item) {
  if (!item || item.id == null || !item.title) return null
  return {
    id: String(item.id),
    title: item.title,
    artist: item.artist && item.artist.name,
    cover: item.cover_xl || item.cover_big || item.cover_medium,
    type: types[item.record_type] || item.record_type,
    link: item.link,
  }
}

globalThis.plugin = {
  manifest: {
    id: "deezer.metadata",
    name: "Deezer",
    version: "1.0.0",
    api: 1,
    summary: "Album covers, titles and track lists for Music from Deezer's catalog",
    capabilities: ["metadata"],
    categories: ["music"],
    hosts: ["api.deezer.com"],
  },

  // Deezer's own relevance order: it finds albums by title and by artist ("radiohead" lists the band's albums).
  // The search answer has no release year; asking each album for it would spend Deezer's 50 calls per 5 seconds.
  async metadata({ query, category }) {
    if (category !== "music") return []
    const body = await get(`/search/album?q=${encodeURIComponent(query)}&limit=25`)
    return (body.data || []).map(album).filter(Boolean)
  },

  async tracks({ id }) {
    const body = await get(`/album/${encodeURIComponent(id)}/tracks?limit=200`)
    return (body.data || []).map((track, index) => ({
      id: String(track.id),
      title: track.title,
      disc: track.disk_number,
      position: track.track_position || index + 1,
      duration: track.duration,
    }))
  },
}

// ARCOD (arcod.xyz): Qobuz releases in FLAC up to 24-bit/192 kHz, ripped on ARCOD's servers for a free account.
// Its site is a front for a plain JSON API: a search (/api/get-music, Qobuz's own catalog answer) and a release's
// tracks (/api/get-album) need no account; a download is a job for a signed-in account — POST /api/v2/downloads
// with the release and track, then its status until "completed", then /url for the file's address. The account
// signs in through Supabase (the site's own project and public key) with the e-mail and password from Settings;
// the site sends the session's access token as it is in Authorization (no "Bearer"), so does this plugin.
//
// A row is a release or a single track; a release resolves to one FLAC per track (one folder, one row in Dove's
// Downloads). Each track is a job of its own, four at a time. A call has 30 seconds and a long album can take
// longer to rip, so tracks the account already ripped are taken from its library (GET /api/v2/downloads, the
// "Library" on the site) instead of asked again: when time runs out, the error says to try again in a minute, by
// when the jobs started this time have finished and come from the library.
import { norm, score } from "../_shared/text.js"

const host = "arcod.xyz"
const supabase = "fnlghyzwyoklfqyhqlav.supabase.co"
// The site's public (anon) key, the one its own page signs in with.
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZubGdoeXp3eW9rbGZxeWhxbGF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDExODAsImV4cCI6MjA4OTY3NzE4MH0.9J1-JK1jJYunBM6bF-_MLR5UvhDV4BibXordTOzH2_0"
const headers = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json",
}
/** Seconds of the call's 30 spent on jobs before giving up for now. */
const budget = 22000

/** One API call; JSON either way, with the status for the caller to read. */
async function api(path, { method = "GET", body, token, jobToken } = {}) {
  const response = await dove.fetch(`https://${host}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: token } : {}),
      ...(jobToken ? { "X-Download-Token": jobToken } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let answer = null
  try {
    answer = response.json()
  } catch {
    answer = null
  }
  if (response.status === 401) throw new Error("ARCOD did not accept the sign-in; check the e-mail and password in Settings › Plugins › ARCOD")
  if (response.status === 429) throw new Error("ARCOD is limiting downloads for this account; try again later")
  if (response.status >= 500 && !answer) throw new Error(`arcod.xyz answered ${response.status}`)
  return { status: response.status, answer: answer || {} }
}

/** The account's access token (every call runs in a fresh context, so each one signs in). */
async function signIn(ctx) {
  const email = String(ctx.settings.email || "").trim()
  const password = String(ctx.settings.password || "")
  if (!email || !password) throw new Error("ARCOD needs your account's e-mail and password in Settings › Plugins › ARCOD")
  const response = await dove.fetch(`https://${supabase}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { ...headers, apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  let answer = {}
  try {
    answer = response.json()
  } catch {
    answer = {}
  }
  if (!answer.access_token) {
    const reason = answer.error_description || answer.msg || answer.message || `status ${response.status}`
    if (/confirm/i.test(reason)) throw new Error("ARCOD: confirm the account's e-mail address first")
    throw new Error(`ARCOD sign-in failed: ${reason}`)
  }
  return answer.access_token
}

const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
const titled = (title, version) => (version ? `${title} (${version})` : String(title || ""))

/** "01 - Airbag (Remastered).flac", "2-03 - …" when the release has several discs. */
function fileName(track, discs) {
  const number = String(track.track_number || 1).padStart(2, "0")
  const prefix = discs > 1 ? `${track.media_number || 1}-${number}` : number
  return `${prefix} - ${clean(titled(track.title, track.version)) || "track"}.flac`
}

/** "24-bit / 192 kHz" for a row's title. */
const quality = (item) =>
  item.maximum_bit_depth ? `${item.maximum_bit_depth}-bit / ${item.maximum_sampling_rate} kHz` : undefined

/** The settings' quality as Qobuz's format id: 27 = up to 24/192, 6 = CD (16/44.1). */
const formatID = (ctx) => (ctx.settings.cdQuality === true || ctx.settings.cdQuality === "true" ? 6 : 27)

/** The account's ripped tracks, by Qobuz track id, newest first. */
async function library(token) {
  const { status, answer } = await api("/api/v2/downloads", { token })
  if (status !== 200) return new Map()
  const items = answer.downloads || answer.items || []
  const byTrack = new Map()
  for (const item of items) {
    const trackID = String(item.trackId || (item.metadata && item.metadata.id) || "")
    if (!trackID || byTrack.has(trackID)) continue
    const done = item.status ? item.status === "completed" : !!(item.hasFile || item.fileName || item.url || item.downloadUrl)
    if (done) byTrack.set(trackID, item)
  }
  return byTrack
}

/** A finished job's file address. */
async function fileURL(id, token, jobToken) {
  const { answer } = await api(`/api/v2/downloads/${encodeURIComponent(id)}/url`, { method: "POST", body: {}, token, jobToken })
  return answer.downloadUrl || answer.url
}

/** Starts one track's job, then waits for it until the deadline: its file's address, or null when still running. */
async function ripTrack(album, track, ctx, token, deadline) {
  const body = {
    albumId: String(album.id),
    trackId: String(track.id),
    albumTitle: album.title,
    artistName: (album.artist && album.artist.name) || "",
    artistId: String((album.artist && album.artist.id) || ""),
    coverUrl: (album.image && album.image.large) || "",
    releaseDate: album.release_date_original,
    tracksCount: 1,
    quality: formatID(ctx),
    format: "FLAC",
    embedLyrics: true,
    lyricsMode: "embed",
    downloadBooklet: false,
    attachCover: true,
    source: "qobuz",
  }
  const created = await api("/api/v2/downloads", { method: "POST", body, token })
  if (!created.answer.id) {
    throw new Error(`ARCOD did not start the job: ${created.answer.error || created.answer.message || `status ${created.status}`}`)
  }
  const { id, accessToken } = created.answer
  while (Date.now() < deadline) {
    await dove.sleep(2000)
    const { answer } = await api(`/api/v2/downloads/${encodeURIComponent(id)}`, { token, jobToken: accessToken })
    if (answer.status === "completed") return fileURL(id, token, accessToken)
    if (answer.status === "failed" || answer.status === "cancelled") {
      throw new Error(`ARCOD could not rip “${track.title}”: ${answer.error || answer.status}`)
    }
  }
  return null
}

/** Runs `work` over items, at most `limit` at a time, keeping order; errors are kept, not swallowed. */
async function each(items, limit, work) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = { value: await work(items[index], index) }
      } catch (error) {
        results[index] = { error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Qobuz's release (with its tracks) through ARCOD. */
async function release(albumID) {
  const { status, answer } = await api(`/api/get-album?album_id=${encodeURIComponent(albumID)}`)
  if (status === 404 || !answer.data) throw new Error("ARCOD no longer has this release")
  return answer.data
}

globalThis.plugin = {
  manifest: {
    id: "arcod.music",
    name: "ARCOD",
    version: "1.0.0",
    api: 1,
    summary: "Qobuz releases in FLAC up to 24-bit/192 kHz from arcod.xyz with your free account: search in the app, download whole releases or tracks",
    capabilities: ["search", "resolve"],
    categories: ["music"],
    hosts: [host, supabase],
    settings: [
      {
        key: "email",
        title: "E-mail",
        type: "text",
        required: true,
        help: "Your arcod.xyz account (sign up on the site, free). Tracks are ripped on ARCOD's servers for it and stay in its Library there.",
      },
      { key: "password", title: "Password", type: "secret", required: true },
      { key: "cdQuality", title: "CD quality only (16-bit, smaller files)", type: "toggle", default: false },
    ],
    links: [
      // Qobuz release pages (shared from Qobuz, pasted): www/play/open.qobuz.com/…/album/<slug>/<id>.
      `^https?://(?:www|play|open)\\.qobuz\\.com/(?:[a-z]{2}-[a-z]{2}/)?album/(?:[^/?#]+/)?(?<id>[a-z0-9]{6,20})/?(?:[?#]|$)`,
    ],
  },

  /**
   * Releases first (from an album's screen, the same title by the same artist comes first), then single tracks.
   * Search needs no account.
   */
  async search({ query, category, album }) {
    if (category !== "music") return []
    const artist = album && (album.artists || [])[0]
    const q = String(album ? [artist, album.title].filter(Boolean).join(" ") : query || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100)
    if (!q) return []
    const { status, answer } = await api(`/api/get-music?q=${encodeURIComponent(q)}`)
    if (status !== 200 || !answer.data) throw new Error(`ARCOD search failed${answer.error ? `: ${answer.error}` : ""}`)

    const releases = ((answer.data.albums && answer.data.albums.items) || [])
      .filter((item) => item && item.id && item.title && item.streamable !== false)
      .map((item, order) => {
        const artists = (item.artist && item.artist.name) || ""
        const title = clean(titled(item.title, item.version))
        const hires = quality(item)
        return {
          id: `album:${item.id}`,
          title: (artists ? `${artists} - ${title}` : title) + (hires ? ` [${hires}]` : ""),
          author: artists || undefined,
          kind: "music",
          format: "flac",
          year: Number(String(item.release_date_original || "").slice(0, 4)) || undefined,
          cover: (item.image && (item.image.large || item.image.small)) || undefined,
          link: `https://open.qobuz.com/album/${item.id}`,
          holds: album && norm(title).includes(norm(album.title)) ? 1 : 0,
          fits: album ? score(`${artist || ""} ${album.title}`, title, artists ? [artists] : []) : 0,
          order,
        }
      })
    if (album) releases.sort((a, b) => b.holds - a.holds || Math.round((b.fits - a.fits) * 5) || a.order - b.order)

    // Single tracks only from the search field: an album's screen wants releases.
    const tracks = album
      ? []
      : ((answer.data.tracks && answer.data.tracks.items) || [])
          .filter((item) => item && item.id && item.title && item.album && item.album.id && item.streamable !== false)
          .slice(0, 15)
          .map((item) => {
            const artists = (item.performer && item.performer.name) || ""
            return {
              id: `track:${item.album.id}:${item.id}`,
              title: `${artists ? `${artists} - ` : ""}${clean(titled(item.title, item.version))} (track, ${clean(item.album.title)})`,
              author: artists || undefined,
              kind: "music",
              format: "flac",
              year: Number(String(item.release_date_original || "").slice(0, 4)) || undefined,
              cover: (item.album.image && (item.album.image.large || item.album.image.small)) || undefined,
            }
          })

    return [...releases.map(({ holds, fits, order, ...row }) => row), ...tracks]
  },

  async resolve({ id }, ctx) {
    const raw = String(id || "").trim()
    let albumID
    let trackID
    if (raw.startsWith("track:")) [, albumID, trackID] = raw.split(":")
    else albumID = raw.replace(/^album:/, "")
    if (!/^[a-z0-9]{6,20}$/i.test(albumID || "")) throw new Error("Not an ARCOD release id")

    const started = Date.now()
    const [token, album] = await Promise.all([signIn(ctx), release(albumID)])
    let tracks = ((album.tracks && album.tracks.items) || []).filter((track) => track && track.id && track.streamable !== false)
    if (trackID) tracks = tracks.filter((track) => String(track.id) === trackID)
    if (!tracks.length) throw new Error("ARCOD has no downloadable tracks for this release")
    tracks.sort((a, b) => (a.media_number || 1) - (b.media_number || 1) || (a.track_number || 1) - (b.track_number || 1))
    const discs = new Set(tracks.map((track) => track.media_number || 1)).size

    const ripped = await library(token)
    const deadline = started + budget
    const results = await each(tracks, 4, async (track) => {
      const done = ripped.get(String(track.id))
      if (done) {
        const url = done.url || done.downloadUrl || (await fileURL(done.id, token))
        if (url) return url
      }
      return ripTrack(album, track, ctx, token, deadline)
    })

    const failed = results.find((result) => result.error)
    if (failed && !results.some((result) => result.value)) throw failed.error
    const waiting = results.filter((result) => !result.error && !result.value).length
    if (waiting) {
      throw new Error(
        `ARCOD is still ripping ${waiting} of ${tracks.length} tracks; try again in a minute (the finished ones come from your ARCOD library)`,
      )
    }
    if (failed) dove.log(`arcod: ${results.filter((result) => result.error).length} tracks failed: ${failed.error.message}`)
    const reused = tracks.filter((track) => ripped.has(String(track.id))).length
    dove.log(`arcod: ${album.title}: ${tracks.length} tracks, ${reused} from the library`)

    return tracks
      .map((track, index) => (results[index].value ? { url: results[index].value, fileName: fileName(track, discs) } : null))
      .filter(Boolean)
  },
}

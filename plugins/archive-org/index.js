// Internet Archive: search archive.org's public items in every Dove category (books, audiobooks, music, movies,
// games, software) and download them. Uses archive.org's own APIs (advancedsearch, metadata); no account. Items
// archive.org only lends (borrowable books) or keeps dark are left out. Download links are plain https URLs, so a
// cloud service (Offcloud, TorBox, Premiumize) can fetch them too.

const site = "https://archive.org"

/** Formats that are archive.org's own bookkeeping or previews, never what the user came for. */
const junk = new Set([
  "Metadata", "Item Tile", "Thumbnail", "JPEG Thumb", "Archive BitTorrent", "Spectrogram", "Animated GIF",
  "Essentia High GZ", "Essentia Low GZ", "Dublin Core", "MARC", "MARC Binary", "MARC Source", "Abbyy GZ", "chOCR",
  "hOCR", "Djvu XML", "Scandata", "Page Numbers JSON", "OCR Search Text", "OCR Page Index", "Cloth Cover Detection Log",
  "DjVuTXT", "Text", "ASR", "Item CDX Index", "Item CDX Meta-Index", "WARC CDX Index", "Columbia Peaks", "PNG",
  "JPEG", "GIF", "JSON", "Web ARChive GZ", "Storj Upload Log", "Storj Upload Trigger", "Log",
])
const images = /\.(png|jpe?g|gif|webp|bmp)$/i

/** What each Dove category searches, as an advancedsearch clause. */
const scopes = {
  books: "mediatype:texts",
  audiobooks: "mediatype:audio AND (collection:librivoxaudio OR collection:audio_bookspoetry OR subject:audiobook)",
  music: "mediatype:audio AND NOT collection:librivoxaudio AND NOT collection:audio_bookspoetry",
  media: "mediatype:movies",
  games: "mediatype:software AND NOT collection:winampskins",
  software: "mediatype:software AND NOT collection:winampskins",
  all: "",
}

/** Lucene's own characters out of the user's words. */
function clean(text) {
  return String(text || "").replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, " ").replace(/\s+/g, " ").trim()
}

/** The search: the title in `title:`, the rest of what Dove knows (author, artist) as plain words. */
function lucene(category, query, book, title, album) {
  const parts = []
  if (book && book.title) {
    parts.push(`title:(${clean(book.title)})`)
    const author = (book.authors || [])[0]
    if (author) parts.push(`creator:(${clean(author.split(/\s+/).pop())})`)
  } else if (album && album.title) {
    parts.push(`title:(${clean(album.title)})`)
    const artist = (album.artists || [])[0]
    if (artist) parts.push(`(${clean(artist)})`)
  } else if (title && title.name) {
    parts.push(`title:(${clean(title.name)})`)
  } else {
    const words = clean(query)
    if (!words) return null
    parts.push(`title:(${words})`)
  }
  const scope = scopes[category] ?? ""
  if (scope) parts.push(`(${scope})`)
  // Collections and web captures are lists of other items, with nothing of their own to download.
  parts.push("NOT access-restricted-item:true", "NOT mediatype:(collection OR web OR account)")
  return parts.join(" AND ")
}

/** The Dove kind of an item, from the category asked or archive.org's media type and collections. */
function kindOf(category, mediatype, collections) {
  if (category === "audiobooks") return "audiobooks"
  if (category === "games") return "games"
  if (category === "software") return "software"
  switch (mediatype) {
    case "texts": return "books"
    case "audio": return (collections || []).some((c) => /librivox|audio_bookspoetry/i.test(c)) ? "audiobooks" : "music"
    case "movies": return "video"
    case "software": return "software"
    default: return "other"
  }
}

const one = (value) => (Array.isArray(value) ? value[0] : value)

async function getJSON(url) {
  const response = await dove.fetch(url, { headers: { Accept: "application/json" } })
  if (response.status === 503 || response.status === 429) throw new Error("archive.org is busy, try again in a minute")
  if (response.status !== 200) throw new Error(`archive.org answered ${response.status}`)
  return response.json()
}

function link(identifier, file) {
  const path = String(file.name).split("/").map(encodeURIComponent).join("/")
  return { url: `${site}/download/${encodeURIComponent(identifier)}/${path}`, fileName: file.name, size: Number(file.size) || undefined }
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
const bySize = (a, b) => (Number(b.size) || 0) - (Number(a.size) || 0)
const ext = (file) => (String(file.name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || ""

/** The files worth downloading for each kind. */
function pick(kind, files) {
  const useful = files.filter((file) => file.private !== "true" && !junk.has(file.format) && !/_meta\.|_files\.xml$|__ia_thumb/.test(file.name))
  switch (kind) {
    case "books": {
      // One file: an ebook reader's first choice.
      const order = ["epub", "pdf", "mobi", "azw3", "djvu", "fb2", "cbz", "cbr", "txt"]
      const ranked = useful.filter((file) => order.includes(ext(file)))
        .sort((a, b) => order.indexOf(ext(a)) - order.indexOf(ext(b)) || (a.source === "original" ? -1 : 1))
      return ranked.slice(0, 1)
    }
    case "audiobooks": {
      // LibriVox makes the book as m4b (one file, or a few parts for a long one): those beat sixty MP3 chapters.
      const m4b = useful.filter((file) => ext(file) === "m4b").sort(byName)
      if (m4b.length) return m4b
      return audio(useful)
    }
    case "music":
      return audio(useful)
    case "video": {
      const videos = useful.filter((file) => /^(mkv|mp4|m4v|mov|avi|webm|mpg|mpeg|m2ts|ts|ogv)$/.test(ext(file)))
      const friendly = videos.filter((file) => /^(mkv|mp4|m4v|mov)$/.test(ext(file)) && file.source === "original")
      return (friendly.length ? friendly : videos).sort(bySize).slice(0, 1)
    }
    default: {
      // Games and software: every original file but screenshots and box scans.
      return useful.filter((file) => file.source !== "derivative" && !images.test(file.name)).sort(byName)
    }
  }
}

/** An album's or audiobook's tracks: lossless originals when there are any, else the MP3s, in track order. */
function audio(files) {
  const tracks = files.filter((file) => /^(flac|mp3|m4a|ogg|opus|wav|aiff?|ape|wv)$/.test(ext(file)))
  for (const wanted of [["flac"], ["wav", "aif", "aiff"], ["mp3"], ["m4a", "ogg", "opus"]]) {
    const originals = tracks.filter((file) => wanted.includes(ext(file)) && file.source === "original")
    if (originals.length) return originals.sort(byName)
  }
  return tracks.filter((file) => ext(file) === "mp3").sort(byName)
}

/** More files than this is a collection (a ROM set, a discography): Dove would start a download per file. */
const maxFiles = 150

globalThis.plugin = {
  manifest: {
    id: "archive.org",
    name: "Internet Archive",
    version: "1.0.1",
    api: 1,
    summary: "Public items from archive.org in every category: books, LibriVox audiobooks, music, films, games and software; no account",
    capabilities: ["search", "resolve"],
    categories: ["all", "media", "books", "audiobooks", "music", "games", "software"],
    hosts: ["archive.org"],
    links: ["^https://archive\\.org/(?:details|download)/(?<id>[^/?#]+)"],
  },

  async search({ query, category, book, title, album }) {
    const q = lucene(category, query, book, title, album)
    if (!q) return []
    const fields = ["identifier", "title", "creator", "year", "mediatype", "collection", "downloads"]
    const url = `${site}/advancedsearch.php?q=${encodeURIComponent(q)}&${fields.map((f) => `fl[]=${f}`).join("&")}` +
      "&sort[]=downloads+desc&rows=40&output=json"
    const body = await getJSON(url)
    return ((body.response && body.response.docs) || [])
      .filter((doc) => doc && doc.identifier && doc.title)
      .map((doc) => {
        const kind = kindOf(category, one(doc.mediatype), [].concat(doc.collection || []))
        const creator = one(doc.creator)
        return {
          id: `${kind}|${doc.identifier}`,
          title: String(one(doc.title)).replace(/\s+/g, " ").trim(),
          author: creator ? String(creator) : undefined,
          kind,
          year: Number(one(doc.year)) || undefined,
          cover: `${site}/services/img/${encodeURIComponent(doc.identifier)}`,
          link: `${site}/details/${encodeURIComponent(doc.identifier)}`,
        }
      })
  },

  async resolve({ id }) {
    // "kind|identifier" from a search row, or a bare identifier from an archive.org page.
    const raw = String(id || "")
    const split = raw.indexOf("|")
    const identifier = split >= 0 ? raw.slice(split + 1) : raw
    if (!/^[A-Za-z0-9._-]+$/.test(identifier)) throw new Error("Not an archive.org item")
    const item = await getJSON(`${site}/metadata/${encodeURIComponent(identifier)}`)
    if (!item || !item.metadata) throw new Error("archive.org has no such item")
    if (item.is_dark || String(item.metadata["access-restricted-item"]) === "true") {
      throw new Error("archive.org only lends this item (borrowing in its own reader): it cannot be downloaded")
    }
    const kind = split >= 0 ? raw.slice(0, split) : kindOf(null, one(item.metadata.mediatype), [].concat(item.metadata.collection || []))
    const files = pick(kind, item.files || [])
    if (!files.length) throw new Error("This item has no file Dove can download (it may be streamed or lent only)")
    if (files.length > maxFiles) {
      throw new Error(`This item holds ${files.length} files: open it on archive.org and download the one you want`)
    }
    const links = files.map((file) => link(identifier, file))
    return links.length === 1 ? links[0] : links
  },
}

// Wolnelektury (wolnelektury.pl): public domain books and audiobooks, no account. The site has no JSON
// search endpoint (/api/books/ is a 5 MB dump that ignores query params), but it serves an OPDS catalog
// that searches by title and author and answers in Atom XML with a direct epub link per book. Audio
// comes from /api/audiobooks/ (1 MB: every work the site has a recording of) and a book's mp3s from its
// /api/books/<slug>/ details. resolve returns the files; Dove downloads them.
import { load } from "cheerio/slim"
import { norm, score } from "../_shared/text.js"

const host = "wolnelektury.pl"

/** One OPDS search feed, parsed; title= and author= filter (substring), q= searches titles. */
async function feed(params) {
  const url = `https://${host}/opds/search/?` + params.join("&")
  const response = await dove.fetch(url, { headers: { Accept: "application/atom+xml" } })
  if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
  return load(response.body, { xmlMode: true })
}

/** Rows from a feed, best match first, `match` dropped (Dove's rows have no such field). */
function rows($, q) {
  const out = []
  $("entry").each((_, element) => {
    const entry = $(element)
    const slug = (entry.find("id").text().match(/\/katalog\/lektura\/([a-z0-9-]+)\//) || [])[1]
    const epub = entry
      .find('link[rel="http://opds-spec.org/acquisition"][type="application/epub+zip"]')
      .first()
    const title = entry.find("title").text().replace(/\s+/g, " ").trim()
    if (!slug || !epub.length || !title) return

    const authors = entry
      .find("author name")
      .map((_, name) => $(name).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean)
    const length = Number(epub.attr("length"))
    out.push({
      id: slug,
      title,
      author: authors[0],
      kind: "books",
      format: "epub",
      size: length > 0 ? length : undefined,
      cover: `https://${host}/media/book/cover/${slug}.jpg`,
      link: `https://${host}/katalog/lektura/${slug}/`,
      match: score(q, title, authors),
    })
  })
  return out.sort((a, b) => b.match - a.match).map(({ match, ...row }) => row)
}

/** Everything the site has a recording of (1 MB JSON). */
async function audioCatalog() {
  const response = await dove.fetch(`https://${host}/api/audiobooks/`, { headers: { Accept: "application/json" } })
  if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
  return response.json()
}

/** Audio rows: the works whose title (and author) answer the words best. */
function audioRows(catalog, q, authorHint, limit = 20) {
  const qn = norm(q)
  const an = authorHint ? norm(authorHint.split(/\s+/).pop()) : ""
  const ranked = catalog
    .map((item) => {
      const title = String(item.title || "").replace(/\s+/g, " ").trim()
      const author = item.author ? String(item.author).replace(/\s+/g, " ").trim() : undefined
      // Titles here are long ("Pan Tadeusz, czyli ostatni zajazd na Litwie"), which Dice similarity
      // punishes; a title that contains the words (or vice versa) is the match the user means.
      const contains = qn && (norm(title).includes(qn) || qn.includes(norm(title)))
      const authorMatch = an && norm(author || "").includes(an)
      return {
        id: `${item.slug}.audio`,
        title,
        author,
        kind: "audiobooks",
        format: "mp3",
        cover: `https://${host}/media/book/cover/${item.slug}.jpg`,
        link: `https://${host}/katalog/lektura/${item.slug}/`,
        match: score(q, title, author ? [author] : []) + (contains ? 0.3 : 0) + (authorMatch ? 0.15 : 0),
      }
    })
    .filter((row) => row.title && row.match >= 0.5)
    .sort((a, b) => b.match - a.match)
    .slice(0, limit)
    .map(({ match, ...row }) => row)
  return ranked
}

function fileName(title, author, format) {
  const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
  const base = [clean(title), clean(author)].filter(Boolean).join(" - ").slice(0, 150) || "book"
  return format ? `${base}.${format}` : base
}

globalThis.plugin = {
  manifest: {
    id: "wolnelektury.books",
    name: "Wolnelektury",
    version: "1.0.0",
    api: 1,
    summary: "Polish public domain books and audiobooks from wolnelektury.pl: search and download in the app, no account",
    capabilities: ["search", "resolve"],
    categories: ["books", "audiobooks"],
    hosts: [host],
    links: [`^https?://${host.replace(/\./g, "\\.")}/katalog/lektura/(?<id>[a-z0-9-]+)/?`],
  },

  async search({ query, category, book }, ctx) {
    // Audiobooks: the recording catalog is small (1 MB), so it is scored in the plugin, word order and
    // extra words ("author title") included, instead of the OPDS feed's whole-phrase matching.
    if (category === "audiobooks") {
      const q = book && book.title ? book.title : String(query || "").trim()
      if (!q) return []
      return audioRows(await audioCatalog(), q, book ? (book.authors || [])[0] : undefined)
    }

    // A picked book: its title and first author's surname. The author filter narrows well, but a book
    // Wolnelektury attribute differently (an anthology, a translator credited first) must still be found.
    if (book && book.title) {
      const title = `title=${encodeURIComponent(book.title)}`
      const author = (book.authors || [])[0]
      if (author) {
        const found = rows(await feed([title, `author=${encodeURIComponent(author.split(/\s+/).pop())}`]), book.title)
        if (found.length) return found
      }
      return rows(await feed([title]), book.title)
    }

    // Free text: the whole phrase against titles. Dove often sends "author title", and the feed matches
    // whole phrases only, so with no hits the last word (usually the author) is dropped and it is retried.
    const q = String(query || "").trim()
    if (!q) return []
    const found = rows(await feed([`q=${encodeURIComponent(q)}`]), q)
    if (found.length) return found
    const shorter = q.split(/\s+/).slice(0, -1).join(" ")
    if (!shorter) return []
    return rows(await feed([`q=${encodeURIComponent(shorter)}`]), q)
  },

  async resolve({ id }, ctx) {
    const match = String(id || "").toLowerCase().match(/^([a-z0-9-]+)(?:\.(audio))?$/)
    if (!match) throw new Error("Not a Wolnelektury book id")
    const [, slug, audio] = match
    const response = await dove.fetch(`https://${host}/api/books/${slug}/`, { headers: { Accept: "application/json" } })
    if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
    let answer
    try {
      answer = response.json()
    } catch {
      throw new Error("Wolnelektury gave no book details")
    }

    // An audiobook: its recording, one mp3 per part, in reading order.
    if (audio) {
      const parts = (answer.media || []).filter((item) => item.type === "mp3" && item.url)
      if (!parts.length) throw new Error("Wolnelektury has no audiobook for this work")
      return parts.map((part, index) => ({
        url: part.url,
        fileName: fileName(`${String(index + 1).padStart(2, "0")} - ${answer.title}`, undefined, "mp3"),
      }))
    }

    // A book: formats the API lists, in Apple Books order.
    const url = answer.epub || answer.pdf || answer.mobi || answer.fb2 || answer.txt
    if (!url) throw new Error("Wolnelektury gave no download link for this book")
    const format = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/) || [])[1]
    const author = ((answer.authors || [])[0] || {}).name
    return { url, fileName: fileName(answer.title, author, format) }
  },
}

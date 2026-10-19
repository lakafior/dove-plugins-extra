// Wolnelektury (wolnelektury.pl): public domain books and audiobooks, no account. Search happens only for
// a book the user picked from Dove's metadata list (Open Library / Apple Books): free-text queries are
// left to that list, so this plugin's rows appear among the files to download, one step after the book.
// Books come from the site's OPDS catalog (no JSON search exists: /api/books/ is a 5 MB dump that ignores
// query parameters), which answers in Atom XML with a direct epub link per book. Audiobooks: the recording
// catalog /api/audiobooks/ is small (1 MB), and a recording sits on a work or on that work's parts, so the
// works are grouped (a part's details name their parent) and resolve returns every part's mp3s in reading
// order, which Dove downloads as the audiobook's files.
import { load } from "cheerio/slim"
import { mapLimited, norm, score } from "../_shared/text.js"

const host = "wolnelektury.pl"

/** A work's details (formats, mp3s, parts); the parent of a part names the work it belongs to. */
async function detail(slug) {
  const response = await dove.fetch(`https://${host}/api/books/${slug}/`, { headers: { Accept: "application/json" } })
  if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
  let answer
  try {
    answer = response.json()
  } catch {
    throw new Error("Wolnelektury gave no book details")
  }
  return answer
}

/** One OPDS search feed, parsed; title= and author= filter (substring), q= searches titles. */
async function feed(params) {
  const url = `https://${host}/opds/search/?` + params.join("&")
  const response = await dove.fetch(url, { headers: { Accept: "application/atom+xml" } })
  if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
  return load(response.body, { xmlMode: true })
}

/** Book rows from a feed, best match first, `match` dropped (Dove's rows have no such field). */
function bookRows($, q) {
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
  let answer
  try {
    answer = response.json()
  } catch {
    throw new Error("Wolnelektury gave no audiobook catalog")
  }
  return Array.isArray(answer) ? answer : []
}

/** A part's reading order: the number at the end of its sort key ("author$title$2593"). */
function partOrder(work) {
  const number = Number(String((work || {}).full_sort_key || "").split("$").pop())
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER
}

/**
 * Audiobook rows for a book. Candidates are recordings that answer the book's title and author; each
 * one's details say which work it belongs to (a recording of a whole work, or of one part of it), and the
 * parts of a work collapse into one row, the work's own title on it.
 */
async function audioRows(catalog, book) {
  const qn = norm(book.title)
  const authorHint = (book.authors || [])[0]
  const an = authorHint ? norm(authorHint.split(/\s+/).pop()) : ""
  const candidates = catalog
    .map((item) => {
      const title = String(item.title || "").replace(/\s+/g, " ").trim()
      const author = item.author ? String(item.author).replace(/\s+/g, " ").trim() : undefined
      // Titles here are long ("Pan Tadeusz, czyli ostatni zajazd na Litwie"), which Dice similarity
      // punishes; a title that contains the words (or vice versa) is the match the user means.
      const contains = qn && (norm(title).includes(qn) || qn.includes(norm(title)))
      const authorMatch = an && norm(author || "").includes(an)
      return {
        slug: item.slug,
        title,
        author,
        match: score(book.title, title, author ? [author] : []) + (contains ? 0.3 : 0) + (authorMatch ? 0.15 : 0),
      }
    })
    .filter((row) => row.slug && row.title && row.match >= 0.5)
    .sort((a, b) => b.match - a.match)
    .slice(0, 12)

  // Which work each candidate is a recording of (a part's parent, or the work itself).
  const details = await mapLimited(candidates, 5, (candidate) => detail(candidate.slug))
  const groups = new Map()
  details.forEach((answer, index) => {
    if (!answer) return
    const work = answer.parent && answer.parent.slug ? answer.parent : candidates[index]
    const group = groups.get(work.slug) || { title: work.title, author: work.author, match: 0 }
    group.match = Math.max(group.match, candidates[index].match)
    groups.set(work.slug, group)
  })

  return [...groups.entries()]
    .sort((a, b) => b[1].match - a[1].match)
    .slice(0, 20)
    .map(([slug, group]) => ({
      id: `${slug}.audio`,
      title: String(group.title || "").replace(/\s+/g, " ").trim(),
      author: group.author ? String(group.author).replace(/\s+/g, " ").trim() : undefined,
      kind: "audiobooks",
      format: "mp3",
      cover: `https://${host}/media/book/cover/${slug}.jpg`,
      link: `https://${host}/katalog/lektura/${slug}/`,
    }))
    .filter((row) => row.title)
}

function fileName(title, format) {
  const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
  return `${clean(title).slice(0, 150) || "book"}.${format}`
}

globalThis.plugin = {
  manifest: {
    id: "wolnelektury.books",
    name: "Wolnelektury",
    version: "1.0.0",
    api: 1,
    summary: "Polish public domain books and audiobooks from wolnelektury.pl: download in the app, no account",
    capabilities: ["search", "resolve"],
    categories: ["books", "audiobooks"],
    hosts: [host],
    links: [`^https?://${host.replace(/\./g, "\\.")}/katalog/lektura/(?<id>[a-z0-9-]+)/?`],
  },

  async search({ query, category, book }, ctx) {
    // Without a picked book there is nothing to answer: free text is Dove's metadata search, and this
    // plugin's rows belong with the files of a book the user chose there.
    if (!book || !book.title) return []

    // Audiobooks: the recording catalog, scored here, its works grouped (parts under their work).
    if (category === "audiobooks") return audioRows(await audioCatalog(), book)

    // Books: the picked book's title and first author's surname. The author filter narrows well, but a
    // book Wolnelektury attribute differently (an anthology, a translator credited first) must be found.
    const title = `title=${encodeURIComponent(book.title)}`
    const author = (book.authors || [])[0]
    if (author) {
      const found = bookRows(await feed([title, `author=${encodeURIComponent(author.split(/\s+/).pop())}`]), book.title)
      if (found.length) return found
    }
    return bookRows(await feed([title]), book.title)
  },

  async resolve({ id }, ctx) {
    const match = String(id || "").toLowerCase().match(/^([a-z0-9-]+)(?:\.(audio))?$/)
    if (!match) throw new Error("Not a Wolnelektury book id")
    const [, slug, audio] = match
    const answer = await detail(slug)

    // An audiobook: the work's own recording, then its parts' (a long work is recorded part by part),
    // each part's mp3s in reading order, numbered across the whole work.
    if (audio) {
      const recordings = [{ title: answer.title, media: answer.media || [] }]
      const parts = (answer.children || []).filter((child) => child.has_audio && child.slug)
      const partDetails = await mapLimited(parts.sort((a, b) => partOrder(a) - partOrder(b)), 5, (part) => detail(part.slug))
      partDetails.forEach((part, index) => {
        if (part) recordings.push({ title: parts[index].title, media: part.media || [] })
      })

      const files = []
      for (const recording of recordings) {
        for (const item of recording.media) {
          if (item.type === "mp3" && item.url) {
            files.push({ url: item.url, fileName: fileName(`${String(files.length + 1).padStart(2, "0")} - ${recording.title}`, "mp3") })
          }
        }
      }
      if (!files.length) throw new Error("Wolnelektury has no audiobook for this work")
      return files
    }

    // A book: formats the API lists, in Apple Books order.
    const url = answer.epub || answer.pdf || answer.mobi || answer.fb2 || answer.txt
    if (!url) throw new Error("Wolnelektury gave no download link for this book")
    const format = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/) || [])[1]
    const author = ((answer.authors || [])[0] || {}).name
    return { url, fileName: fileName([answer.title, author].filter(Boolean).join(" - "), format) }
  },
}

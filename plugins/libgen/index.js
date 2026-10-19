// Library Genesis (libgen.li and its mirrors): search in the app and download, no account. Search is the site's
// own results page (index.php, parsed); a file's download key comes from its ads.php page (get.php?md5=&key=,
// which redirects to the file on Libgen's CDN). The mirrors answer requests without a browser User-Agent with an
// empty nginx page, so every call sends one.
import { load } from "cheerio/slim"
import { browserHeaders, score } from "../_shared/text.js"

/** "libgen.li", from whatever the user typed ("https://libgen.li/"). */
function mirror(ctx) {
  return (
    String(ctx.settings.mirror || "libgen.li")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "") || "libgen.li"
  )
}

/** "665 kB", "1.2 MB" → bytes. */
function bytes(text) {
  const match = String(text || "").match(/([\d.,]+)\s*([kmgt]?)b/i)
  if (!match) return undefined
  const power = { "": 0, k: 1, m: 2, g: 3, t: 4 }[match[2].toLowerCase()]
  return Math.round(parseFloat(match[1].replace(",", ".")) * Math.pow(1024, power))
}

/** Formats Dove can use first, in Apple Books / Kindle order. */
const formatRank = { epub: 0, pdf: 1, azw3: 2, mobi: 3, fb2: 4, djvu: 5 }

/** Libgen's language names for the device language; English comes next, the rest after. */
const languageNames = {
  pl: "polish", en: "english", de: "german", fr: "french", es: "spanish", it: "italian", pt: "portuguese",
  ru: "russian", uk: "ukrainian", cs: "czech", nl: "dutch", sv: "swedish", ja: "japanese", zh: "chinese",
}

function languageRank(language, ctx) {
  const own = languageNames[String(ctx.locale || "").slice(0, 2).toLowerCase()]
  const name = String(language || "").toLowerCase()
  if (own && name.includes(own)) return 0
  if (name.includes("english")) return 1
  return 2
}

/** Search words: a picked book's title and first author, else what the user typed. */
function words(query, book) {
  if (!book || !book.title) return query
  const author = (book.authors || [])[0]
  return author ? `${book.title} ${author.split(/\s+/).pop()}` : book.title
}

/** "Lem, Stanislaw" / "Stanislaw Lem; Someone" → first author, shortened. */
function firstAuthor(text) {
  const first = String(text || "")
    .split(/[;|]/)[0]
    .replace(/\((?:author|editor|translator|auth\.?|ed\.?)\)/gi, "")
    .replace(/[\s,]+$/, "")
    .trim()
  return first.length > 80 ? `${first.slice(0, 77)}…` : first || undefined
}

function fileName(title, author, format) {
  const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
  const base = [clean(title), clean(author)].filter(Boolean).join(" - ").slice(0, 150) || "book"
  return format ? `${base}.${format}` : base
}

globalThis.plugin = {
  manifest: {
    id: "libgen.books",
    name: "Libgen",
    version: "1.0.0",
    api: 1,
    summary: "Books from Library Genesis: search and download in the app, no account",
    capabilities: ["search", "resolve"],
    categories: ["books"],
    hosts: ["{mirror}"],
    settings: [
      {
        key: "mirror",
        title: "Mirror",
        type: "text",
        default: "libgen.li",
        help: "libgen.li, libgen.la, libgen.bz or libgen.gl. Change it when one stops answering.",
      },
    ],
    links: [
      "^https?://{mirror}/(?:ads|file|get)\\.php\\?md5=(?<id>[0-9a-fA-F]{32})",
    ],
  },

  async search({ query, book }, ctx) {
    const host = mirror(ctx)
    const q = words(query, book)
    const params = [
      `req=${encodeURIComponent(q)}`,
      ...["t", "a", "s", "y", "p", "i"].map((c) => `columns[]=${c}`),
      ...["f", "e", "s", "a", "p", "w"].map((o) => `objects[]=${o}`),
      "topics[]=l",
      "topics[]=f",
      "res=50",
      "filesuns=all",
    ]
    const response = await dove.fetch(`https://${host}/index.php?${params.join("&")}`, {
      headers: { ...browserHeaders, Cookie: "covers=on" },
    })
    if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
    const $ = load(response.body)
    const table = $("#tablelibgen")
    if (!table.length) {
      if (/nginx/i.test(response.body.slice(0, 500))) throw new Error(`${host} gave an empty page; try another mirror`)
      return []
    }

    const rows = []
    table.find("tbody tr").each((_, element) => {
      const cells = $(element).children("td")
      // With covers on, the first cell is the cover.
      const hasCover = cells.first().find("img").length > 0 && cells.length >= 10
      const at = (index) => cells.eq(index + (hasCover ? 1 : 0))
      const md5 = (at(8).find('a[href*="md5="]').first().attr("href") || "").match(/md5=([0-9a-fA-F]{32})/)
      if (!md5) return

      const $link = at(0).find('a[href^="edition.php"], a[href*="edition.php"]').first()
      $link.find("i").remove()
      const title = ($link.text() || at(0).find("b").first().text()).replace(/\s+/g, " ").trim()
      if (!title) return
      const author = firstAuthor(at(1).text())
      const format = at(7).text().trim().toLowerCase() || undefined
      const yearMatch = at(3).text().match(/\b(1[5-9]\d{2}|20\d{2})\b/)
      const language = at(4).text().trim() || undefined
      const src = hasCover ? cells.first().find("img").attr("src") : undefined
      const cover = src && !/blank|nocover/i.test(src) ? `https://${host}${src.startsWith("/") ? "" : "/"}${src}` : undefined

      rows.push({
        id: format ? `${md5[1].toLowerCase()}.${format}` : md5[1].toLowerCase(),
        title,
        author,
        kind: "books",
        format,
        size: bytes(at(6).text()),
        language,
        year: yearMatch ? Number(yearMatch[1]) : undefined,
        cover,
        link: `https://${host}/ads.php?md5=${md5[1].toLowerCase()}`,
        match: score(q, title, author ? [author] : []),
      })
    })

    // The same file can be listed under several editions.
    const seen = new Set()
    return rows
      .filter((row) => (seen.has(row.id) ? false : seen.add(row.id)))
      .sort((a, b) => {
        const close = Math.round((b.match - a.match) * 5) // coarse: similar titles keep the format order
        if (close) return close
        const language = languageRank(a.language, ctx) - languageRank(b.language, ctx)
        if (language) return language
        return (formatRank[a.format] ?? 9) - (formatRank[b.format] ?? 9)
      })
      .map(({ match, ...row }) => row)
  },

  async resolve({ id }, ctx) {
    const host = mirror(ctx)
    const [md5, format] = String(id).toLowerCase().split(".")
    if (!/^[0-9a-f]{32}$/.test(md5)) throw new Error("Not a Libgen file id")
    const response = await dove.fetch(`https://${host}/ads.php?md5=${md5}`, { headers: browserHeaders })
    if (response.status !== 200) throw new Error(`${host} answered ${response.status}`)
    const key = response.body.match(/get\.php\?md5=[0-9a-fA-F]{32}&(?:amp;)?key=([A-Za-z0-9]+)/)
    if (!key) throw new Error("Libgen gave no download link for this file")

    const $ = load(response.body)
    const text = $("body").text().replace(/\s+/g, " ")
    const title = (text.match(/Title:\s*(.*?)\s*(?:Series:|Author\(s\):)/) || [])[1]
    const author = firstAuthor((text.match(/Author\(s\):\s*(.*?)\s*(?:Publisher:|Year:|ISBN:)/) || [])[1])
    return {
      url: `https://${host}/get.php?md5=${md5}&key=${key[1]}`,
      fileName: fileName(title, author, format),
    }
  },
}

// storytel.com: books and audiobooks in its markets (search answers everything; no detail pages).
import { browserHeaders } from "../_shared/text.js"

/** One row per edition the asked format has. `locale`: Storytel market (`pl`). */
export async function search(query, format, locale) {
  const url = `https://www.storytel.com/api/search.action?q=${encodeURIComponent(query)}&request_locale=${encodeURIComponent(locale)}`
  const response = await dove.fetch(url, { headers: { ...browserHeaders, Accept: "application/json" } })
  if (response.status !== 200) throw new Error(`Storytel answered ${response.status}`)
  const books = response.json().books || []
  const rows = []
  for (const item of books) {
    const book = item.book
    const edition = format === "audiobook" ? item.abook : item.ebook
    if (!book || !edition) continue
    // This plugin is for the market's own editions: other languages are mostly podcast episodes about a book.
    const language = book.language && book.language.isoValue
    if (language && language !== locale) continue
    const covers = format === "audiobook" ? [book.largeCover, book.largeCoverE] : [book.largeCoverE, book.largeCover]
    const cover = covers.find((path) => path && !path.includes("nocover"))
    const series = book.series && book.series[0] && book.series[0].name
    rows.push({
      id: `${book.id}-${format}`,
      title: book.name,
      authors: (book.authors || []).map((author) => author.name).filter(Boolean),
      cover: cover ? `https://www.storytel.com${cover.replace("320x320", "640x640")}` : undefined,
      description: edition.description || undefined,
      // "20170715"
      year: Number(String(book.latestReleaseDate || "").slice(0, 4)) || undefined,
      narrators: edition.narratorAsString ? edition.narratorAsString.split(/,\s*/) : undefined,
      series: series || undefined,
      isbn: edition.isbn || undefined,
      link: item.shareUrl || undefined,
      language: book.language && book.language.isoValue,
    })
  }
  return rows
}

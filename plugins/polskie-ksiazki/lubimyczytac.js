// lubimyczytac.pl: Polish books and audiobooks (search page + detail page for the best matches).
import { load } from "cheerio/slim"
import { browserHeaders, plainText, year } from "../_shared/text.js"

const base = "https://lubimyczytac.pl"

/** Search rows: id, title, authors, cover, page. `format`: "ebook" or "audiobook". */
export async function search(query, format) {
  const path = format === "audiobook" ? "audiobooki" : "ksiazki"
  const response = await dove.fetch(`${base}/szukaj/${path}?phrase=${encodeURIComponent(query)}`, { headers: browserHeaders })
  if (response.status !== 200) throw new Error(`lubimyczytac answered ${response.status}`)
  const $ = load(response.body)
  const rows = []
  $(".book-card--l").each((_, element) => {
    const $card = $(element)
    // Promoted offers are ads, not results.
    if ($card.closest(".promoted-offers__list, .promoted-offers").length) return
    const $title = $card.find(".book-card__title").first()
    const href = $title.attr("href")
    const title = $title.text().trim()
    if (!href || !title) return
    const id = $card.attr("data-book-id") || href.split("/").filter(Boolean)[1]
    const $image = $card.find("img").first()
    rows.push({
      id,
      title,
      authors: $card.find(".book-card__author a").map((_, a) => $(a).text().trim()).get(),
      cover: $image.attr("data-src") || $image.attr("src"),
      link: href.startsWith("http") ? href : base + href,
    })
  })
  return rows
}

/** Adds description, year, ISBN, series and a bigger cover from the book's page. */
export async function details(row) {
  const response = await dove.fetch(row.link, { headers: browserHeaders })
  if (response.status !== 200) return row
  const $ = load(response.body)
  const cover = $('meta[property="og:image"]').attr("content") || $("a#js-lightboxCover").attr("href") || row.cover
  const description = plainText($("#book-description").html() || $('meta[property="og:description"]').attr("content"))
  const published =
    $('dt[title*="Data pierwszego wydania"]').next("dd").text().trim() || $('dt:contains("Data wydania")').next("dd").text().trim()
  const isbn = $('meta[property="books:isbn"]').attr("content") || undefined
  const seriesText = $('span.d-none.d-sm-block.mt-1:contains("Cykl:")').find("a").text().trim()
  const narrator = $('dt:contains("Czyta")').next("dd").text().trim() || undefined
  return {
    ...row,
    cover,
    description: description && description !== "Ta książka nie posiada jeszcze opisu." ? description : undefined,
    year: year(published),
    isbn,
    series: seriesText ? seriesText.replace(/\s*\(tom \d+.*?\)\s*$/, "").trim() : undefined,
    narrators: narrator ? narrator.split(/,\s*/) : undefined,
  }
}

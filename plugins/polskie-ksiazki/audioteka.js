// audioteka.com: Polish audiobooks (search page; detail page for the best matches).
import { load } from "cheerio/slim"
import { browserHeaders, plainText, year } from "../_shared/text.js"

const base = "https://audioteka.com"

/** Removes CDN resize parameters: the plain URL is the large cover. */
function cleanCover(url) {
  return url ? url.split("?")[0] : undefined
}

export async function search(query) {
  const response = await dove.fetch(`${base}/pl/szukaj?phrase=${encodeURIComponent(query)}`, { headers: browserHeaders })
  if (response.status !== 200) throw new Error(`Audioteka answered ${response.status}`)
  const $ = load(response.body)
  const rows = []
  // CSS-module class names carry a build hash (teaser_title__hDeCG): match their stable prefix.
  $('[class*="teaser_teaser__"]').each((_, element) => {
    const $item = $(element)
    const title = $item.find('[class*="teaser_title__"]').first().text().trim()
    const href = $item.find('[class*="teaser_link__"]').first().attr("href")
    if (!title || !href) return
    const $image = $item.find('[class*="teaser_coverImage__"], img').first()
    let cover = $image.attr("src") || $image.attr("data-src") || $image.attr("srcset")
    if (cover && cover.includes(",")) cover = cover.split(",")[0].trim().split(" ")[0]
    const author = $item.find('[class*="teaser_author__"]').first().text().trim()
    rows.push({
      id: href.split("/").filter(Boolean).pop(),
      title,
      authors: author ? author.split(/,\s*/) : [],
      cover: cleanCover(cover),
      link: href.startsWith("http") ? href : base + href,
    })
  })
  return rows
}

export async function details(row) {
  const response = await dove.fetch(row.link, { headers: browserHeaders })
  if (response.status !== 200) return row
  const $ = load(response.body)
  const valueFor = (label) => {
    const fromList = $("dt").filter((_, e) => $(e).text().trim() === label).next("dd")
    const fromTable = $(`.product-table tr:contains("${label}") td:last-child`)
    const $value = fromList.length ? fromList : fromTable
    const links = $value.find("a").map((_, a) => $(a).text().trim()).get().filter(Boolean)
    return links.length ? links.join(", ") : $value.text().trim()
  }
  // The page's own description block; JSON-LD's first node is Audioteka itself (an Organization), so only a
  // Product/Audiobook node counts.
  let description = $('[class*="description_description__"]').first().html()
  if (!description) {
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const data = JSON.parse($(script).text())
        for (const node of Array.isArray(data) ? data : [data]) {
          const type = [].concat(node["@type"] || [])
          if (!description && node.description && (type.includes("Audiobook") || type.includes("Product"))) description = node.description
        }
      } catch {}
    })
  }
  description = plainText(description || $('meta[property="og:description"]').attr("content"))
  const narrators = valueFor("Głosy") || valueFor("Lektor")
  return {
    ...row,
    cover: cleanCover($('meta[property="og:image"]').attr("content")) || row.cover,
    description: description || undefined,
    narrators: narrators ? narrators.split(/,\s*/) : undefined,
    year: year(valueFor("Data premiery") || valueFor("Data wydania")),
  }
}

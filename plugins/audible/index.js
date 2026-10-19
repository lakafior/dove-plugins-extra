// Audible: audiobook covers, titles, narrators and series from Audible's public catalog API (the one
// Audiobookshelf's built-in Audible provider uses; no key). Ported from aio-abs-providers.
import { plainText, score } from "../_shared/text.js"

// Audible store → API domain.
const stores = {
  us: "com",
  uk: "co.uk",
  de: "de",
  fr: "fr",
  it: "it",
  es: "es",
  ca: "ca",
  au: "com.au",
  in: "in",
  jp: "co.jp",
}

function storeDomain(ctx) {
  const store = String(ctx.settings.store || "us").trim().toLowerCase()
  return stores[store] || "com"
}

function book(product, domain) {
  if (!product || !product.title) return null
  // Translators are listed as authors ("Name - translator", "- traducteur", "- Übersetzer"…).
  const translator = /\s-\s(translator|traducteur|traductrice|übersetzer|übersetzerin|traduttore|traduttrice|traductor|traductora|翻訳)$/i
  const authors = (product.authors || []).map((a) => a && a.name).filter((name) => name && !translator.test(name))
  const images = product.product_images || {}
  const coverSize = Object.keys(images).sort((a, b) => Number(b) - Number(a))[0]
  const series = (product.series || []).find((s) => s && s.title)
  return {
    id: product.asin,
    title: product.title.replace(/\s*\((Un)?abridged\)\s*$/i, ""),
    authors,
    year: product.release_date ? Number(product.release_date.slice(0, 4)) : undefined,
    cover: coverSize ? images[coverSize] : undefined,
    description: plainText(product.merchandising_summary || product.publisher_summary) || undefined,
    link: `https://www.audible.${domain}/pd/${product.asin}`,
    narrators: (product.narrators || []).map((n) => n && n.name).filter(Boolean),
    series: series ? series.title : undefined,
    asin: product.asin,
    language: product.language,
  }
}

globalThis.plugin = {
  manifest: {
    id: "audible.metadata",
    name: "Audible",
    version: "1.0.0",
    api: 1,
    summary: "Audiobook covers, narrators and series from Audible's catalog",
    capabilities: ["metadata"],
    categories: ["audiobooks"],
    hosts: Object.values(stores).map((domain) => `api.audible.${domain}`),
    settings: [
      { key: "store", title: "Audible store", type: "text", default: "us", help: "us, uk, de, fr, it, es, ca, au, in, jp" },
    ],
  },

  async metadata({ query, format }, ctx) {
    if (format !== "audiobook") return []
    const domain = storeDomain(ctx)
    const params = [
      ["keywords", query],
      ["num_results", "15"],
      ["products_sort_by", "Relevance"],
      ["response_groups", "contributors,media,product_desc,product_attrs,series"],
    ]
    const search = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")
    const response = await dove.fetch(`https://api.audible.${domain}/1.0/catalog/products?${search}`, {
      headers: { Accept: "application/json" },
    })
    if (response.status !== 200) throw new Error(`Audible answered ${response.status}`)
    return (response.json().products || [])
      .map((product) => book(product, domain))
      .filter(Boolean)
      .map((item) => ({ item, fit: score(query, item.title, item.authors) }))
      .filter(({ fit }) => fit >= 0.3)
      .sort((a, b) => b.fit - a.fit)
      .map(({ item }) => item)
  },
}

// Polskie książki: covers, titles and descriptions for Polish books and audiobooks from lubimyczytac.pl,
// Audioteka and Storytel. Ported from aio-abs-providers (Audiobookshelf) to a Dove plugin.
import { mapLimited, score } from "../_shared/text.js"
import * as lubimyczytac from "./lubimyczytac.js"
import * as audioteka from "./audioteka.js"
import * as storytel from "./storytel.js"

/** Results below this fit (0…1) to the words are dropped. */
const threshold = 0.4
/** Detail pages fetched per source for the best matches (each is one request). */
const detailPages = 3

function enabled(ctx, key) {
  return ctx.settings[key] !== false
}

globalThis.plugin = {
  manifest: {
    id: "pl.polskie-ksiazki",
    name: "Polskie książki",
    version: "1.0.0",
    api: 1,
    summary: "lubimyczytac.pl, Audioteka, Storytel",
    capabilities: ["metadata"],
    categories: ["books", "audiobooks"],
    hosts: ["lubimyczytac.pl", "audioteka.com", "www.storytel.com"],
    settings: [
      { key: "lubimyczytac", title: "lubimyczytac.pl", type: "toggle", default: true },
      { key: "audioteka", title: "Audioteka (audiobooks)", type: "toggle", default: true },
      { key: "storytel", title: "Storytel", type: "toggle", default: true },
      { key: "storytelMarket", title: "Storytel market", type: "text", default: "pl", help: "pl, sv, no, da, fi, nl, es, tr, bg…" },
    ],
  },

  async metadata({ query, format }, ctx) {
    const sources = []
    if (enabled(ctx, "lubimyczytac")) {
      sources.push({ name: "lc", search: () => lubimyczytac.search(query, format), details: lubimyczytac.details })
    }
    if (format === "audiobook" && enabled(ctx, "audioteka")) {
      sources.push({ name: "at", search: () => audioteka.search(query), details: audioteka.details })
    }
    if (enabled(ctx, "storytel")) {
      sources.push({ name: "st", search: () => storytel.search(query, format, ctx.settings.storytelMarket || "pl") })
    }

    const answers = await Promise.all(
      sources.map(async (source) => {
        let rows
        try {
          rows = await source.search()
        } catch (error) {
          dove.log(`${source.name}: ${error.message}`)
          return []
        }
        const scored = rows
          .map((row) => ({ ...row, fit: score(query, row.title, row.authors) }))
          .filter((row) => row.fit >= threshold)
          .sort((a, b) => b.fit - a.fit)
        if (!source.details) return scored.map((row) => ({ ...row, source: source.name }))
        // Detail pages only for the best few; the rest keep what the search page gave.
        const best = await mapLimited(scored.slice(0, detailPages), 2, (row) => source.details(row))
        return scored.map((row, index) => ({ ...(best[index] || row), fit: row.fit, source: source.name }))
      }),
    )

    return answers
      .flat()
      .sort((a, b) => b.fit - a.fit)
      .map((row) => ({
        id: `${row.source}:${row.id}`,
        title: row.title,
        authors: row.authors,
        year: row.year,
        cover: row.cover,
        description: row.description,
        link: row.link,
        narrators: row.narrators,
        series: row.series,
        isbn: row.isbn,
        language: row.language || "pl",
      }))
  },
}

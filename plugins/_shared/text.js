// Text helpers shared by the plugins (bundled into each; Dove's sandbox has no Node or browser APIs).
import { compareTwoStrings } from "string-similarity"

/** Lowercase, no diacritics or punctuation: phones type "wiedzmin" for "Wiedźmin.". */
export function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/**
 * How well a title and authors answer free-text words (0…1). Dove sends "author title" or just a title, so the
 * words are also compared with author + title, both ways round.
 */
export function score(query, title, authors = []) {
  const q = norm(query)
  const t = norm(title)
  const a = norm(authors.join(" "))
  if (!q || !t) return 0
  return Math.max(
    compareTwoStrings(t, q),
    a ? compareTwoStrings(`${a} ${t}`, q) : 0,
    a ? compareTwoStrings(`${t} ${a}`, q) : 0,
  )
}

/** Plain text from simple HTML (descriptions). */
export function plainText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** First four-digit year in a text. */
export function year(text) {
  const match = String(text || "").match(/\b(1[5-9]\d{2}|20\d{2})\b/)
  return match ? Number(match[1]) : undefined
}

/** Runs `work` over items, at most `limit` at a time, keeping order; failures become null. */
export async function mapLimited(items, limit, work) {
  const results = new Array(items.length).fill(null)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      try {
        results[index] = await work(items[index], index)
      } catch (error) {
        dove.log(`skipped ${index}: ${error && error.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** A browser-like User-Agent: some sites answer bots differently. */
export const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.5",
}

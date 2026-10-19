// Docer (docer.pl): user-uploaded documents, no account. Search stays on the site's own pages (Dove's
// browser opens them: Docer's anti-bot limits plain scripted requests, a browsing user does not trip it);
// Dove recognises a document's page and asks this plugin for the file. The download does not use the
// download button's endpoint — /start/download wants an account or payment for popular files — but the
// file viewer's /start/show, which the page posts to with the file's id, extension and size (plus a
// random number as its captcha answer when none was asked) and which answers with a direct file URL on
// stream.docer.pl (a Google Docs viewer URL, the file itself in its `url=`, for the formats Docer shows
// there). Everything the POST needs is on the document's page: #iframe2's data attributes for the id,
// extension and exact size, and schema.org's Book for the file's own name.
import { load } from "cheerio/slim"
import { browserHeaders } from "../_shared/text.js"

const host = "docer.pl"

/** POST to the viewer's endpoint, with the headers the site's own page sends. */
async function show(body, referer) {
  const response = await dove.fetch(`https://${host}/start/show`, {
    method: "POST",
    headers: {
      ...browserHeaders,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
    },
    body,
  })
  // The anti-bot answers with a captcha page instead of JSON; so does anything unusual.
  if (response.status !== 200) throw new Error(`docer.pl answered ${response.status}`)
  let answer
  try {
    answer = response.json()
  } catch {
    throw new Error("Docer is asking for a captcha; wait a while and try again")
  }
  if (!answer || answer.success !== true || !answer.response) {
    throw new Error("Docer gave no file link; wait a while and try again")
  }
  return answer.response
}

/** A document's page: the file's id, extension, exact size (in #iframe2's data) and its own name. */
async function docPage(slug) {
  const response = await dove.fetch(`https://${host}/doc/${slug}`, { headers: browserHeaders })
  if (response.status === 410) throw new Error("Docer is limiting requests from this network; wait a while and try again")
  if (response.status !== 200) throw new Error(`docer.pl answered ${response.status}`)
  const $ = load(response.body)
  const iframe = $("#iframe2")
  if (!iframe.length || !iframe.attr("data-id")) throw new Error("Docer gave no file data for this document")

  // schema.org's Book names the file itself, clean of the page's " - Category (PDF) do pobrania" tail.
  const book = $('script[type="application/ld+json"]')
    .map((_, element) => {
      try {
        return JSON.parse($(element).contents().text())
      } catch {
        return null
      }
    })
    .get()
    .find((data) => data && data["@type"] === "Book" && data.name)

  return {
    id: iframe.attr("data-id"),
    ext: String(iframe.attr("data-ext") || "").toLowerCase() || undefined,
    size: Number(iframe.attr("data-size")) || undefined,
    title: book
      ? String(book.name).replace(/\s+/g, " ").trim()
      : $("title").text().replace(/\s*\|\s*Docer\.pl.*$/i, "").replace(/\s+/g, " ").trim(),
  }
}

function fileName(title, format) {
  const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
  const base = clean(title).slice(0, 150) || "document"
  return format ? `${base}.${format}` : base
}

globalThis.plugin = {
  manifest: {
    id: "docer.books",
    name: "Docer",
    version: "1.0.0",
    api: 1,
    summary: "Documents from docer.pl: search on the site in Dove's browser, download in the app, no account",
    capabilities: ["resolve"],
    categories: ["books"],
    hosts: [host, `*.${host}`],
    browse: `https://${host}/show/?q={query}`,
    links: [`^https?://${host.replace(/\./g, "\\.")}/doc/(?<id>[a-z0-9]+)/?`],
  },

  async resolve({ id }, ctx) {
    const slug = String(id || "").trim()
    if (!/^[a-z0-9]+$/i.test(slug)) throw new Error("Not a Docer document id")

    const page = await docPage(slug)
    const ext = page.ext || "pdf"
    // The viewer's endpoint answers with a direct file URL, or a Google Docs viewer URL.
    const rc = Math.floor(Math.random() * 9) + 1
    const answer = await show(
      `item_id=${encodeURIComponent(page.id)}&rc=${rc}&ext=${encodeURIComponent(ext)}&size=${page.size || 0}`,
      `https://${host}/doc/${slug}`,
    )
    let url = answer.url
    if (!url) throw new Error("Docer gave no download link for this document")
    if (answer.google_viewer) {
      const shown = url.match(/[?&]url=([^&]+)/)
      if (!shown) throw new Error("Docer gave no download link for this document")
      url = decodeURIComponent(shown[1])
    }

    return {
      url,
      fileName: fileName(page.title, ext),
      headers: browserHeaders,
    }
  },
}

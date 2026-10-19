// Docer (docer.pl): user-uploaded documents, no account. Search stays on the site's own pages (Dove's
// browser opens them: Docer's anti-bot turns away scripted requests that do not look like the site's own
// page talking to it, a browsing user does not trip it); Dove recognises a document's page and asks this
// plugin for the file. The file address the page's own viewer fetched is read out of the page (`harvest`:
// `data-pdf-url` once the viewer has it) — the page's requests passed Docer's checks, captchas included —
// and this plugin hands it back for downloading. Without it, the download tries the file viewer's
// /start/show itself: the page posts to it with the file's id, extension and size (plus a random number as
// its captcha answer when none was asked) and it answers with a direct file URL on stream.docer.pl (a
// Google Docs viewer URL, the file itself in its `url=`, for the formats Docer shows there). Everything
// the POST needs is on the document's page: #iframe2's data attributes for the id, extension and exact
// size, and schema.org's Book for the file's own name. The POST must look like the viewer's own request —
// headers and all — because the anti-bot returns its captcha page to anything it can tell apart from the
// page's XHR.
import { load } from "cheerio/slim"
import { browserHeaders } from "../_shared/text.js"

const host = "docer.pl"

/** What the site's own viewer sends when it posts: a WebKit XHR to the page's own endpoints. */
const xhrHeaders = {
  ...browserHeaders,
  Accept: "*/*",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: `https://${host}`,
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
}

/** POST to the viewer's endpoint, with the headers the site's own page sends. */
async function show(body, referer) {
  const response = await dove.fetch(`https://${host}/start/show`, {
    method: "POST",
    headers: { ...xhrHeaders, Referer: referer },
    body,
  })
  // The anti-bot answers with its captcha page instead of JSON; so does anything unusual.
  if (response.status !== 200) throw new Error(`docer.pl answered ${response.status}`)
  let answer
  try {
    answer = response.json()
  } catch {
    throw new Error(
      "Docer is asking for a captcha. Open the document in the browser, let its viewer load (solve the captcha if it shows one) and try again",
    )
  }
  if (!answer || answer.success !== true || !answer.response) {
    throw new Error(
      "Docer wants a captcha for this file. Open the document in the browser, let its viewer load (solve the captcha if it shows one) and try again",
    )
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

/** A /start/show answer's file URL, or the file inside its Google Docs viewer URL. */
function fileUrl(answer) {
  let url = answer.url
  if (!url) return undefined
  if (answer.google_viewer) {
    const shown = String(url).match(/[?&]url=([^&]+)/)
    if (!shown) return undefined
    url = decodeURIComponent(shown[1])
  }
  return url
}

globalThis.plugin = {
  manifest: {
    id: "docer.books",
    name: "Docer",
    version: "1.0.1",
    api: 1,
    summary: "Documents from docer.pl: search on the site in Dove's browser, download in the app, no account",
    capabilities: ["resolve"],
    categories: ["books"],
    hosts: [host, `*.${host}`],
    browse: `https://${host}/show/?q={query}`,
    // The viewer's own file address, read out of the page once its viewer has fetched it: Docer's checks
    // (captchas included) are passed by the page, not by a scripted request.
    harvest:
      "(function(){var e=document.getElementById('iframe2');var u=e&&e.getAttribute('data-pdf-url')||'';if(!u){var g=document.querySelector('iframe.google-doc');u=g&&g.src||''}var m=u.match(/[?&]url=([^&]+)/);return m?decodeURIComponent(m[1]):u})()",
    links: [
      `^https?://${host.replace(/\./g, "\\.")}/doc/(?<id>[a-z0-9]+)/?`,
      // A file URL itself (from the viewer, pasted, shared): already the direct link, handed back.
      `^https?://stream\\.${host.replace(/\./g, "\\.")}/getpdf/(?<id>[^/?#]+/[^/?#]+/[^/?#]+/?)`,
      `^https?://stream2\\.${host.replace(/\./g, "\\.")}/pdf_dummy/(?<id>[A-Za-z0-9_=,+-]+)`,
    ],
  },

  async resolve({ id }, ctx) {
    const raw = String(id || "").trim()

    // A stream URL: already the direct link, only the download needs it back.
    if (raw.includes("/")) {
      let name
      const slug = raw.split("/")[1]
      if (slug) {
        try {
          const page = await docPage(slug)
          name = fileName(page.title, page.ext)
        } catch {
          // without the name, Dove uses the address's last part
        }
      }
      return { url: `https://stream.${host}/getpdf/${raw}`, ...(name ? { fileName: name } : {}), headers: browserHeaders }
    }
    if (/^[A-Za-z0-9_=,+-]{20,}$/.test(raw)) {
      // pdf_dummy's token names the file inside (base64, padding as commas): "Frank Herbert - …".
      let name
      try {
        const info = JSON.parse(atob(raw.replace(/,/g, "=")))
        if (info && info.name) name = fileName(info.name, info.extension)
      } catch {
        // without the name the URL is handed back as it is
      }
      return { url: `https://stream2.${host}/pdf_dummy/${raw}`, ...(name ? { fileName: name } : {}), headers: browserHeaders }
    }

    const slug = raw
    if (!/^[a-z0-9]+$/i.test(slug)) throw new Error("Not a Docer document id")

    const page = await docPage(slug)
    const ext = page.ext || "pdf"
    // The viewer's endpoint answers with a direct file URL, or a Google Docs viewer URL.
    const rc = Math.floor(Math.random() * 9) + 1
    const answer = await show(
      `item_id=${encodeURIComponent(page.id)}&rc=${rc}&ext=${encodeURIComponent(ext)}&size=${page.size || 0}`,
      `https://${host}/doc/${slug}`,
    )
    const url = fileUrl(answer)
    if (!url) throw new Error("Docer gave no download link for this document")

    return {
      url,
      fileName: fileName(page.title, ext),
      headers: browserHeaders,
    }
  },
}

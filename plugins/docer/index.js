// Docer (docer.pl): user-uploaded documents, no account. Files up to 1 MB are free: /start/download (the
// page's download button) answers a script with the file's address, no captcha. Larger ones go the way below.
// Search stays on the site's own pages (Dove's
// browser opens them: Docer's anti-bot turns away scripted requests that do not look like the site's own
// page talking to it, a browsing user does not trip it); Dove recognises a document's page and asks this
// plugin for the file. The file address the page's own viewer fetched is read out of the page (`harvest`):
// a PDF shows it in data-pdf-url, an EPUB's download shows among the page's requests (ePub.js keeps the
// address only in JavaScript) — the page's requests passed Docer's checks, captchas included — and this
// plugin hands that address back for downloading, as it is. The address carries Docer's short-lived
// token, so the download has to start while the page is open and fresh; without a harvested address, the
// plugin tries the file viewer's /start/show itself, which asks a reCAPTCHA of anything but the page.
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

/**
 * The download button's own call: the file's address for a free file (up to 1 MB), nothing when Docer wants
 * payment (payment_info: 1) or a captcha (success: false), or when it answers anything unusual.
 */
async function startDownload(slug) {
  const rc = Math.floor(Math.random() * 9) + 1
  const response = await dove.fetch(`https://${host}/start/download`, {
    method: "POST",
    headers: { ...xhrHeaders, Referer: `https://${host}/doc/${slug}` },
    body: `item_id=${encodeURIComponent(slug)}&rc=${rc}`,
  })
  if (response.status !== 200) return undefined
  let answer
  try {
    answer = response.json()
  } catch {
    return undefined
  }
  const data = answer && answer.success === true && answer.response
  if (!data || Number(data.payment_info) === 1 || !data.url) return undefined
  return String(data.url)
}

/**
 * The file's name from a "*_dummy/<token>" address: the token is base64 JSON ("," for "=") with `name` and
 * `extension`, the name in UTF-8 ("Wiersze - Kazimiera Iłłakowiczówna").
 */
function dummyName(address) {
  const token = String(address || "").match(/_dummy\/([A-Za-z0-9_=,+\/-]{16,})/)
  if (!token) return undefined
  try {
    const binary = atob(token[1].replace(/,/g, "=").replace(/-/g, "+").replace(/_/g, "/"))
    const text = decodeURIComponent(
      Array.from(binary, (char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    )
    const info = JSON.parse(text)
    return info && info.name ? fileName(info.name, info.extension) : undefined
  } catch {
    return undefined
  }
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
    version: "1.1.0",
    api: 1,
    summary: "Documents from docer.pl: search on the site in Dove's browser, download in the app, no account (files over 1 MB through the page's viewer)",
    capabilities: ["resolve"],
    categories: ["books"],
    hosts: [host, `*.${host}`],
    browse: `https://${host}/show/?q={query}`,
    // The viewer's own file address, read out of the page once its viewer has fetched it: a PDF shows it
    // in data-pdf-url, an EPUB's download shows among the page's requests (a Google Docs viewer keeps the
    // file inside its url=). A file fetch it is — the guard needs the two path parts a file address has,
    // so the address an expired token redirects to (the document's page) never passes for a file.
    harvest:
      "(function(){var e=document.getElementById('iframe2');var u=(e&&e.getAttribute('data-pdf-url'))||'';if(!u){var g=document.querySelector('iframe.google-doc');u=g&&g.src||''}if(!u){var r=window.performance&&performance.getEntriesByType?performance.getEntriesByType('resource'):[];for(var i=r.length-1;i>=0;i--){if(/https?:\\/\\/stream2?\\.docer\\.pl\\/[^\\/]+\\/[^\\/]+\\//.test(r[i].name)&&!/\\.(jpe?g|png|gif|webp|svg)(\\?|$)/i.test(r[i].name)){u=r[i].name;break}}}var m=u.match(/[?&]url=([^&]+)/);return m?decodeURIComponent(m[1]):u||''})()",
    links: [
      `^https?://${host.replace(/\./g, "\\.")}/doc/(?<id>[a-z0-9]+)/?`,
      // A file address itself (the viewer's own, from the page, pasted, shared): handed back as it is.
      `^https?://stream\\.${host.replace(/\./g, "\\.")}/(?!doc/)(?<id>[^?#]+)`,
      `^https?://stream2\\.${host.replace(/\./g, "\\.")}/(?!doc/)(?<id>[^?#]+)`,
    ],
  },

  async resolve({ id }, ctx) {
    const raw = String(id || "").trim()

    // A file address Docer already shows: handed back for downloading as it is. The lasting kind a
    // redirect lands on ("*_dummy/<token>") carries the file's name inside; the viewer's own
    // ("getpdf/<n>/<slug>/<token>") has the document's slug in it, for the name from its page.
    if (raw.includes("/")) {
      const parts = raw.split("/")
      if (parts.length === 2 && /^[A-Za-z0-9_=,+-]{16,}$/.test(parts[1])) {
        const name = dummyName(raw)
        return { url: `https://stream2.${host}/${raw}`, ...(name ? { fileName: name } : {}), headers: browserHeaders }
      }
      let name
      const slug = parts.find(
        (part, index) => index > 0 && /^[a-z0-9]{3,9}$/i.test(part) && /[a-z]/i.test(part) && /\d/.test(part),
      )
      if (slug) {
        try {
          const page = await docPage(slug)
          name = fileName(page.title, page.ext)
        } catch {
          // without the name, Dove uses the address's last part
        }
      }
      return { url: `https://stream.${host}/${raw}`, ...(name ? { fileName: name } : {}), headers: browserHeaders }
    }
    if (/^[A-Za-z0-9_=,+-]{20,}$/.test(raw)) {
      // A redirect target's token alone (an older download's id): back to the address it came from.
      return { url: `https://stream2.${host}/pdf_dummy/${raw}`, headers: browserHeaders }
    }

    const slug = raw
    if (!/^[a-z0-9]+$/i.test(slug)) throw new Error("Not a Docer document id")

    // Files up to 1 MB are free: the page's download button posts the slug to /start/download, which
    // answers with the file's address (stream.docer.pl/getpdf/…, every format, redirecting to the file under
    // its own name), no captcha. Larger files answer payment_info: 1; then the viewer's path below.
    const free = await startDownload(slug)
    if (free) {
      // The name: one byte of the file is enough to see where the address redirects (its token carries the
      // name), and spares the document's page, which Docer soon answers with 410. The address stays usable.
      let name
      try {
        const probe = await dove.fetch(free, { headers: { ...browserHeaders, Range: "bytes=0-0" } })
        name = dummyName(probe.url)
      } catch {
        // without the name, Dove uses the address's last part
      }
      return { url: free, ...(name ? { fileName: name } : {}), headers: browserHeaders }
    }

    // A document's page: this is where a scripted request runs into Docer's captcha, so this path is the
    // one a harvested address spares the user from; it stays for a page that has not loaded its viewer.
    const page = await docPage(slug)
    const ext = page.ext || "pdf"
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

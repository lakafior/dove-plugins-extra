// Doci (doci.pl): user-uploaded documents, a Docer twin with its own file store. Search stays on the
// site's own pages (Dove's browser opens them: the checks — a reCAPTCHA before a file shows — are passed
// by a browsing user, not by a scripted request); Dove recognises a document's page and asks this plugin
// for the file. The file address the page's own viewer fetched is read out of the page (`harvest`: the
// viewer puts it in data-pdf-url, every format) and handed back for downloading as it is. Without one,
// the plugin asks the viewer's endpoints itself — the page posts the file's id, size and extension to
// file/file_data/cl, which answers whether a captcha is asked, and then to file/file_data/show, which
// answers with the file's address (a Google Docs viewer URL, the file inside its `url=`) — but without
// the captcha's answer the address the site hands out is a stub that answers 410, so a page whose viewer
// loaded is the only dependable way in.
import { load } from "cheerio/slim"
import { browserHeaders } from "../_shared/text.js"

const host = "doci.pl"

/** POST to the viewer's endpoints, the JSON the site's own Backbone models send. */
async function post(path, payload, referer) {
  const response = await dove.fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      ...browserHeaders,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Origin: `https://${host}`,
      Referer: referer,
    },
    body: JSON.stringify(payload),
  })
  if (response.status !== 200) throw new Error(`doci.pl answered ${response.status}`)
  let answer
  try {
    answer = response.json()
  } catch {
    throw new Error("Doci is asking for a captcha; wait a while and try again")
  }
  return answer
}

/** A document's page: the file's id, extension and size (in #iframe2's data) and its own name (the h1). */
async function itemPage(id) {
  const response = await dove.fetch(`https://${host}/${id}`, { headers: browserHeaders })
  if (response.status !== 200) throw new Error(`doci.pl answered ${response.status}`)
  const $ = load(response.body)
  const iframe = $("#iframe2")
  if (!iframe.length || !iframe.attr("data-id")) throw new Error("Doci gave no file data for this document")
  const title = $("h1")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
  return {
    id: iframe.attr("data-id"),
    ext: String(iframe.attr("data-ext") || "").toLowerCase() || undefined,
    size: Number(iframe.attr("data-size")) || undefined,
    title,
  }
}

function fileName(title, ext) {
  const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
  let base = clean(title).slice(0, 150) || "document"
  // The page's h1 names the file with its extension ("Diuna 01 - Diuna.mobi"); without one, Dove's own
  // name for the download comes from the address's last part.
  if (ext && !new RegExp(`\\.${ext}$`, "i").test(base)) base = `${base}.${ext}`
  return base
}

globalThis.plugin = {
  manifest: {
    id: "doci.books",
    name: "Doci",
    version: "1.0.0",
    api: 1,
    summary: "Documents from doci.pl: search on the site in Dove's browser, download in the app, no account",
    capabilities: ["resolve"],
    categories: ["books"],
    hosts: [host, `*.${host}`],
    browse: `https://${host}/search/all/{query}`,
    // The viewer's own file address, read out of the page once its viewer has fetched it: the viewer puts
    // it in data-pdf-url, every format (an EPUB's or MOBI's download would also show among the page's
    // requests, so Resource Timing is asked as a fallback; a Google Docs viewer keeps the file in its
    // url=). A file fetch it is — the guard needs the path parts a file address has.
    harvest:
      "(function(){var e=document.getElementById('iframe2');var u=(e&&e.getAttribute('data-pdf-url'))||'';if(!u){var g=document.querySelector('iframe.google-doc');u=g&&g.src||''}if(!u){var r=window.performance&&performance.getEntriesByType?performance.getEntriesByType('resource'):[];for(var i=r.length-1;i>=0;i--){if(/https?:\\/\\/stream2?\\.doci\\.pl\\/[^\\/]+\\/[^\\/]+\\//.test(r[i].name)){u=r[i].name;break}}}var m=u.match(/[?&]url=([^&]+)/);return m?decodeURIComponent(m[1]):u||''})()",
    links: [
      // A document's page: /<user>/<name>+f<id>; pasted, shared, opened in Dove's browser.
      `^https?://${host.replace(/\./g, "\\.")}/(?<id>[a-z0-9-]+/[a-z0-9-]+\\+[a-z0-9]+)/?`,
      // A file address itself (from the viewer, pasted, shared): already the direct link, handed back.
      `^https?://(?<id>stream2?\\.${host.replace(/\./g, "\\.")}/[^?#]+)`,
    ],
  },

  async resolve({ id }, ctx) {
    const raw = String(id || "").trim()
    if (!raw) throw new Error("Not a Doci document id")

    // A file address Doci already shows, handed back for downloading as it is.
    if (/^stream2?\.doci\.pl\//i.test(raw)) {
      return { url: `https://${raw}`, headers: browserHeaders }
    }

    // A document's page: this is where a scripted request runs into Doci's captcha, so this path is the
    // one a harvested address spares the user from; it stays for a page that has not loaded its viewer.
    const page = await itemPage(raw)
    const referer = `https://${host}/${raw}`
    const gate = await post(
      "/file/file_data/cl",
      { file_id: page.id, file_size: page.size, file_extension: page.ext },
      referer,
    )
    if (!gate || gate.success !== true || !gate.response || gate.response.data !== true) {
      throw new Error(
        "Doci wants a captcha for this file. Open the document in the browser, let its viewer load (solve the captcha if it shows one) and try again",
      )
    }
    const answer = await post(
      "/file/file_data/show",
      { file_id: page.id, file_size: page.size, file_extension: page.ext },
      referer,
    )
    if (!answer || answer.success !== true || !answer.response || !answer.response.url) {
      // Without the captcha's answer the site hands out a stub address that answers 410.
      throw new Error(
        "Doci wants a captcha for this file. Open the document in the browser, let its viewer load (solve the captcha if it shows one) and try again",
      )
    }
    let url = answer.response.url
    const shown = String(url).match(/[?&]url=([^&]+)/)
    if (shown) url = decodeURIComponent(shown[1])
    return {
      url,
      fileName: fileName(page.title, page.ext),
      headers: browserHeaders,
    }
  },
}

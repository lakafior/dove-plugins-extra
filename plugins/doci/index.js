// Doci (doci.pl): user-uploaded documents, a Docer twin with its own file store. Search stays on the
// site's own pages (Dove's browser opens them); Dove recognises a document's page and asks this plugin
// for the file.
//
// Files up to 1 MB are free: the page's "Pobierz plik" button posts the file's number to
// download/payment_info, which answers with a download address (doci.pl/download/<number>/<time>,
// redirecting to the file on download2.doci.pl with its own name) — no captcha, no account. Larger files
// cost transfer (the same call answers with a payment form instead), and that is not something a plugin
// gets around. What is left for them is the page's viewer: after its reCAPTCHA, file/file_data/show
// answers a PDF with the address its pdf.js renders (data-pdf-url, stream.doci.pl/getpdf/…): the whole
// original file, read out of the page by `harvest` and fetched with a doci.pl Referer. Any other format
// gets no file from the viewer (show fails even after the captcha), so nothing is harvested and the error
// says why. (Version 1.0.0 also took the last stream.doci.pl request the page made, which could be a
// preview image: the "random JPG".)
//
// Without the captcha's answer, show hands out a stub address that answers 410 (or redirects to the page).
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

/**
 * A document's page: the viewer's file id, extension and size (in #iframe2's data), the download button's
 * file number and the file's own name (the h1).
 */
async function itemPage(id) {
  const response = await dove.fetch(`https://${host}/${id}`, { headers: browserHeaders })
  if (response.status === 404 || response.status === 410) throw new Error("Doci no longer has this document")
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
    number: String($("#file-download").attr("data-file-id") || "").trim() || undefined,
    ext: String(iframe.attr("data-ext") || "").toLowerCase() || undefined,
    size: Number(iframe.attr("data-size")) || undefined,
    title,
  }
}

/** Free files (up to 1 MB): the address the "Pobierz plik" button opens, or nothing when Doci wants payment. */
async function freeDownload(number, referer) {
  const answer = await post("/download/payment_info", { item_id: Number(number), file_id: Number(number) }, referer)
  const data = answer && answer.success === true && answer.response && answer.response.download_data
  if (!data || !data.download_url || !data.time) return undefined
  return `${data.download_url}${answer.response.item_id || number}/${data.time}`
}

/** Doci's limit for downloads without payment. */
const freeLimit = 1024 * 1024

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
    version: "1.1.0",
    api: 1,
    summary: "Documents from doci.pl: search on the site in Dove's browser, download in the app, no account (files over 1 MB: PDFs only, after the page's captcha)",
    capabilities: ["resolve"],
    categories: ["books"],
    hosts: [host, `*.${host}`],
    browse: `https://${host}/search/all/{query}`,
    // A PDF's own address, read out of the page once its viewer has it: data-pdf-url, set only when show
    // succeeded (stream.doci.pl/getpdf/<n>/<id>/<token>, the whole original file; a Google Docs viewer URL
    // keeps it in its url=). Only for PDFs, the one format the viewer gets as itself, and never an image; a
    // free file (up to 1 MB) needs no harvest at all. The page's h1 rides along in the fragment, for the
    // file's name.
    harvest:
      "(function(){var e=document.getElementById('iframe2');if(!e||String(e.getAttribute('data-ext')||'').toLowerCase()!=='pdf'||Number(e.getAttribute('data-size'))<=1048576)return '';var u=e.getAttribute('data-pdf-url')||'';var m=u.match(/[?&]url=([^&]+)/);if(m)u=decodeURIComponent(m[1]);if(!/^https:\\/\\/stream2?\\.doci\\.pl\\/(get)?pdf\\//.test(u)||/\\.(jpe?g|png|gif|webp)(\\?|$)/i.test(u))return '';var h=document.querySelector('h1');var n=h?h.textContent.replace(/\\s+/g,' ').trim():'';return u.split('#')[0]+(n?'#name='+encodeURIComponent(n):'')})()",
    links: [
      // A document's page: /<user>/<name>+f<id>; pasted, shared, opened in Dove's browser. User names
      // may hold capitals, "_" and "." ("SzymiRunner", "kizi_").
      `^https?://${host.replace(/\./g, "\\.")}/(?<id>[^/?#]+/[^/?#]+\\+f[a-z0-9]+)/?(?:[?#]|$)`,
      // A viewer's PDF address (harvested, pasted, shared), with the harvested name if any.
      `^https?://(?<id>stream2?\\.${host.replace(/\./g, "\\.")}/(?:get)?pdf/[^?#]+(?:#name=[^#]*)?)`,
    ],
  },

  async resolve({ id }, ctx) {
    const raw = String(id || "").trim()
    if (!raw) throw new Error("Not a Doci document id")

    // A viewer's PDF address, handed back for downloading as it is: the file store answers it only with a
    // doci.pl Referer (410 without one), then redirects to the file.
    if (/^stream2?\.doci\.pl\/(?:get)?pdf\//i.test(raw)) {
      const [path, fragment = ""] = raw.split("#")
      let name = ""
      try {
        name = decodeURIComponent(fragment.replace(/^name=/, ""))
      } catch {
        name = ""
      }
      return {
        url: `https://${path}`,
        ...(name ? { fileName: fileName(name, "pdf") } : {}),
        headers: { ...browserHeaders, Referer: `https://${host}/` },
      }
    }

    const page = await itemPage(raw)
    const referer = `https://${host}/${raw}`

    // Up to 1 MB: the free download, the file itself under its own name.
    if (page.number && (!page.size || page.size <= freeLimit)) {
      const url = await freeDownload(page.number, referer)
      if (url) return { url, fileName: fileName(page.title, page.ext), headers: browserHeaders }
    }
    if (page.ext !== "pdf") {
      throw new Error(
        `Doci gives files over 1 MB only for payment, and its viewer shows ${String(page.ext || "this format").toUpperCase()} files only as a preview, not the file`,
      )
    }

    // A PDF over 1 MB: the viewer's own address, which needs the page's captcha solved. A harvested
    // address spares the user this path; it stays for a page that has not loaded its viewer.
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
      headers: { ...browserHeaders, Referer: referer },
    }
  },
}

// Anna's Archive: downloads with a member's fast-download key. Search stays on the site's own pages (Dove's
// browser opens them: they sit behind a browser check); Dove recognises a file's page and asks this plugin for
// the file. API: /dyn/api/fast_download.json?md5=…&key=… (the site documents it in the JSON itself).

/** "annas-archive.pk", from whatever the user pasted ("https://annas-archive.pk/"). */
function domain(ctx) {
  return String(ctx.settings.domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
}

/** The file name a download link carries (its last path part), else the md5. */
function fileName(link, md5) {
  const path = link.split(/[?#]/)[0]
  const last = path.slice(path.lastIndexOf("/") + 1)
  try {
    return decodeURIComponent(last) || md5
  } catch {
    return last || md5
  }
}

globalThis.plugin = {
  manifest: {
    id: "annas-archive.download",
    name: "Anna's Archive",
    version: "1.0.0",
    api: 1,
    summary: "Downloads with your member key; search on the site in Dove's browser",
    capabilities: ["resolve"],
    categories: ["books"],
    hosts: ["{domain}"],
    settings: [
      { key: "domain", title: "Address", type: "text", required: true, help: "The site's current domain, e.g. annas-archive.pk. Change it when the site moves." },
      { key: "key", title: "Secret key", type: "secret", required: true, help: "From your account page (needs a membership)." },
    ],
    browse: "https://{domain}/search?q={query}",
    links: ["^https?://{domain}/md5/(?<id>[0-9a-fA-F]{32})"],
  },

  async resolve({ id }, ctx) {
    const md5 = String(id).toLowerCase()
    if (!/^[0-9a-f]{32}$/.test(md5)) throw new Error("Not an Anna's Archive file id")
    const url = `https://${domain(ctx)}/dyn/api/fast_download.json?md5=${md5}&key=${encodeURIComponent(ctx.settings.key)}`
    const response = await dove.fetch(url, { headers: { Accept: "application/json" } })
    let answer
    try {
      answer = response.json()
    } catch {
      throw new Error(`${domain(ctx)} has no download API (status ${response.status}). Check the address.`)
    }
    if (!answer.download_url) throw new Error(answer.error || `No download link (status ${response.status})`)
    const info = answer.account_fast_download_info || {}
    if (typeof info.downloads_left === "number") dove.log(`fast downloads left today: ${info.downloads_left}`)
    return { url: answer.download_url, fileName: fileName(answer.download_url, md5) }
  },
}

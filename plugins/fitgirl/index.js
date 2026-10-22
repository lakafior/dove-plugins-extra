// FitGirl Repacks: PC game repacks (compressed installers) for Dove's Games search, through the site's WordPress
// REST API (no key, no login). A repack comes as a magnet: Dove adds it to the user's torrent service (repacks are
// often cached there), or with Download only fetches it to the phone. Install them on a PC.

const site = "https://fitgirl-repacks.site"
/** WordPress categories that hold repacks (Lossless Repack, Switch and PS3 Emulated, Hypervisor Bypass); not the
 *  Updates Digests or the site's news posts. */
const repackCategories = "5,42,43,319"

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" }
function unescape(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match)
}
const plain = (html) => unescape(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()

async function getJSON(path) {
  const response = await dove.fetch(`${site}${path}`, { headers: { Accept: "application/json" } })
  if (response.status !== 200) throw new Error(`FitGirl's site answered ${response.status}`)
  return response.json()
}

/** "from 18 GB [Selective Download]", "47.6 GB" → bytes. */
function repackSize(text) {
  const match = plain(text).match(/Repack Size\s*:?\s*(?:from\s*)?([\d.,]+)\s*(GB|MB)/i)
  if (!match) return undefined
  const value = Number(match[1].replace(",", "."))
  return Math.round(value * (match[2].toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2))
}

/** FitGirl's own magnet (its `dn` names the repack); a page may also list a mirror's. */
function magnet(content) {
  const magnets = (String(content || "").match(/magnet:\?[^"'<\s]+/g) || []).map(unescape)
  return magnets.find((link) => /fitgirl/i.test(decodeURIComponent(link.replace(/\+/g, " ")))) || magnets[0]
}

globalThis.plugin = {
  manifest: {
    id: "fitgirl.repacks",
    name: "FitGirl Repacks",
    version: "1.0.0",
    api: 1,
    summary: "PC game repacks from fitgirl-repacks.site for Games, as magnets your torrent service fetches; no account",
    capabilities: ["search", "resolve"],
    categories: ["games", "all"],
    hosts: ["fitgirl-repacks.site"],
    links: ["^https://fitgirl-repacks\\.site/(?<id>[a-z0-9-]+)/?$"],
  },

  async search({ query }) {
    const words = String(query || "").replace(/\s+/g, " ").trim()
    if (!words) return []
    const posts = await getJSON(
      `/wp-json/wp/v2/posts?search=${encodeURIComponent(words)}&per_page=20&orderby=relevance` +
        `&categories=${repackCategories}&_fields=id,slug,title,link,content`,
    )
    return (Array.isArray(posts) ? posts : [])
      .filter((post) => post && post.id != null && post.title)
      .map((post) => {
        const content = (post.content && post.content.rendered) || ""
        const cover = (content.match(/<img[^>]+src="(https:[^"]+)"/) || [])[1]
        return {
          id: String(post.id),
          title: plain(post.title.rendered),
          kind: "games",
          size: repackSize(content),
          cover,
          link: post.link,
        }
      })
  },

  async resolve({ id }) {
    // A post id from a search row, or a page's slug (fitgirl-repacks.site/<slug>/).
    const raw = String(id || "")
    let post
    if (/^\d+$/.test(raw)) {
      post = await getJSON(`/wp-json/wp/v2/posts/${raw}?_fields=title,content`)
    } else if (/^[a-z0-9-]+$/.test(raw)) {
      post = ((await getJSON(`/wp-json/wp/v2/posts?slug=${raw}&_fields=title,content`)) || [])[0]
    }
    if (!post || !post.content) throw new Error("FitGirl has no such repack")
    const link = magnet(post.content.rendered)
    if (!link) throw new Error("This post has no magnet (it may be news, not a repack)")
    // Titles name versions with slashes ("v1.03/v1.03.1"), which Dove would read as folders.
    const name = plain(post.title.rendered).replace(/\//g, "-")
    return { url: link, fileName: name, size: repackSize(post.content.rendered) }
  },
}

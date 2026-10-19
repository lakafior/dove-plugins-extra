// Chomikuj.pl with your own account: search every category in the app and download inside it. The site has no
// official API, but its Android app talks to one (mobile.chomikuj.pl/api/v3, the endpoints discovered by the
// open-source Chomikuj clients on GitHub); every request needs a Token header — MD5 of the path with query,
// the body and a salt the app carries — and the login answers an Api-Key the rest of the calls send. The
// account pays for downloads from its transfer, so logging in (Settings) is part of the deal: the balance
// rides along with a download link, and when the transfer cannot cover a file, the error says how much of it
// is left (files their owners marked free cost no transfer at all).
import { mapLimited, score } from "../_shared/text.js"

const host = "mobile.chomikuj.pl"
const salt = "wzrwYua$.DSe8suk!`'2"
// The app's own client: the API answers a browser's User-Agent with a 500.
const userAgent = "android/3.61 (9a7f2c1e-4c2a-9d3b-77e2f6a1b4c2; Google Pixel 6)"

/** MD5 (Dove's JavaScriptCore sandbox has no crypto); the same string the site's own client hashes. */
function md5(input) {
  const message = String(input)
  const bytes = []
  for (let i = 0; i < message.length; i++) {
    let code = message.codePointAt(i)
    if (code > 0xffff) i++
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  const bitCount = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 0; i < 8; i++) bytes.push((bitCount / Math.pow(2, i * 8)) & 0xff)

  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = new Int32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
  const rotl = (x, c) => (x << c) | (x >>> (32 - c))

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = new Int32Array(16)
    for (let i = 0; i < 16; i++) {
      M[i] = bytes[chunk + i * 4] | (bytes[chunk + i * 4 + 1] << 8) | (bytes[chunk + i * 4 + 2] << 16) | (bytes[chunk + i * 4 + 3] << 24)
    }
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F, g
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      const temp = D
      D = C
      C = B
      B = (B + rotl((A + F + K[i] + M[g]) | 0, S[i])) | 0
      A = temp
    }
    a0 = (a0 + A) | 0
    b0 = (b0 + B) | 0
    c0 = (c0 + C) | 0
    d0 = (d0 + D) | 0
  }
  const hex = (n) => {
    let out = ""
    for (let i = 0; i < 4; i++) out += (((n >>> (i * 8)) & 0xff).toString(16)).padStart(2, "0")
    return out
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

/** `encodeURIComponent` the way the site's client canonicalises a query: + for spaces, everything else %XX. */
function encode(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase())
}

/** One API call: Token = MD5(path with query + body + salt, without the leading slash), Api-Key when logged in. */
async function api(path, { query = "", body, apiKey } = {}) {
  const pathQuery = path + (query ? `?${query}` : "")
  const bodyText = body === undefined ? "" : JSON.stringify(body)
  const headers = { "User-Agent": userAgent, Token: md5(pathQuery.slice(1) + bodyText + salt) }
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8"
  if (apiKey) headers["Api-Key"] = apiKey
  const response = await dove.fetch(`https://${host}${pathQuery}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body: bodyText }),
  })
  // Cloudflare in front of the API sometimes answers a challenge page instead (seen by the other clients).
  const answered = response.headers || {}
  if (String(answered["cf-mitigated"] || "").toLowerCase() === "challenge" || /<title>just a moment|challenges\.cloudflare\.com/i.test(response.body || "")) {
    throw new Error("chomikuj.pl is checking this network (Cloudflare); try again in a few minutes")
  }
  let answer
  try {
    answer = response.json()
  } catch {
    answer = null
  }
  if (response.status !== 200 || !answer || (answer.Code === 401 && !answer.ApiKey)) {
    if (answer && answer.Code === 401) throw new Error("Chomikuj: wrong account name or password (Settings › Plugins › Chomikuj)")
    if (response.status !== 200) throw new Error(`chomikuj.pl answered ${response.status}`)
    throw new Error(`Chomikuj: ${(answer && answer.Message) || "the API answered nothing readable"}`)
  }
  return answer
}

/** Every call runs in a fresh context, so each one logs in first. */
async function login(ctx) {
  const name = String(ctx.settings.account || "").trim()
  const password = String(ctx.settings.password || "")
  if (!name || !password) {
    throw new Error("Chomikuj needs your account name and password in Settings › Plugins › Chomikuj")
  }
  const answer = await api("/api/v3/account/login", { body: { AccountName: name, Password: password } })
  if (!answer.ApiKey) throw new Error("Chomikuj login failed: " + (answer.Message || "no key"))
  return answer
}

/** Search words: a picked book's title and first author, else what the user typed. */
function words(query, book) {
  if (!book || !book.title) return query
  const author = (book.authors || [])[0]
  return author ? `${book.title} ${author.split(/\s+/).pop()}` : book.title
}

/** The site's own search filters (its API knows: All, Video, Music, Image, Documents, Others — nothing for
 *  software or audiobooks, so those search everything and keep the formats here, client-side). */
const filters = { media: "Video", books: "Documents", music: "Music", audiobooks: "All", software: "All", adult: "All", all: "All" }

/** What the site counts a file as, for the rows of the free categories. */
const kinds = { Video: "video", Music: "music", Document: "books", Application: "software", Image: "other", Archive: "other", Undefined: "other" }

const audioFormats = ["mp3", "m4b", "m4a", "ogg", "oga", "opus", "flac", "aac", "wav", "wma", "aa", "aax", "ape", "zip", "rar", "7z"]
const softwareFormats = ["exe", "msi", "rar", "zip", "7z", "iso", "apk", "dmg", "cab", "jar", "bin", "mdf", "nrg", "tar", "gz", "bz2", "rpm", "deb", "msu", "msp", "ipa"]
/** Formats Dove can use first, in Apple Books / Kindle order; audiobooks: one file beats a pack of many parts. */
const bookRank = { epub: 0, mobi: 1, azw3: 2, pdf: 3, djvu: 4, doc: 5, rtf: 6 }
const audioRank = { m4b: 0, mp3: 1, m4a: 2, flac: 3, ogg: 4, zip: 5, rar: 6, "7z": 7 }

/** A search result the API lists, as a row; the id carries the name, extension and size for `resolve`. */
function row(file, kind, query) {
  const title = String(file.FileName || "").replace(/\s+/g, " ").trim()
  if (!title) return null
  const format = String(file.FileType || "").toLowerCase() || undefined
  const owner = (file.Owner && file.Owner.Name) || ""
  const thumbnail = String(file.SmallThumbnailImg || file.ThumbnailImg || "").replace(/^http:/i, "https:")
  return {
    id: `${file.FileId}|${encodeURIComponent(title)}|${format || ""}|${Number(file.Size) || 0}`,
    title,
    author: owner || undefined,
    kind,
    format,
    size: (Number(file.Size) || 0) * 1024,
    cover: thumbnail || undefined,
    free: file.IsFileFreeForUser === true,
    match: score(query, title, owner ? [owner] : []),
  }
}

/** Audio files that make an album or a many-part audiobook when several sit in one folder. */
const folderAudio = ["mp3", "m4a", "m4b", "flac", "aac", "ogg", "oga", "opus", "wav", "wma", "ape", "alac", "aiff", "dsf"]

/**
 * Music and audiobooks: files that come from one folder of one chomik (an album's tracks, an audiobook's parts)
 * become one row for the whole folder; a folder only one file matched stays that file. The folder's id carries
 * the owner, folder and name for `resolve`, which asks the site for every file in it.
 */
function groupFolders(files, kind, query) {
  const groups = new Map()
  for (const file of files) {
    const format = String(file.FileType || "").toLowerCase()
    const owner = file.Owner && file.Owner.Id
    if (!folderAudio.includes(format) || !owner || !file.FolderId) continue
    const key = `${owner}/${file.FolderId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(file)
  }
  const rows = []
  const grouped = new Set()
  for (const [key, members] of groups) {
    if (members.length < 2) continue
    const first = members[0]
    const name = String(first.FolderName || "").replace(/\s+/g, " ").trim() || "Folder"
    const ownerName = (first.Owner && first.Owner.Name) || ""
    const counts = {}
    for (const file of members) {
      const format = String(file.FileType || "").toLowerCase()
      counts[format] = (counts[format] || 0) + 1
    }
    const format = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]
    const thumbnail = members.map((file) => String(file.SmallThumbnailImg || file.ThumbnailImg || "")).find(Boolean) || ""
    rows.push({
      id: `folder|${first.Owner.Id}|${first.FolderId}|${encodeURIComponent(name)}`,
      title: `${name} (folder, ${members.length}+ files)`,
      author: ownerName || undefined,
      kind,
      format,
      // Only the files the search matched: the folder may hold more.
      size: members.reduce((sum, file) => sum + (Number(file.Size) || 0) * 1024, 0),
      cover: thumbnail.replace(/^http:/i, "https:") || undefined,
      free: members.every((file) => file.IsFileFreeForUser === true),
      match: Math.max(score(query, name, ownerName ? [ownerName] : []), ...members.map((file) => score(query, String(file.FileName || ""), []))),
    })
    for (const file of members) grouped.add(file.FileId)
  }
  return { rows, grouped }
}

/** One file's download link; asking for it is what charges the transfer (free files aside). */
async function fileLink(session, fileId) {
  return api("/api/v3/files/download", { query: `FileId=${fileId}`, apiKey: session.ApiKey })
}

/** The API's codes for a link it does not give: 604 the file is gone, 605 the transfer does not cover it. */
function refused(answer) {
  if (answer.Code === 604) return new Error("Chomikuj no longer has this file (deleted or hidden by its owner)")
  return new Error("Chomikuj refused: " + (answer.Message || `code ${answer.Code}`))
}

function notEnoughTransfer(balance, bytes) {
  return new Error(
    `Not enough transfer for this file (${sizeText(bytes)}): ${balance.BalanceInfo || "your transfer ran out"}.` +
      (balance.PointsInfo ? ` ${balance.PointsInfo} can buy more; a file its owner marked free costs none.` : " A file its owner marked free costs none."),
  )
}

/**
 * Every file of a folder, in its order (the site's `Path` keeps subfolders such as CD1/CD2 together). Links are
 * asked four at a time: one by one, a many-part audiobook (100+ files) ran past the 30 seconds a call has. When
 * the transfer runs out partway, the files already paid for are still handed over rather than thrown away, and
 * the log says how many were left.
 */
async function resolveFolder(ownerId, folderId, name, ctx) {
  const session = await login(ctx)
  const listing = await api("/api/v3/folders/download/items", { query: `accountId=${ownerId}&folderId=${folderId}`, apiKey: session.ApiKey })
  if (listing.Code === 12) throw new Error(`The folder “${name}” has a password on chomikuj.pl.`)
  const files = (Array.isArray(listing.Files) ? listing.Files : []).filter((file) => file && file.FileId && !file.IsHidden)
  if (!files.length) throw new Error(`Chomikuj lists no files in “${name}”.`)
  files.sort((a, b) =>
    String(a.Path || "").localeCompare(String(b.Path || ""), undefined, { numeric: true }) ||
    String(a.FileName || "").localeCompare(String(b.FileName || ""), undefined, { numeric: true }),
  )
  // Once the transfer is out, no further link is asked for (each ask is a charge attempt).
  let outOfTransfer = null
  let firstError = null
  let thrown = null
  const answers = await mapLimited(files, 4, async (file) => {
    if (outOfTransfer) return null
    let answer
    try {
      answer = await fileLink(session, file.FileId)
    } catch (error) {
      thrown = thrown || error
      return null
    }
    if (answer.FileUrl) return answer
    if (answer.Code === 605) outOfTransfer = outOfTransfer || answer
    else firstError = firstError || answer
    return null
  })
  const links = []
  files.forEach((file, index) => {
    const answer = answers[index]
    if (!answer) return
    const format = String(file.FileType || "").toLowerCase()
    links.push({
      url: answer.FileUrl,
      headers: { "User-Agent": userAgent },
      fileName: fileName(String(file.FileName || "file").replace(new RegExp(`\\.${format}$`, "i"), ""), format),
      ...(Number(file.Size) ? { size: Number(file.Size) * 1024 } : {}),
    })
  })
  if (!links.length) {
    if (outOfTransfer) {
      throw notEnoughTransfer(outOfTransfer.AccountBalance || {}, (Number(listing.QuotaRequired) || 0) * 1024)
    }
    if (firstError) throw refused(firstError)
    throw thrown || new Error(`Chomikuj gave no links for “${name}”.`)
  }
  if (links.length < files.length) {
    const balance = (outOfTransfer && outOfTransfer.AccountBalance) || {}
    dove.log(`got ${links.length} of ${files.length} files${outOfTransfer ? `; transfer ran out: ${balance.BalanceInfo || "?"}` : ""}`)
  }
  return links
}

function fileName(title, format) {
  const clean = (text) => String(text || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim()
  const base = clean(title).slice(0, 150) || "file"
  return format ? `${base}.${format}` : base
}

function sizeText(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} kB`
}

globalThis.plugin = {
  manifest: {
    id: "chomikuj.files",
    name: "Chomikuj",
    version: "1.2.0",
    api: 1,
    summary:
      "chomikuj.pl with your account: search every category in the app and download from the account's transfer; albums and many-part audiobooks come as one folder",
    capabilities: ["search", "resolve"],
    categories: ["all", "media", "books", "audiobooks", "music", "software", "adult"],
    hosts: [host, "*.chomikuj.pl"],
    settings: [
      {
        key: "account",
        title: "Account name",
        type: "text",
        required: true,
        help: "Your chomikuj.pl account. Downloads draw from its transfer, so files their owners marked free cost nothing.",
      },
      { key: "password", title: "Password", type: "secret", required: true },
    ],
  },

  async search({ query, category, book }, ctx) {
    const session = await login(ctx)
    const q = words(query, book).replace(/\s+/g, " ").trim().slice(0, 100)
    if (!q) return []
    const filter = filters[category] || "All"
    // Software and audiobooks search everything and keep the formats client-side, so one page of 50 leaves
    // little behind; walk a few more while the answer says there is a next one.
    const pages = category === "software" || category === "audiobooks" ? [1, 2, 3] : [1]
    const files = []
    for (const page of pages) {
      const answer = await api("/api/v3/files/search", {
        query: `Query=${encode(q)}&PageNumber=${page}&MediaType=${filter}`,
        apiKey: session.ApiKey,
      })
      if (!Array.isArray(answer.Results)) throw new Error("Chomikuj: " + (answer.Message || "the search answered nothing"))
      files.push(...answer.Results)
      if (files.length >= 120 || answer.IsNextPageAvailable !== true) break
    }

    const inSet = (set, format) => set.includes(format)
    const rows = []
    // An album's tracks or an audiobook's parts from one folder: one row for the folder.
    let grouped = new Set()
    if (category === "music" || category === "audiobooks") {
      const folders = groupFolders(files, category, q)
      rows.push(...folders.rows)
      grouped = folders.grouped
    }
    for (const file of files) {
      if (grouped.has(file.FileId)) continue
      const format = String(file.FileType || "").toLowerCase()
      let kind
      if (category === "media") kind = "video"
      else if (category === "books") kind = "books"
      else if (category === "audiobooks") {
        if (!inSet(audioFormats, format)) continue
        kind = "audiobooks"
      } else if (category === "music") kind = "music"
      else if (category === "software") {
        if (file.MediaType !== "Application" && !inSet(softwareFormats, format)) continue
        kind = "software"
      } else kind = kinds[file.MediaType] || "other"
      rows.push(row(file, kind, q))
    }

    // The same file can sit with several chomiks; free ones first when titles are similar (they cost no transfer).
    const seen = new Set()
    const rank = category === "books" ? bookRank : category === "audiobooks" ? audioRank : {}
    return rows
      .filter((row) => row && (seen.has(row.id) ? false : seen.add(row.id)))
      .sort((a, b) => {
        const close = Math.round((b.match - a.match) * 5) // coarse: similar titles keep the format order
        if (close) return close
        if (a.free !== b.free) return a.free ? -1 : 1
        return (rank[a.format] ?? 9) - (rank[b.format] ?? 9)
      })
      .map(({ match, free, ...rest }) => rest)
  },

  async resolve({ id }, ctx) {
    const parts = String(id || "").split("|")
    if (parts[0] === "folder") {
      const [, ownerId, folderId, encodedName] = parts
      if (!/^\d+$/.test(ownerId || "") || !/^\d+$/.test(folderId || "")) throw new Error("Not a Chomikuj folder id")
      let name = ""
      try {
        name = decodeURIComponent(encodedName || "")
      } catch {
        name = encodedName || ""
      }
      return resolveFolder(ownerId, folderId, name, ctx)
    }
    const [fileId, encodedName, format, kilobytes] = parts
    if (!/^\d+$/.test(fileId || "")) throw new Error("Not a Chomikuj file id")
    let name = ""
    try {
      name = decodeURIComponent(encodedName || "")
    } catch {
      name = encodedName || ""
    }
    const session = await login(ctx)
    // Asking for the link is what charges the transfer (free files aside), even before the download itself starts.
    const answer = await fileLink(session, fileId)
    const balance = answer.AccountBalance || {}
    if (!answer.FileUrl) {
      if (answer.Code === 605) throw notEnoughTransfer(balance, kilobytes * 1024)
      throw refused(answer)
    }
    dove.log(`transfer left: ${balance.BalanceInfo || "?"}`)
    return {
      url: answer.FileUrl,
      headers: { "User-Agent": userAgent },
      fileName: fileName(name, format),
      ...(Number(kilobytes) ? { size: Number(kilobytes) * 1024 } : {}),
    }
  },
}

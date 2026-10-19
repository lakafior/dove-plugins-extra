# dove-plugins

Plugins for [Dove](https://github.com/lakafior/Dove) (iOS): book and music metadata and downloads from sites without an
official API, run on the phone in Dove's JavaScript sandbox. The contract is Dove's `docs/plugins.md` (API v1).

| Plugin | Id | Does | Reaches |
|---|---|---|---|
| Polskie książki | `pl.polskie-ksiazki` | metadata for Books and Audiobooks: lubimyczytac.pl, Audioteka (audiobooks), Storytel (the market's own editions) | lubimyczytac.pl, audioteka.com, www.storytel.com |
| Audible | `audible.metadata` | audiobook metadata from Audible's catalog API (store in settings) | api.audible.* |
| Deezer | `deezer.metadata` | album covers, titles, types and track lists for Music (Dove 2026-10-19 or newer), from Deezer's public API, no account. Deezer's API terms do not allow use alongside downloading: installing it is your call | api.deezer.com |
| Libgen | `libgen.books` | search for Books in the app (rows with format, size, language, cover) and download; no account. Mirror in settings (default libgen.li; also libgen.la, .bz, .gl) | the mirror you set |
| Anna's Archive | `annas-archive.download` | downloads with your member key; search on the site in Dove's browser, file pages are recognised | the address you set |
| Wolnelektury | `wolnelektury.books` | for a book picked from Dove's metadata search: Wolne Lektury's free Polish books (epub; PDF, mobi, fb2, txt as fallback) and audiobooks (mp3, a recorded work's parts under one row, in reading order), no account. The site's OPDS catalog searches books, its official API gives the files and the recordings | wolnelektury.pl |
| Docer | `docer.books` | documents from docer.pl: download in the app, no account; search on the site in Dove's browser, document pages are recognised | docer.pl, stream.docer.pl, stream2.docer.pl, img2.docer.pl |
| Doci | `doci.books` | documents from doci.pl (Docer's twin with its own file store): download in the app, no account; search on the site in Dove's browser, document pages are recognised | doci.pl, stream.doci.pl, stream2.doci.pl |
| Chomikuj | `chomikuj.files` | chomikuj.pl with your account (settings): search every category in the app (Media, Books, Audiobooks, Music, Software, Adult) and download inside it; downloads draw from the account's transfer, and when a file does not fit it the error says how much is left. The site's Android-app API (mobile.chomikuj.pl) does the work | mobile.chomikuj.pl, s*.chomikuj.pl |

## Use in Dove

Settings › Search and metadata › Plugins › Add repository:

```
https://lakafior.github.io/dove-plugins/index.json
```

Then install a plugin (Dove shows the hosts it may reach) and fill its settings.

## Build

```sh
npm ci
npm run build      # dist/plugins/*.js and dist/index.json with each script's SHA-256
```

Pushing to `main` publishes `dist/` to GitHub Pages (`.github/workflows/pages.yml`; Settings › Pages › Source:
GitHub Actions). Dove installs only scripts whose SHA-256 matches the index, so a changed plugin needs a new
version in its manifest.

## Writing a plugin

- `plugins/<name>/index.js` sets `globalThis.plugin = { manifest, metadata?, tracks?, search?, resolve? }` (see Dove's
  `docs/plugins.md`); shared code lives in `plugins/_shared/`.
- Network only through `await dove.fetch(url, { headers })` to the manifest's `hosts`.
- JavaScriptCore has no DOM, `URL`, `TextDecoder`, timers or `atob`: `plugins/_shared/polyfills.js` is injected
  into every bundle (`atob`, which cheerio needs); parse HTML with `cheerio/slim`.
- Bundles must stay under 2 MB; calls have 30 seconds.

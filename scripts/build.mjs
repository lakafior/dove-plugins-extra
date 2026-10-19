// Bundles every plugin in plugins/<name>/index.js into dist/plugins/<name>.js (one IIFE, no Node built-ins:
// it runs in Dove's JavaScriptCore sandbox) and writes dist/index.json with each script's SHA-256.
import { build } from "esbuild"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import vm from "node:vm"

const root = new URL("..", import.meta.url)
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"))
const dist = new URL("dist/", root)
await rm(dist, { recursive: true, force: true })
await mkdir(new URL("plugins/", dist), { recursive: true })

const entries = []
for (const name of (await readdir(new URL("plugins/", root))).sort()) {
  const entry = new URL(`plugins/${name}/index.js`, root)
  if (!existsSync(entry)) continue
  const outfile = new URL(`plugins/${name}.js`, dist)
  await build({
    entryPoints: [entry.pathname],
    outfile: outfile.pathname,
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: "es2020",
    mainFields: ["module", "main"],
    inject: [new URL("plugins/_shared/polyfills.js", root).pathname],
    minify: true,
    legalComments: "none",
    logLevel: "warning",
  })
  const code = await readFile(outfile)
  if (code.length > 2 * 1024 * 1024) throw new Error(`${name}: bundle is over Dove's 2 MB limit`)

  // Read the manifest the way Dove does: run the script and look at globalThis.plugin.manifest.
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(code.toString(), sandbox)
  const manifest = sandbox.plugin?.manifest
  if (!manifest?.id || !manifest.version) throw new Error(`${name}: no plugin.manifest with id and version`)

  entries.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    summary: manifest.summary,
    script: `plugins/${name}.js`,
    sha256: createHash("sha256").update(code).digest("hex"),
    api: manifest.api ?? 1,
    adult: manifest.adult ?? false,
  })
  console.log(`${manifest.id} ${manifest.version}  ${(code.length / 1024).toFixed(0)} KB`)
}

const index = { format: "dove-plugins", version: 1, name: pkg.dove.repository, plugins: entries }
await writeFile(new URL("index.json", dist), JSON.stringify(index, null, 2) + "\n")
await writeFile(
  new URL("index.html", dist),
  `<!doctype html><meta charset="utf-8"><title>${pkg.dove.repository}</title>` +
    `<p>Dove plugin repository. In Dove: Settings › Plugins › Add repository, then paste <code>${pkg.dove.url}</code>.`
)
console.log(`index.json: ${entries.length} plugins`)

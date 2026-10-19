// Injected first into every plugin (scripts/build.mjs): Web APIs bundled libraries expect but JavaScriptCore,
// as Dove runs it, does not have. Pure JavaScript, no host access.

if (typeof globalThis.atob !== "function") {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  // `entities` (inside cheerio) decodes its tables with atob when it loads.
  globalThis.atob = (input) => {
    const text = String(input).replace(/[\t\n\f\r =]/g, "")
    let output = ""
    let buffer = 0
    let bits = 0
    for (const char of text) {
      const value = alphabet.indexOf(char)
      if (value < 0) throw new Error("atob: not base64")
      buffer = (buffer << 6) | value
      bits += 6
      if (bits >= 8) {
        bits -= 8
        output += String.fromCharCode((buffer >> bits) & 0xff)
      }
    }
    return output
  }
}

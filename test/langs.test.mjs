import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";
import { extra } from "../lang-extra.mjs";

const LANGS = ["es", "hi", "fr", "pt", "de", "zh", "ar", "bn", "te", "ta"];
const INTERNAL = new Set([
  "20.00",
  "built-in",
  "denied",
  "device",
  "download",
  "en",
  "http://localhost:11434/v1",
  "needs-install",
  "NotAllowedError",
  "one",
  "pull",
  "unsupported",
]);

function tokens(text) {
  return [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
}

function calls(code, name) {
  const out = [];
  let i = 0;
  while (i < code.length) {
    const at = code.indexOf(name + "(", i);
    if (at < 0) break;
    if (at > 0 && /[A-Za-z0-9_$]/.test(code[at - 1])) {
      i = at + 1;
      continue;
    }
    let j = at + name.length + 1;
    let depth = 1;
    let quoting = false;
    let q = "";
    let esc = false;
    let start = 0;
    for (; j < code.length && depth > 0; j++) {
      const c = code[j];
      if (quoting) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === q) {
          if (depth === 1 && q === '"') {
            try {
              out.push(vm.runInNewContext('"' + code.slice(start, j) + '"'));
            } catch {
              /* not a user string */
            }
          }
          quoting = false;
        }
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quoting = true;
        q = c;
        start = j + 1;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    i = j;
  }
  return out;
}

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const pack = JSON.parse(html.match(/id="tally-langs">([\s\S]*?)<\/script>/)[1]);
const decode = (b64) => JSON.parse(inflateRawSync(Buffer.from(b64, "base64")).toString());
const keys = decode(pack.$keys);
const tables = Object.fromEntries(LANGS.map((lang) => [lang, decode(pack[lang])]));

test("every new sentence is translated in the ten built-in languages", () => {
  for (const [english, row] of Object.entries(extra)) {
    const index = keys.indexOf(english);
    assert.notEqual(index, -1, `missing key: ${english}`);
    for (const lang of LANGS) {
      const value = tables[lang][index];
      assert.equal(typeof value, "string", `${lang} missing ${english}`);
      assert.ok(value.trim(), `${lang} empty ${english}`);
      assert.equal(tokens(value), tokens(english), `${lang} placeholders ${english}`);
      assert.equal(value, row[lang], `${lang} drifted for ${english}`);
    }
  }
});

test("every visible string in the app has a pack entry", () => {
  const js = html.slice(html.indexOf("<script type=\"module\">"), html.lastIndexOf("</script>"));
  const strings = new Set([...calls(js, "t"), ...calls(js, "j")]);
  const keyset = new Set(keys);
  const missing = [...strings].filter((s) => !INTERNAL.has(s) && !keyset.has(s));
  assert.deepEqual(missing, []);
});

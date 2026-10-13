// Build both editions from the same source:
//   dist/site/                       the free web version (static hosting)
//   dist/contact-cleaner-pro.html    the paid offline copy: one self-contained file
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");
const DIST = path.join(ROOT, "dist");

// String.replace would read "$&" and friends inside the inlined code as
// replacement patterns, so every substitution goes through a function.
function swap(html, target, content) {
  if (!html.includes(target)) throw new Error("build: missing " + target);
  return html.replace(target, () => content);
}
// Inline code must not close its own <script> element early.
const script = (code) => "<script>\n" + code.replace(/<\/script/gi, "<\\/script") + "\n</script>";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(path.join(DIST, "site", "vendor"), { recursive: true });

// ---- the free website ----------------------------------------------------------
for (const f of ["index.html", "style.css", "engine.js", "config.js", "app.js", "vendor/xlsx.full.min.js", "vendor/SHEETJS-LICENSE"]) {
  copyFileSync(path.join(ROOT, f), path.join(DIST, "site", f));
}

// ---- Pro: one file, no limits ------------------------------------------------
const PRO_CONFIG = `window.CC_CONFIG = { edition: "pro", freeRows: Infinity, buyUrl: "", price: "" };`;
let pro = read("index.html");
pro = swap(pro, '<html lang="en" data-edition="free">', '<html lang="en" data-edition="pro">');
pro = pro.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, () =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`);
pro = swap(pro, "<title>Contact Cleaner: find the duplicate contacts Excel misses</title>", "<title>Contact Cleaner Pro</title>");
pro = swap(pro, '<link rel="stylesheet" href="style.css">', "<style>\n" + read("style.css") + "\n</style>");
pro = swap(pro, '<script src="vendor/xlsx.full.min.js"></script>', script(read("vendor/xlsx.full.min.js")));
pro = swap(pro, '<script src="engine.js"></script>', script(read("engine.js")));
pro = swap(pro, '<script src="config.js"></script>', script(PRO_CONFIG));
pro = swap(pro, '<script src="app.js"></script>', script(read("app.js")));
writeFileSync(path.join(DIST, "contact-cleaner-pro.html"), pro);

console.log("built dist/site/ and dist/contact-cleaner-pro.html (" + Math.round(pro.length / 1024) + " KB)");

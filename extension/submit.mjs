// Submit the Firefox add-on to addons.mozilla.org through Mozilla's API.
//
//   node extension/submit.mjs check     is the key accepted? (changes nothing)
//   node extension/submit.mjs preview   print what would be sent (no network, no key)
//   node extension/submit.mjs validate  upload the package and wait for Mozilla's checker;
//                                       an upload alone creates no listing
//   node extension/submit.mjs submit    validate, then create the listing and send it for review
//   node extension/submit.mjs screenshots  add the ones the listing does not have yet
//   node extension/submit.mjs status    where the listing stands
//
// The key lives outside this public repository, in ~/.amo.env:
//   AMO_KEY=user:...      AMO_SECRET=...
// It is sent only to Mozilla, and is never printed.
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.AMO_TEST_API || "https://addons.mozilla.org/api/v5/";
const KEYFILE = process.env.AMO_KEYFILE || path.join(homedir(), ".amo.env");
const POLL_MS = Number(process.env.AMO_POLL_MS || 3000);
const PACKAGE = path.join(ROOT, "dist", "contact-cleaner-firefox.zip");
const IMAGES = path.join(ROOT, "dist", "listing");
const settings = JSON.parse(readFileSync(path.join(ROOT, "extension", "listing.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));
const addonUrl = `addons/addon/${encodeURIComponent(settings.guid)}/`;

// ---- the text, from LISTING.md, so there is one copy of it ---------------------
const listing = readFileSync(path.join(ROOT, "extension", "LISTING.md"), "utf8").replace(/\r\n/g, "\n");
function between(start, end) {
  const a = listing.indexOf(start), b = listing.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error("LISTING.md: cannot find " + start);
  return listing.slice(a + start.length, b).trim();
}
const en = (text) => ({ "en-US": text });
const unwrap = (text) => text.replace(/([^\n])\n(?!\n|- |  - ) */g, "$1 ");
const text = {
  name: between("**Name:**", "\n"),
  summary: between("**Summary:**", "**Description:**"),
  description: between("**Description:**", "**This add-on requires payment"),
  privacy: unwrap(between("**Privacy policy:**", "## Notes to reviewers")),
  notes: unwrap(between("## Notes to reviewers", "## Images")),
};
if (text.name !== manifest.name) throw new Error("the name in LISTING.md and manifest.json differ");
if (text.summary.length > 250) throw new Error("the summary is over 250 characters");
if (settings.guid !== manifest.browser_specific_settings.gecko.id) throw new Error("the add-on id differs");

const body = (upload) => ({
  default_locale: "en-US",
  name: en(text.name),
  summary: en(text.summary),
  description: en(text.description),
  homepage: en(settings.homepage),
  support_url: en(settings.support_url),
  categories: { firefox: settings.categories },
  requires_payment: settings.requires_payment,
  version: { upload, license: settings.license, compatibility: ["firefox"], approval_notes: text.notes },
});

// ---- the API -------------------------------------------------------------------
function credentials() {
  if (!existsSync(KEYFILE)) throw new Error(`no key file: ${KEYFILE}`);
  const env = Object.fromEntries(readFileSync(KEYFILE, "utf8").replace(/^﻿/, "").split(/\r?\n/)
    .map((l) => l.match(/^\s*(AMO_\w+)\s*=\s*"?([^"\s]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  if (!env.AMO_KEY || !env.AMO_SECRET) throw new Error(`fill in AMO_KEY and AMO_SECRET in ${KEYFILE}`);
  return env;
}
// Mozilla refuses a token from a clock that runs even a little fast, so its own clock is used.
let offset = null;
async function serverNow() {
  if (offset === null) {
    const res = await fetch(API + "site/", { method: "HEAD" });
    const date = Date.parse(res.headers.get("date") || "");
    offset = Number.isFinite(date) ? date - Date.now() : 0;
  }
  return Math.floor((Date.now() + offset) / 1000) - 1;
}
async function token() {
  const { AMO_KEY, AMO_SECRET } = credentials();
  const now = await serverNow();
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = part({ alg: "HS256", typ: "JWT" }) + "." +
    part({ iss: AMO_KEY, jti: randomUUID(), iat: now, exp: now + 60 });
  return head + "." + createHmac("sha256", AMO_SECRET).update(head).digest("base64url");
}
async function call(method, url, payload, { allow = [] } = {}) {
  const headers = { Authorization: "JWT " + await token() };
  const form = payload instanceof FormData;
  if (payload && !form) headers["Content-Type"] = "application/json";
  const res = await fetch(API + url, {
    method, headers, body: payload ? (form ? payload : JSON.stringify(payload)) : undefined, redirect: "error",
  });
  const raw = await res.text();
  if (!res.ok && !allow.includes(res.status)) throw new Error(`${method} ${url}: ${res.status} ${raw.slice(0, 600)}`);
  let data = null;
  try { data = JSON.parse(raw); } catch { /* some answers have no body */ }
  return { status: res.status, data };
}
const file = (p, type) => new File([readFileSync(p)], path.basename(p), { type });

async function validate() {
  const form = new FormData();
  form.append("upload", file(PACKAGE, "application/zip"));
  form.append("channel", "listed");
  let { data } = await call("POST", "addons/upload/", form);
  const uuid = data.uuid;
  for (let i = 0; !data.processed; i++) {
    if (i >= 60) throw new Error("Mozilla's checker has not finished; try again later");
    await new Promise((r) => setTimeout(r, POLL_MS));
    ({ data } = await call("GET", `addons/upload/${uuid}/`));
  }
  const v = data.validation || {};
  console.log(`checker: ${data.valid ? "passed" : "FAILED"} (${v.errors ?? "?"} errors, ${v.warnings ?? "?"} warnings)`);
  for (const m of v.messages || []) console.log(`- ${m.type}: ${m.message} ${m.file || ""}`);
  if (!data.valid) throw new Error("the package was refused; nothing was submitted");
  return uuid;
}

// Mozilla limits how fast changes may come; wait between them, and only add what is missing.
async function screenshots(step) {
  const { data } = await call("GET", addonUrl);
  const names = readdirSync(IMAGES).filter((n) => /^\d.*\.png$/.test(n)).sort();
  for (const name of names.slice((data.previews || []).length)) {
    await new Promise((r) => setTimeout(r, POLL_MS * 22));
    await step("screenshot " + name, () => {
      const f = new FormData();
      f.append("image", file(path.join(IMAGES, name), "image/png"));
      return call("POST", addonUrl + "previews/", f);
    });
  }
}

async function submit() {
  const before = await call("GET", addonUrl, null, { allow: [401, 403, 404] });
  if (before.status !== 404) throw new Error("this add-on id already exists on Mozilla (or is not yours); nothing was sent");
  const uuid = await validate();
  const { data } = await call("PUT", addonUrl, body(uuid));
  console.log(`created: ${data.url || data.slug} (status ${data.status})`);
  // The listing exists now: report each remaining step instead of stopping at the first problem.
  let failed = 0;
  const step = async (name, fn) => {
    try { await fn(); console.log(`${name}: done`); } catch (e) { failed++; console.log(`${name}: NOT done. ${e.message}`); }
  };
  await step("privacy policy", () => call("PATCH", addonUrl + "eula_policy/", { privacy_policy: en(text.privacy) }));
  await step("icon", () => {
    const f = new FormData();
    f.append("icon", file(path.join(IMAGES, "icon-128.png"), "image/png"));
    return call("PATCH", addonUrl, f);
  });
  await screenshots(step);
  await step("check that the payment notice is on", async () => {
    const { data: now } = await call("GET", addonUrl);
    if (now.requires_payment !== true) throw new Error("tick 'requires payment' on the add-on's edit page");
  });
  if (failed) process.exitCode = 1;
}

const commands = {
  preview: () => console.log(JSON.stringify({ ...body("(upload id)"), privacy_policy: text.privacy }, null, 1)),
  check: async () => {
    const { data } = await call("GET", "accounts/profile/");
    console.log(`key accepted for the account named "${data.name || data.username}"`);
  },
  validate,
  submit,
  screenshots: () => screenshots(async (name, fn) => { await fn(); console.log(`${name}: done`); }),
  status: async () => {
    const { data } = await call("GET", addonUrl);
    console.log(`${data.name?.["en-US"] || data.name}: ${data.status}; ${data.url}`);
  },
};
const command = commands[process.argv[2]];
if (!command) {
  console.error("use: node extension/submit.mjs check | preview | validate | submit | screenshots | status");
  process.exitCode = 2;
} else {
  try { await command(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

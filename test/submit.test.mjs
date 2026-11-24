// The submit script against a stand-in for Mozilla's API (needs `node build.mjs`, the
// packaged zip and dist/listing). Run: node --test test/submit.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "s3cret-value-for-tests";
const skip = !existsSync(path.join(ROOT, "dist", "contact-cleaner-firefox.zip")) ||
  !existsSync(path.join(ROOT, "dist", "listing", "icon-128.png"));

async function run(command, { exists = false, valid = true, failOn = null } = {}) {
  const seen = [];
  let created = exists;
  const server = http.createServer((req, res) => {
    const chunks = [];
    if (req.method === "HEAD") { res.writeHead(200, { Date: new Date(Date.now() - 600_000).toUTCString() }); return res.end(); }
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("latin1");
      const url = decodeURIComponent(req.url);
      seen.push({ method: req.method, url, raw, auth: req.headers.authorization });
      const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (failOn && url.includes(failOn) && req.method !== "GET") return send(400, { detail: "no" });
      if (url === "/accounts/profile/") return send(200, { name: "Tester" });
      if (url === "/addons/upload/") return send(201, { uuid: "u1", processed: false });
      if (url === "/addons/upload/u1/") return send(200, { uuid: "u1", processed: true, valid,
        validation: { errors: valid ? 0 : 1, warnings: 0, messages: valid ? [] : [{ type: "error", message: "bad" }] } });
      if (req.method === "PUT") { created = true; return send(201, { slug: "contact-cleaner", status: "nominated" }); }
      if (req.method === "GET") return created ? send(200, { name: { "en-US": "X" }, status: "nominated", requires_payment: true }) : send(404, {});
      return send(200, {});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const keyfile = path.join(mkdtempSync(path.join(os.tmpdir(), "amo-")), "k.env");
  writeFileSync(keyfile, `AMO_KEY=user:1:2\r\nAMO_SECRET=${SECRET}\r\n`);
  const child = spawn(process.execPath, [path.join(ROOT, "extension", "submit.mjs"), command], {
    env: { ...process.env, AMO_TEST_API: `http://127.0.0.1:${server.address().port}/`, AMO_KEYFILE: keyfile, AMO_POLL_MS: "5" } });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const code = await new Promise((r) => child.on("close", r));
  server.close();
  return { seen, out, code };
}
const changes = (seen) => seen.filter((s) => s.method !== "GET" && !s.url.startsWith("/addons/upload/"));

test("submit sends everything once, signed, and never prints the secret", { skip }, async () => {
  const { seen, out, code } = await run("submit");
  assert.equal(code, 0, out);
  assert.ok(!out.includes(SECRET));
  const put = seen.filter((s) => s.method === "PUT");
  assert.equal(put.length, 1);
  assert.equal(put[0].url, "/addons/addon/contact-cleaner@naserdemiraj.github.io/");
  const b = JSON.parse(Buffer.from(put[0].raw, "latin1").toString("utf8"));
  assert.equal(b.requires_payment, true);
  assert.deepEqual(b.categories, { firefox: ["other"] });
  assert.deepEqual(b.version.compatibility, ["firefox"]);
  assert.equal(b.version.upload, "u1");
  assert.match(b.description["en-US"], /What needs payment/);
  assert.match(b.version.approval_notes, /cc015130aa8521e7/);
  assert.ok(seen.some((s) => s.url.endsWith("/eula_policy/") && s.raw.includes("collects, stores and sends no data")));
  assert.equal(seen.filter((s) => s.url.endsWith("/previews/")).length, 3);
  const [h, p, sig] = put[0].auth.replace("JWT ", "").split(".");
  assert.equal(sig, createHmac("sha256", SECRET).update(h + "." + p).digest("base64url"));
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  assert.ok(claims.iss === "user:1:2" && claims.exp - claims.iat <= 300 && claims.jti);
  assert.ok(Math.abs(Date.now() / 1000 - 600 - claims.iat) < 30, "the server's clock is used, not this one");
});

test("a package the checker refuses is not submitted", { skip }, async () => {
  const { seen, out, code } = await run("submit", { valid: false });
  assert.equal(code, 1);
  assert.match(out, /nothing was submitted/);
  assert.equal(changes(seen).length, 0);
});

test("an id that already exists is left alone", { skip }, async () => {
  const { seen, code } = await run("submit", { exists: true });
  assert.equal(code, 1);
  assert.ok(seen.every((s) => s.method === "GET"));
});

test("a failed later step is reported and the rest still runs", { skip }, async () => {
  const { seen, out, code } = await run("submit", { failOn: "eula_policy" });
  assert.equal(code, 1);
  assert.match(out, /privacy policy: NOT done/);
  assert.equal(seen.filter((s) => s.url.endsWith("/previews/")).length, 3);
});

test("check and validate create no listing", { skip }, async () => {
  for (const c of ["check", "validate"]) {
    const { seen, code } = await run(c);
    assert.equal(code, 0);
    assert.equal(changes(seen).length, 0);
  }
});

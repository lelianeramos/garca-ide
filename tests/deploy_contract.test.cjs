"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tracked = walk(root).filter(file => !file.includes(`${path.sep}node_modules${path.sep}`) && !file.includes(`${path.sep}.git${path.sep}`) && !file.includes(`${path.sep}output${path.sep}`));
assert.deepEqual(tracked.filter(file => /(?:^|[\\/])app\.(?:m?js)$/i.test(file)), [], "app.js/app.mjs não pode existir");

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
assert.equal(vercel.framework, null);
assert.equal(vercel.buildCommand, null);
assert.equal(vercel.installCommand, "npm install");

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(html, /type="module" src="studio-ui\.js"/);
assert.doesNotMatch(html, /app\.(?:m?js)/i);
for (const file of ["studio-ui.js", "block-engine.js"]) assert.ok(fs.statSync(path.join(root, file)).size > 100);

process.stdout.write("✓ contrato de deploy estático da Vercel validado\n");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(item) : [item];
  });
}

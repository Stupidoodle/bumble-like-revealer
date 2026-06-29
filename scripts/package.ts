#!/usr/bin/env bun
// Build the extension and assemble a Chrome-loadable zip under release/.
//
//   bun run scripts/package.ts          # build, then zip
//   SKIP_BUILD=1 bun run scripts/package.ts   # zip the existing dist/ as-is
//
// The archive root IS the extension: unzip it and point chrome://extensions
// "Load unpacked" at the folder. Files are sourced from the fresh dist/ build
// and copied to the exact path the manifest references, so it works whether the
// manifest points at "content.js" or "dist/content.js".

import { mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "release");

function run(cmd: string[], cwd = ROOT): void {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) {
    console.error(`command failed (${p.exitCode}): ${cmd.join(" ")}`);
    process.exit(p.exitCode ?? 1);
  }
}

function hasZip(): boolean {
  return Bun.spawnSync(["zip", "-v"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

// 1. Fresh production build (unless reusing an existing dist/).
if (!process.env.SKIP_BUILD) run(["bun", "run", "build.ts"]);

if (!hasZip()) {
  console.error('the "zip" CLI is required (preinstalled on macOS and ubuntu-latest)');
  process.exit(1);
}

const pkg = JSON.parse(await Bun.file("package.json").text());
const manifest = JSON.parse(await Bun.file("manifest.json").text());
const name: string = pkg.name || "extension";
const version: string = manifest.version || pkg.version || "0.0.0";

const stage = join(OUT_DIR, `${name}-${version}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 2. manifest.json at the package root.
cpSync("manifest.json", join(stage, "manifest.json"));

// 3. Each content-script bundle, mirrored to the path the manifest names but
//    sourced from the freshly built dist/<basename>.
const jsPaths = new Set<string>();
for (const cs of manifest.content_scripts ?? []) for (const j of cs.js ?? []) jsPaths.add(j);
for (const rel of jsPaths) {
  const src = join("dist", basename(rel));
  if (!existsSync(src)) {
    console.error(`missing built file for manifest entry "${rel}" (expected ${src}) — did the build run?`);
    process.exit(1);
  }
  const dest = join(stage, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}

// 4. Any icons the manifest declares (optional; copied verbatim from the repo).
const icons = new Set<string>();
for (const v of Object.values(manifest.icons ?? {})) icons.add(String(v));
const da = manifest.action?.default_icon;
if (typeof da === "string") icons.add(da);
else for (const v of Object.values(da ?? {})) icons.add(String(v));
for (const rel of icons) {
  if (!existsSync(rel)) { console.warn(`icon "${rel}" not found, skipping`); continue; }
  const dest = join(stage, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(rel, dest);
}

// 5. Zip the staged folder's contents (archive root = extension root).
const zipName = `${name}-${version}.zip`;
rmSync(join(OUT_DIR, zipName), { force: true });
run(["zip", "-r", "-X", join("..", zipName), "."], stage);

console.log(`\n✓ packaged release/${zipName}`);
console.log("  load it: unzip, then chrome://extensions → Developer mode → Load unpacked");

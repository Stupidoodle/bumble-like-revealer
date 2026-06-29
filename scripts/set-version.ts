#!/usr/bin/env bun
// Stamp a version into package.json and manifest.json. Called by semantic-release
// (@semantic-release/exec prepareCmd) with the computed next version, so the
// Chrome manifest version always matches the GitHub release / git tag.
//
//   bun run scripts/set-version.ts 1.4.0

const version = process.argv[2];
if (!version) {
  console.error("usage: bun run scripts/set-version.ts <version>");
  process.exit(1);
}

// Chrome's manifest "version" accepts only 1-4 dot-separated integers; strip any
// semver prerelease/build metadata (e.g. 1.4.0-beta.1 -> 1.4.0) so it stays valid.
const manifestVersion = version.replace(/[-+].*$/, "");

const targets: Array<[string, string]> = [
  ["package.json", version],
  ["manifest.json", manifestVersion],
];

for (const [file, value] of targets) {
  const json = JSON.parse(await Bun.file(file).text());
  json.version = value;
  await Bun.write(file, JSON.stringify(json, null, 2) + "\n");
  console.log(`set ${file} version -> ${value}`);
}

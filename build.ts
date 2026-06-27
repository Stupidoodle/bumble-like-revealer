/**
 * Bun-native bundler for the extension.
 *
 * Two entrypoints, two worlds, one toolchain:
 *   src/page/page.ts     -> dist/page.js     (MAIN world, document_start)
 *   src/content/content.ts -> dist/content.js (isolated world, document_idle)
 *
 * Both emit self-contained IIFE bundles so they run as classic content
 * scripts (no ESM in MV3 content scripts) and page.js stays synchronous
 * enough to patch fetch before Bumble's first request.
 *
 *   bun run build.ts            production build (minified)
 *   bun run build.ts --watch    rebuild on change, with sourcemaps
 */
import { rmSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

const DEBUG = dev;
const PUBLIC_SAFE = false; // hide the de-anonymizing trio in a public build

async function build(): Promise<boolean> {
  rmSync("dist", { recursive: true, force: true });
  mkdirSync("dist", { recursive: true });

  const result = await Bun.build({
    entrypoints: ["src/page/page.ts", "src/content/content.ts"],
    outdir: "dist",
    naming: "[name].js",
    target: "browser",
    format: "iife",
    minify: !dev,
    sourcemap: dev ? "linked" : "none",
    define: {
      __DEBUG__: JSON.stringify(DEBUG),
      __BE_PUBLIC_SAFE__: JSON.stringify(PUBLIC_SAFE),
    },
  });

  if (!result.success) {
    console.error("build failed");
    for (const log of result.logs) console.error(log);
    return false;
  }
  console.log(
    `built ${result.outputs.length} files -> dist/ (${dev ? "dev" : "prod"})`,
  );
  return true;
}

const ok = await build();
if (!ok && !watch) process.exit(1);

if (watch) {
  console.log("watching src/ ...");
  const { watch: fsWatch } = await import("node:fs");
  let timer: ReturnType<typeof setTimeout> | null = null;
  fsWatch("src", { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(build, 80);
  });
}

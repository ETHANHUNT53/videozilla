import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Timeline } from "./schema.js";

/**
 * Re-renders an existing run (out/<run-id>) from its timeline.json, without calling Gemini or the voice API again.
 *   npm run render-run -- out/<run-id> [--style bold-dark]
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const [dirArg, ...rest] = process.argv.slice(2);
  if (!dirArg) throw new Error("Usage: npm run render-run -- out/<run-id> [--style clean-light|bold-dark]");
  const dir = path.resolve(dirArg);
  const timeline = JSON.parse(await readFile(path.join(dir, "timeline.json"), "utf8")) as Timeline;
  const styleIdx = rest.indexOf("--style");
  if (styleIdx >= 0 && rest[styleIdx + 1]) timeline.styleId = rest[styleIdx + 1];

  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, renderStill, selectComposition } = await import("@remotion/renderer");
  const started = Date.now();
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "video", "index.ts"), publicDir: path.join(ROOT, "public") });
  const inputProps = timeline as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps });
  const suffix = styleIdx >= 0 ? `-${timeline.styleId}` : "";
  const file = path.join(dir, `video${suffix}.mp4`);
  let last = -10;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: file,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= last + 20) {
        last = pct;
        console.log(`  ${pct}%`);
      }
    },
  });
  await renderStill({ composition, serveUrl, output: path.join(dir, `cover${suffix}.png`), frame: Math.min(composition.durationInFrames - 1, 60), inputProps });
  const seconds = Math.round((Date.now() - started) / 1000);
  await writeFile(path.join(dir, `render${suffix}.json`), JSON.stringify({ file, seconds, durationSec: timeline.durationInFrames / timeline.fps }, null, 2));
  console.log(`Rendered ${(timeline.durationInFrames / timeline.fps).toFixed(1)}s video in ${seconds}s → ${file}`);
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

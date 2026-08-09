import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const target = join("dist", "download-assets", "index.html");
await mkdir(dirname(target), { recursive: true });
await copyFile(join("dist", "index.html"), target);

const assetsDir = join("dist", "download-assets", "assets");
const files = await readdir(assetsDir);
const scriptFile = files.find((file) => /^index-[\w-]+\.js$/.test(file));
const styleFile = files.find((file) => /^index-[\w-]+\.css$/.test(file));

if (!scriptFile || !styleFile) {
  throw new Error("Could not find Vite bundle files.");
}

await copyFile(join(assetsDir, scriptFile), join(assetsDir, "app.js"));
await copyFile(join(assetsDir, styleFile), join(assetsDir, "app.css"));

const indexPath = join("dist", "index.html");
const downloadIndexPath = join("dist", "download-assets", "index.html");
const stableIndex = (await readFile(indexPath, "utf8"))
  .replace(`/download-assets/assets/${scriptFile}`, "/download-assets/assets/app.js")
  .replace(`/download-assets/assets/${styleFile}`, "/download-assets/assets/app.css");

await writeFile(indexPath, stableIndex);
await writeFile(downloadIndexPath, stableIndex);

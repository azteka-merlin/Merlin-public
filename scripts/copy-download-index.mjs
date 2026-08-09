import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const target = join("dist", "download-assets", "index.html");
await mkdir(dirname(target), { recursive: true });
await copyFile(join("dist", "index.html"), target);

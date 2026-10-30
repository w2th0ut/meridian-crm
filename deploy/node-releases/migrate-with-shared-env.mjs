// Load the release's shared .env with the app parser, then run migrate-mysql.
// Does not print env values and does not write shared/.env.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
if (!root || !existsSync(`${root}/backend/dist/runtime-env.js`) || !existsSync(`${root}/backend/dist/migrate-mysql.js`)) {
  console.error("release is missing backend/dist runtime files");
  process.exit(1);
}
if (!existsSync(`${root}/.env`)) {
  console.error("release .env link is missing; refusing to migrate");
  process.exit(1);
}

process.chdir(root);
const runtime = await import(pathToFileURL(`${root}/backend/dist/runtime-env.js`).href);
if (typeof runtime.loadLocalEnv !== "function") {
  console.error("runtime-env.js does not export loadLocalEnv");
  process.exit(1);
}
runtime.loadLocalEnv();
if (!process.env.DATABASE_URL && !process.env.MYSQL_URL) {
  console.error("shared env has no DATABASE_URL or MYSQL_URL; refusing to migrate");
  process.exit(1);
}

const child = spawn(process.execPath, [`${root}/backend/dist/migrate-mysql.js`], {
  cwd: root,
  env: process.env,
  stdio: "inherit"
});
child.on("error", () => {
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code === null ? 1 : code);
});

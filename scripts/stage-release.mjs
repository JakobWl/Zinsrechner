import { readdir, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const source = "src-tauri/target/release/bundle/nsis";
const installers = (await readdir(source)).filter(name => name.endsWith(".exe"));
if (installers.length !== 1) throw new Error("Expected exactly one NSIS installer.");
const destination = `release/${version}`;
await mkdir(destination, { recursive: true });
const name = `Zinsrechner-Setup-${version}-x64.exe`;
await copyFile(`${source}/${installers[0]}`, `${destination}/${name}`);
let signature;
try { signature = await readFile(`${source}/${installers[0]}.sig`, "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (signature) {
  await writeFile(`${destination}/${name}.sig`, signature);
  await writeFile(`${destination}/latest.json`, JSON.stringify({
    version, pub_date: new Date().toISOString(),
    platforms: { "windows-x86_64": { signature: signature.trim(), url: `https://github.com/JakobWl/Zinsrechner/releases/download/v${version}/${name}` } },
  }, null, 2));
}
console.log(`Staged ${destination}/${name}`);

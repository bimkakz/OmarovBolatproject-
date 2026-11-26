const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const copies = [
  ["target/idl/vault.json", "app/src/idl/vault.json"],
  ["target/types/vault.ts", "app/src/idl/vault.ts"],
];

for (const [source, destination] of copies) {
  const sourcePath = path.join(root, source);
  const destinationPath = path.join(root, destination);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Не найден файл ${source}. Сначала соберите Anchor IDL.`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  console.log(`${source} -> ${destination}`);
}

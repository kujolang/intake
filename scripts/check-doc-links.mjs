import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export async function findBrokenLocalLinks(projectRoot, files = null) {
  const root = resolve(projectRoot);
  const markdownFiles = files || await markdownFilesFor(root);
  const broken = [];
  for (const file of markdownFiles) {
    const absoluteFile = resolve(root, file);
    const lines = (await readFile(absoluteFile, "utf8")).split(/\r?\n/);
    let fenced = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = normalizeHref(match[1]);
        if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) continue;
        const pathOnly = href.split(/[?#]/, 1)[0];
        if (!pathOnly) continue;
        let decoded;
        try {
          decoded = decodeURIComponent(pathOnly);
        } catch {
          broken.push({ file, line: index + 1, href, reason: "invalid URL encoding" });
          continue;
        }
        const target = resolve(dirname(absoluteFile), decoded);
        if (target !== root && !target.startsWith(`${root}${sep}`)) {
          broken.push({ file, line: index + 1, href, reason: "target is outside the repository" });
          continue;
        }
        try {
          await lstat(target);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          broken.push({ file, line: index + 1, href, reason: "target does not exist" });
        }
      }
    }
  }
  return broken;
}

async function markdownFilesFor(root) {
  const files = [];
  for (const name of ["README.md", "CONTRIBUTING.md", "CHANGELOG.md"]) {
    try {
      await lstat(resolve(root, name));
      files.push(name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await walkMarkdown(root, resolve(root, "docs"), files);
  return files.sort();
}

async function walkMarkdown(root, dir, files) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walkMarkdown(root, path, files);
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(relative(root, path));
  }
}

function normalizeHref(raw) {
  let value = String(raw || "").trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  const title = value.match(/^(\S+)\s+["'][^"']*["']$/);
  return title ? title[1] : value;
}

async function main() {
  const broken = await findBrokenLocalLinks(process.cwd());
  const receipt = { ok: broken.length === 0, markdown_links_checked: true, broken };
  console.log(JSON.stringify(receipt, null, 2));
  if (broken.length) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

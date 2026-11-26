import { lstat, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export async function rawStorePath(root, relPath, { createParents = false } = {}) {
  const rootPath = resolve(root);
  const rawRoot = join(rootPath, "raw");
  const target = resolve(rootPath, String(relPath || ""));
  if (!target.startsWith(`${rawRoot}${sep}`)) return null;

  let directory = rootPath;
  for (const part of relative(rootPath, dirname(target)).split(sep)) {
    directory = join(directory, part);
    let info;
    try { info = await lstat(directory); }
    catch (error) {
      if (error.code !== "ENOENT" || !createParents) throw error;
      if (directory === rawRoot) await mkdir(rootPath, { recursive: true, mode: 0o700 });
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (createError) { if (createError.code !== "EEXIST") throw createError; }
      info = await lstat(directory);
    }
    if (!info.isDirectory()) return null;
  }
  return target;
}

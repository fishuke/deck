import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface FileEntry { name: string; path: string; directory: boolean }
export interface LocalFile { text: string; modified: number }

async function withinRoot(root: string, relative = ""): Promise<string> {
  const expanded = root.startsWith("~") ? path.join(os.homedir(), root.slice(1)) : root;
  const canonicalRoot = await fs.realpath(expanded);
  const target = await fs.realpath(path.resolve(canonicalRoot, relative));
  const inside = path.relative(canonicalRoot, target);
  if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) throw new Error("This path is outside the open project.");
  return target;
}

export async function listFiles(root: string, directory = ""): Promise<FileEntry[]> {
  const target = await withinRoot(root, directory);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => ({ name: entry.name, path: path.posix.join(directory, entry.name), directory: entry.isDirectory() }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

export async function readLocalFile(root: string, relative: string): Promise<LocalFile> {
  const target = await withinRoot(root, relative);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error("Preview supports text files up to 1 MB.");
  const text = await fs.readFile(target, "utf8");
  if (text.includes("\0")) throw new Error("This is a binary file.");
  return { text, modified: stat.mtimeMs };
}

export async function saveLocalFile(root: string, relative: string, contents: LocalFile): Promise<LocalFile> {
  const target = await withinRoot(root, relative);
  const stat = await fs.stat(target);
  if (stat.mtimeMs !== contents.modified) throw new Error("The file changed on disk. Reload it before saving.");
  await fs.writeFile(target, contents.text, "utf8");
  return { text: contents.text, modified: (await fs.stat(target)).mtimeMs };
}

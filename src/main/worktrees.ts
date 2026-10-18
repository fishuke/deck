import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { listRepos } from "./providers.js";
import { isWindows } from "../shared/platform.js";

const exec = promisify(execFile);

// Worktrees agents leave behind. Each one installs its own dependencies, so a
// forgotten worktree costs a gigabyte or two and they stack up silently.
// Closing a tab is the moment to offer the cleanup; the sweep catches the ones
// whose tab was closed long before deck asked.

export interface Worktree {
  /** Absolute path of the worktree's root. */
  path: string;
  /** Repository directory name, for display. */
  repo: string;
  /** The main checkout this worktree is linked to. */
  repoRoot: string;
  /** Empty on a detached HEAD, where there is no branch to delete. */
  branch: string;
  /** Uncommitted files: staged, unstaged and untracked together. */
  dirtyFiles: number;
}

export interface LinkedWorktree extends Worktree {
  /** Bytes on disk, dependencies included. */
  size: number;
  /** Every commit here is already on the remote's default branch. */
  merged: boolean;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

/** The linked worktree a directory sits in, or null in a main checkout. */
export async function worktreeAt(rawCwd: string): Promise<Worktree | null> {
  const cwd = expandHome(rawCwd);
  try {
    // In a main checkout these two are the same directory; a linked worktree
    // has its own git dir under the shared one, which is what marks it.
    const [gitDir, commonDir] = (
      await git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])
    ).split("\n");
    if (!gitDir || !commonDir || path.resolve(gitDir) === path.resolve(commonDir)) return null;

    // git reports forward slashes even on Windows; resolve to native paths.
    const common = path.resolve(commonDir);
    const repoRoot = path.basename(common) === ".git" ? path.dirname(common) : common;
    const [root, branch, status] = await Promise.all([
      git(cwd, ["rev-parse", "--show-toplevel"]),
      git(cwd, ["branch", "--show-current"]),
      git(cwd, ["status", "--porcelain"]),
    ]);
    return {
      path: path.resolve(root),
      repo: path.basename(repoRoot),
      repoRoot,
      branch,
      dirtyFiles: status.split("\n").filter(Boolean).length,
    };
  } catch {
    return null;
  }
}

export interface RemoveResult {
  removed: boolean;
  error?: string;
}

/** Removes a linked worktree, and its branch when asked. Forced: the caller
 *  has already been shown the uncommitted file count. */
export async function removeWorktree(worktreePath: string, deleteBranch = false): Promise<RemoveResult> {
  const worktree = await worktreeAt(worktreePath);
  if (!worktree) return { removed: false, error: "not a linked worktree" };
  try {
    await git(worktree.repoRoot, ["worktree", "remove", "--force", worktree.path]);
  } catch (err) {
    return { removed: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (deleteBranch && worktree.branch) {
    // The worktree is gone either way, so a branch that refuses to delete is
    // reported rather than treated as a failed removal.
    try {
      await git(worktree.repoRoot, ["branch", "-D", worktree.branch]);
    } catch (err) {
      return { removed: true, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { removed: true };
}

/** Drops registrations for worktrees whose directory is already gone. */
export async function pruneWorktrees(): Promise<void> {
  await Promise.all(
    listRepos().map((repo) => git(repo.path, ["worktree", "prune"]).catch(() => "")),
  );
}

async function directorySize(dir: string): Promise<number> {
  // Windows has no du; adding up the files is slower but gets there.
  if (isWindows) {
    try {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
      const sizes = await Promise.all(entries.filter((entry) => entry.isFile())
        .map((entry) => fs.stat(path.join(entry.parentPath, entry.name)).then((stat) => stat.size, () => 0)));
      return sizes.reduce((total, size) => total + size, 0);
    } catch {
      return 0;
    }
  }
  try {
    const { stdout } = await exec("du", ["-sk", dir], { maxBuffer: 1024 * 1024 });
    return Number(stdout.split("\t")[0]) * 1024 || 0;
  } catch {
    return 0;
  }
}

/** `origin/HEAD` when the remote publishes it, else the usual suspects. */
async function defaultBranch(repoRoot: string): Promise<string | null> {
  const published = await git(repoRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "");
  if (published) return published;
  for (const candidate of ["origin/main", "origin/master"]) {
    if (await git(repoRoot, ["rev-parse", "--verify", candidate]).then(() => true, () => false)) return candidate;
  }
  return null;
}

async function repoWorktrees(repoRoot: string): Promise<Worktree[]> {
  const listing = await git(repoRoot, ["worktree", "list", "--porcelain"]).catch(() => "");
  if (!listing) return [];
  const paths = listing
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  const worktrees = await Promise.all(paths.map((p) => worktreeAt(p)));
  // The listing includes the main checkout, which worktreeAt reports as null:
  // it is never ours to remove.
  return worktrees.filter((worktree): worktree is Worktree => worktree !== null);
}

const SWEEP_TTL_MS = 30_000;
let sweep: { expires: number; result: Promise<LinkedWorktree[]> } | undefined;

/** Every linked worktree under the repo roots, biggest first. Sizes come from
 *  `du`, so the result is cached briefly rather than recomputed per render. */
export function listLinkedWorktrees(): Promise<LinkedWorktree[]> {
  if (sweep && sweep.expires > Date.now()) return sweep.result;
  const result = pruneWorktrees()
    .then(() => Promise.all(listRepos().map(async (repo) => {
      const worktrees = await repoWorktrees(repo.path);
      if (!worktrees.length) return [];
      const main = await defaultBranch(repo.path);
      return Promise.all(worktrees.map(async (worktree): Promise<LinkedWorktree> => ({
        ...worktree,
        size: await directorySize(worktree.path),
        merged: main
          ? await git(worktree.path, ["merge-base", "--is-ancestor", "HEAD", main]).then(() => true, () => false)
          : false,
      })));
    })))
    .then((perRepo) => perRepo.flat().sort((a, b) => b.size - a.size))
    .catch(() => []);
  sweep = { expires: Date.now() + SWEEP_TTL_MS, result };
  return result;
}

/** Forgets the cached sweep so the next read reflects a removal. */
export function invalidateSweep(): void {
  sweep = undefined;
}

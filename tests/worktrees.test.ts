import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const repos: { name: string; path: string }[] = [];
vi.mock("../src/main/providers.js", () => ({ listRepos: () => repos }));

const {
  invalidateSweep,
  listLinkedWorktrees,
  pruneWorktrees,
  removeWorktree,
  worktreeAt,
} = await import("../src/main/worktrees.js");

let root: string;
let repo: string;
let tree: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

beforeAll(() => {
  // Temp dirs on macOS live behind a symlink and on Windows behind an 8.3 short
  // name, and git always reports the real path, so the fixture resolves it once.
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deck-worktrees-")));
  repo = path.join(root, "api");
  tree = path.join(root, "api-feature");
  fs.mkdirSync(repo);
  git(repo, "init", "--initial-branch=main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "initial");
  // There is no remote, so the branch the sweep measures against is faked.
  git(repo, "update-ref", "refs/remotes/origin/main", git(repo, "rev-parse", "HEAD"));
  git(repo, "worktree", "add", "-b", "feature", tree);
  repos.push({ name: "api", path: repo });
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("worktreeAt", () => {
  it("reports the linked worktree a directory sits in", async () => {
    const worktree = await worktreeAt(tree);
    expect(worktree).toMatchObject({ path: tree, repo: "api", repoRoot: repo, branch: "feature", dirtyFiles: 0 });
  });

  it("returns null in the main checkout, which is never ours to remove", async () => {
    await expect(worktreeAt(repo)).resolves.toBeNull();
  });

  it("returns null outside a repository", async () => {
    await expect(worktreeAt(root)).resolves.toBeNull();
  });

  it("counts uncommitted files, staged, unstaged and untracked alike", async () => {
    fs.writeFileSync(path.join(tree, "README.md"), "changed\n");
    fs.writeFileSync(path.join(tree, "scratch.txt"), "new\n");
    await expect(worktreeAt(tree)).resolves.toMatchObject({ dirtyFiles: 2 });
    git(tree, "checkout", "--", "README.md");
    fs.rmSync(path.join(tree, "scratch.txt"));
  });
});

describe("listLinkedWorktrees", () => {
  it("lists the linked worktree with its size, and marks it merged", async () => {
    invalidateSweep();
    const [worktree, ...rest] = await listLinkedWorktrees();
    expect(rest).toEqual([]);
    expect(worktree).toMatchObject({ path: tree, repo: "api", branch: "feature", merged: true });
    expect(worktree.size).toBeGreaterThan(0);
  });

  it("marks a worktree with commits of its own as not merged", async () => {
    fs.writeFileSync(path.join(tree, "feature.txt"), "work\n");
    git(tree, "add", "-A");
    git(tree, "commit", "-m", "feature work");
    invalidateSweep();
    const [worktree] = await listLinkedWorktrees();
    expect(worktree.merged).toBe(false);
  });

  it("caches, so repeated reads do not re-measure every directory", async () => {
    invalidateSweep();
    expect(await listLinkedWorktrees()).toBe(await listLinkedWorktrees());
  });
});

describe("removeWorktree", () => {
  it("refuses a path that is not a linked worktree", async () => {
    await expect(removeWorktree(repo)).resolves.toMatchObject({ removed: false });
  });

  it("removes the worktree and, when asked, its branch", async () => {
    await expect(removeWorktree(tree, true)).resolves.toEqual({ removed: true });
    expect(fs.existsSync(tree)).toBe(false);
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
    expect(git(repo, "branch", "--format=%(refname:short)")).toBe("main");
  });

  it("drops registrations left by a worktree deleted behind git's back", async () => {
    const orphan = path.join(root, "api-orphan");
    git(repo, "worktree", "add", "-b", "orphan", orphan);
    fs.rmSync(orphan, { recursive: true, force: true });
    expect(git(repo, "worktree", "list")).toContain("prunable");
    await pruneWorktrees();
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
  });
});

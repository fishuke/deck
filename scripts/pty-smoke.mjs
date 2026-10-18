import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import assert from "node:assert/strict";
import electron from "electron";

const directory = await mkdtemp(path.join(os.tmpdir(), "deck-pty-"));
const windows = process.platform === "win32";
const socketPath = windows ? `\\\\.\\pipe\\deck-pty-smoke-${process.pid}` : path.join(directory, "host.sock");
const host = spawn(electron, ["out/main/ptyHost.js", socketPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
host.stderr.pipe(process.stderr);
let socket;
const timeout = setTimeout(() => { console.error("PTY smoke timed out"); host.kill(); process.exitCode = 1; socket?.destroy(); }, 10000);
try {
  await Promise.race([once(host.stdout, "data"), once(host, "exit").then(() => { throw Error("PTY host exited before listening"); })]);
  socket = net.createConnection(socketPath);
  await once(socket, "connect");
  const messages = [];
  let buffered = "";
  socket.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      messages.push(JSON.parse(buffered.slice(0, newline)));
      buffered = buffered.slice(newline + 1);
    }
  });
  const send = (message) => socket.write(JSON.stringify(message) + "\n");
  const receive = async (predicate) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      if (host.exitCode !== null) throw Error("PTY host exited");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error(`Missing PTY reply; queued messages: ${JSON.stringify(messages)}`);
  };
  // A deterministic shell process exercises PTY creation, metadata, input,
  // streaming and replay without starting an agent or reading user profiles.
  const echo = windows
    ? { shell: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-Command", 'Write-Output "ready:$env:DECK_TERM_ID"; while ($true) { [Console]::ReadLine() }'], env: { ...process.env, TERM: "xterm-256color" } }
    : { shell: "/bin/sh", args: ["-c", 'printf "ready:%s\\n" "$DECK_TERM_ID"; exec /bin/cat'], env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" } };
  send({ type: "create", req: 1, spawn: { ...echo, cwd: directory, agent: "codex", sessionId: "codex:fixture" } });
  const { meta } = await receive((message) => message.type === "created");
  assert.equal(meta.agent, "codex");
  assert.equal(meta.sessionId, "codex:fixture");
  await receive((message) => message.type === "data" && message.data.includes(`ready:${meta.id}`));
  send({ type: "input", id: meta.id, data: windows ? "roundtrip\r" : "roundtrip\n" });
  await receive((message) => message.type === "data" && message.data.includes("roundtrip"));
  send({ type: "attach", req: 2, id: meta.id });
  const replay = await receive((message) => message.type === "attached");
  assert.ok(replay.buffer.includes(`ready:${meta.id}`));
  assert.ok(replay.buffer.includes("roundtrip"));
  // cat took the terminal over from sh, and the host names its whole command
  // line. ConPTY reports no foreground process, so Windows has none to name.
  if (!windows) await receive((message) => message.type === "foreground" && message.meta.id === meta.id && message.meta.foregroundCommand === "/bin/cat");
  send({ type: "list", req: 3 });
  const restored = (await receive((message) => message.type === "list")).terms;
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0], { ...meta, foregroundProcess: restored[0].foregroundProcess, ...(windows ? {} : { foregroundCommand: "/bin/cat" }) });
  send({ type: "kill", id: meta.id });
  await receive((message) => message.type === "exit");
  if (windows) {
    // ConPTY reports no foreground process, so there is no idle Codex to detect.
    console.log("PTY smoke passed: PowerShell over a named pipe, provider metadata, input/output, replay, restore list and termination.");
  } else {
    // A native fixture named codex stays idle without any hooks or user prompt.
    const fixture = path.join(directory, "codex");
    await copyFile("/bin/cat", fixture);
    if (process.platform === "darwin") execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", fixture], { stdio: "pipe" });
    send({ type: "create", req: 4, spawn: { shell: "/bin/sh", args: ["-i"], cwd: directory, env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" } } });
    const shell = (await receive((message) => message.type === "created")).meta;
    assert.equal(shell.agent, undefined);
    send({ type: "input", id: shell.id, data: "./codex\r" });
    await receive((message) => message.type === "foreground" && message.meta.id === shell.id && message.meta.foregroundProcess === "codex");
    send({ type: "list", req: 5 });
    assert.equal((await receive((message) => message.type === "list")).terms[0].foregroundProcess, "codex");
    send({ type: "input", id: shell.id, data: "\x03" });
    await receive((message) => message.type === "foreground" && message.meta.id === shell.id && message.meta.foregroundProcess !== "codex");
    send({ type: "kill", id: shell.id });
    await receive((message) => message.type === "exit" && message.id === shell.id);
    console.log("PTY smoke passed: native shell, provider metadata, input/output, replay, restore list, idle Codex detection and termination.");
  }
} finally {
  clearTimeout(timeout);
  socket?.destroy();
  host.kill();
  // Windows keeps the directory locked briefly after the host exits.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

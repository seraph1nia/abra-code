// The OpenCode host uses Bun, which cannot run fs-ext's NAN error path. This
// small Node process owns the descriptor until its parent closes stdin or dies.
const { openSync } = require("node:fs");
const { flockSync } = require("fs-ext");

const fd = openSync(process.argv[2], "a", 0o600);
const flags = process.argv[3] === "shared" ? "shnb" : "exnb";
const waitMs = Number(process.argv[4]) * 1000;
const started = performance.now();
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();

function acquire() {
  try {
    flockSync(fd, flags);
  } catch (error) {
    if (error.code !== "EAGAIN" && error.code !== "EWOULDBLOCK") throw error;
    const remaining = waitMs - (performance.now() - started);
    if (remaining <= 0) process.exit(75);
    setTimeout(acquire, Math.min(25, remaining));
    return;
  }
  process.stdout.write("locked\n");
}
acquire();

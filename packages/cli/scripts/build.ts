import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const binDir = "bin";
const bundlePath = join(binDir, "opendock");

mkdirSync(binDir, { recursive: true });

const build = spawnSync(
  "bun",
  ["build", "src/cli.ts", "--outfile", bundlePath, "--target", "bun"],
  {
    stdio: "inherit",
  },
);
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

chmodSync(bundlePath, 0o755);

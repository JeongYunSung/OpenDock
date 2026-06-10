import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const binDir = "bin";
const bundlePath = join(binDir, "opendock.js");
const wrapperPath = join(binDir, "opendock");

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

writeFileSync(
  wrapperPath,
  `#!/bin/sh
set -eu
bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec bun "$bin_dir/opendock.js" "$@"
`,
);

chmodSync(wrapperPath, 0o755);
chmodSync(bundlePath, 0o755);

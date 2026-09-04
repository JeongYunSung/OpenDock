import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const repoRoot = join(process.cwd(), "../..");
const workflowPath = join(repoRoot, ".github", "workflows", "build-desktop.yml");

interface WorkflowStep {
  env?: Record<string, string>;
  name?: string;
  run?: string;
}

interface WorkflowJob {
  if?: string;
  needs?: string[];
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>;
}

function readWorkflow(): Workflow {
  return YAML.parse(readFileSync(workflowPath, "utf8")) as Workflow;
}

function githubExpression(expression: string): string {
  return `$${expression}`;
}

describe("Desktop release workflow", () => {
  it.skipIf(process.platform === "win32")(
    "reads source release notes without changing their contents on rerun",
    () => {
      const publish = readWorkflow().jobs?.["publish-updater-manifest"];
      const upload = publish?.steps?.find((step) => step.name === "Upload latest.json");
      const script = upload?.run?.split("release_flags=()")[0];
      expect(script).toContain("gh release view");
      expect(script).not.toContain("$RELEASE_BODY");
      if (!script) throw new Error("Missing release note read script");
      const directory = mkdtempSync(join(tmpdir(), "opendock-release-notes-"));
      try {
        const notes = join(directory, "notes.md");
        writeFileSync(
          join(directory, "gh"),
          `#!/bin/sh
if [ "$2" = "view" ]; then cat "$TEST_NOTES"; exit 0; fi
exit 1
`,
          { mode: 0o755 },
        );
        for (const initial of [
          "",
          "Existing release notes\n\n- Fixed a bug.\n",
          "Release notes with no trailing newline",
        ]) {
          writeFileSync(notes, initial);
          const run = () =>
            execFileSync(
              "bash",
              [
                "-c",
                `${script.replaceAll(
                  githubExpression("{{ github.repository }}"),
                  "JeongYunSung/OpenDock",
                )}\ncat "$notes_file"`,
              ],
              {
                encoding: "utf8",
                env: {
                  PATH: `${directory}:${process.env.PATH}`,
                  TMPDIR: directory,
                  TEST_NOTES: notes,
                  RELEASE_TAG: "v1.0.0",
                },
              },
            );
          expect(run()).toBe(initial);
          expect(run()).toBe(initial);
          expect(readFileSync(notes, "utf8")).toBe(initial);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("cleans temporary Actions artifacts after release assets are published", () => {
    const cleanup = readWorkflow().jobs?.["cleanup-temporary-artifacts"];

    expect(cleanup?.needs).toEqual(["build", "publish-updater-manifest"]);
    expect(cleanup?.if).toBe(githubExpression("{{ always() && github.event_name == 'release' }}"));
    expect(cleanup?.permissions).toEqual({
      actions: "write",
      contents: "read",
    });

    const deleteStep = cleanup?.steps?.find((step) => step.name === "Delete Actions artifacts");

    expect(deleteStep?.env?.GH_TOKEN).toBe(githubExpression("{{ github.token }}"));
    expect(deleteStep?.run).toContain("/actions/artifacts?per_page=100");
    expect(deleteStep?.run).toContain("gh api --method DELETE");
    expect(deleteStep?.run).toContain("No temporary workflow artifacts to delete.");
  });
});

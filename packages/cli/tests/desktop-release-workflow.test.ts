import { readFileSync } from "node:fs";
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

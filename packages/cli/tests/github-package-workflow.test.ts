import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const repoRoot = join(process.cwd(), "../..");
const workflowPath = join(repoRoot, ".github", "workflows", "publish-github-package.yml");

interface WorkflowStep {
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  "working-directory"?: string;
}

interface Workflow {
  concurrency?: {
    group?: string;
    "cancel-in-progress"?: boolean;
  };
  jobs?: {
    publish?: {
      steps?: WorkflowStep[];
    };
  };
}

function readWorkflow(): Workflow {
  return YAML.parse(readFileSync(workflowPath, "utf8")) as Workflow;
}

describe("GitHub package publish workflow", () => {
  it("serializes publishes for the same ref", () => {
    const workflow = readWorkflow();

    expect(workflow.concurrency).toEqual({
      group: `github-package-\${{ github.ref }}`,
      "cancel-in-progress": false,
    });
  });

  it("skips publishing when the package version already exists", () => {
    const steps = readWorkflow().jobs?.publish?.steps ?? [];
    const checkIndex = steps.findIndex((step) => step.id === "package-version");
    const publishIndex = steps.findIndex((step) => step.name === "Publish");

    expect(checkIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(checkIndex);

    const checkStep = steps[checkIndex];
    const publishStep = steps[publishIndex];

    expect(checkStep?.name).toBe("Check existing package version");
    expect(checkStep?.["working-directory"]).toBe("dist/publish/github");
    expect(checkStep?.run).toContain("npm view");
    expect(checkStep?.run).toContain("exists=true");
    expect(checkStep?.run).toContain("E404|404 Not Found");
    expect(publishStep?.if).toBe("steps.package-version.outputs.exists != 'true'");
  });
});

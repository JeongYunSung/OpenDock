import { dockToolsDir, projectBinDir } from "../runtime/project-layout.js";
import { ProjectDirectoryRollback } from "./workdir-rollback.js";

export class TaskOutputRollback {
  private readonly directories: ProjectDirectoryRollback[];
  private state: "idle" | "prepared" | "rolled-back" | "committed" = "idle";

  constructor(projectDir: string, dockId: string) {
    this.directories = [
      new ProjectDirectoryRollback(
        projectDir,
        projectBinDir(projectDir),
        "project command shim directory",
        "bin",
      ),
      new ProjectDirectoryRollback(
        projectDir,
        dockToolsDir(projectDir, dockId),
        "dock tool directory",
        "tools",
      ),
    ];
  }

  prepare(): void {
    if (this.state !== "idle") throw new Error("task output rollback is already prepared");
    const prepared: ProjectDirectoryRollback[] = [];
    try {
      for (const directory of this.directories) {
        directory.prepare();
        prepared.push(directory);
      }
      this.state = "prepared";
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const directory of prepared.reverse()) {
        try {
          directory.rollback();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      this.state = "rolled-back";
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "task output backup failed and previous outputs could not be restored",
        );
      }
      throw error;
    }
  }

  rollback(): void {
    if (this.state !== "prepared") return;
    const rollbackErrors: unknown[] = [];
    for (const directory of [...this.directories].reverse()) {
      try {
        directory.rollback();
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(rollbackErrors, "task output rollback was incomplete");
    }
    this.state = "rolled-back";
  }

  commit(): void {
    if (this.state !== "prepared") return;
    this.state = "committed";
    for (const directory of [...this.directories].reverse()) {
      directory.commit();
    }
  }
}

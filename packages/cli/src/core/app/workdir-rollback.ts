import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { assertRealDirectoryPath, pruneEmptyDirectoryChain } from "../files/path-utils.js";

export class ProjectDirectoryRollback {
  private backupPath: string | undefined;
  private backupRoot: string | undefined;
  private prepared = false;

  constructor(
    private readonly projectDir: string,
    private readonly directory: string,
    private readonly label: string,
    private readonly backupPrefix: string,
  ) {}

  prepare(): void {
    if (this.prepared) throw new Error(`${this.label} rollback is already prepared`);
    this.prepared = true;
    this.assertDirectoryParent();
    const stat = lstatIfPresent(this.directory);
    if (!stat) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`${this.label} must be a real directory: ${this.directory}`);
    }

    const stateRoot = join(this.projectDir, ".opendock");
    assertRealDirectoryPath(this.projectDir, ".opendock", `${this.label} backup root`);
    const backupParent = join(stateRoot, "update-backups");
    mkdirSync(backupParent, { recursive: true });
    assertRealDirectoryPath(
      this.projectDir,
      relative(this.projectDir, backupParent),
      `${this.label} backup root`,
    );
    this.backupRoot = mkdtempSync(join(backupParent, `${this.backupPrefix}-`));
    this.backupPath = join(this.backupRoot, "content");
    this.assertDirectoryParent();
    renameSync(this.directory, this.backupPath);
    try {
      copyDirectory(this.backupPath, this.directory);
    } catch (error) {
      this.assertDirectoryParent();
      rmSync(this.directory, { force: true, recursive: true });
      this.assertDirectoryParent();
      renameSync(this.backupPath, this.directory);
      this.dispose();
      throw error;
    }
  }

  rollback(): void {
    if (!this.prepared) return;
    this.assertDirectoryParent();
    rmSync(this.directory, { force: true, recursive: true });
    if (this.backupPath && existsSync(this.backupPath)) {
      mkdirSync(dirname(this.directory), { recursive: true });
      this.assertDirectoryParent();
      renameSync(this.backupPath, this.directory);
    }
    this.dispose();
  }

  commit(): void {
    this.dispose();
  }

  private dispose(): void {
    if (!this.backupRoot) return;
    const backupRoot = this.backupRoot;
    assertRealDirectoryPath(
      this.projectDir,
      relative(this.projectDir, dirname(backupRoot)),
      `${this.label} backup parent`,
    );
    this.backupPath = undefined;
    this.backupRoot = undefined;
    rmSync(backupRoot, { force: true, recursive: true });
    pruneEmptyDirectoryChain(this.projectDir, relative(this.projectDir, backupRoot));
  }

  private assertDirectoryParent(): void {
    assertRealDirectoryPath(
      this.projectDir,
      relative(this.projectDir, dirname(this.directory)).replaceAll("\\", "/"),
      `${this.label} parent`,
    );
  }
}

export class WorkdirRollback extends ProjectDirectoryRollback {
  constructor(projectDir: string, workdir: string) {
    super(projectDir, workdir, "dock workdir", "workdir");
  }
}

function copyDirectory(source: string, target: string): void {
  mkdirSync(target);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourcePath), targetPath);
      continue;
    }
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`dock workdir can contain only regular files and directories: ${sourcePath}`);
    }
    copyFileSync(sourcePath, targetPath, constants.COPYFILE_FICLONE);
  }
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

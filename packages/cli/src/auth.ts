import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "./paths.js";

export class TokenStore {
  readonly root: string;

  constructor(root = dataRoot()) {
    this.root = root;
  }

  async saveToken(token: string): Promise<void> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await chmod(this.root, 0o700);
    }
    const path = this.tokenPath();
    const tempPath = join(this.root, `.auth-token.${process.pid}.${randomUUID()}.tmp`);
    writeFileSync(tempPath, token.trim(), { mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(tempPath, 0o600);
    }
    renameSync(tempPath, path);
    if (process.platform !== "win32") {
      await chmod(path, 0o600);
    }
  }

  loadToken(): string | undefined {
    const path = this.tokenPath();
    if (!existsSync(path)) {
      return undefined;
    }
    const token = readFileSync(path, "utf8").trim();
    return token === "" ? undefined : token;
  }

  clearToken(): void {
    const path = this.tokenPath();
    if (existsSync(path)) {
      rmSync(path);
    }
  }

  tokenPath(): string {
    return join(this.root, "auth-token");
  }
}

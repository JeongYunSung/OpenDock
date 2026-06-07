import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "./paths.js";

export class TokenStore {
  readonly root: string;

  constructor(root = dataRoot()) {
    this.root = root;
  }

  async saveToken(token: string): Promise<void> {
    mkdirSync(this.root, { recursive: true });
    const path = this.tokenPath();
    writeFileSync(path, token.trim());
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

  tokenPath(): string {
    return join(this.root, "auth-token");
  }
}

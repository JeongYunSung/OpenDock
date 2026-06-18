import type { Command } from "commander";
import { TokenStore } from "./auth.js";
import { performBrowserLogin, selectAuthProvider } from "./browser-auth.js";
import { recordCommandFailure, recordCommandLog } from "./cli-command-log.js";
import { parseAuthProvider } from "./cli-options.js";
import { OpenDockRegistryClient, RegistryRequestError } from "./registry.js";
import { terminalStyle } from "./terminal-style.js";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Authenticate with OpenDock Registry.");
  auth
    .command("login")
    .description("Log in to OpenDock Registry.")
    .option("--token <token>", "Existing CLI token to store without opening a browser")
    .option("--provider <provider>", "Browser login provider: google or github")
    .action(async (options: { token?: string; provider?: string }) => {
      try {
        const tokenStore = new TokenStore();
        if (options.token) {
          await tokenStore.saveToken(options.token);
          console.log(terminalStyle.success("Logged in to OpenDock Registry."));
          recordCommandLog(process.cwd(), "auth login", "Success", "stored provided auth token");
          return;
        }
        const provider =
          options.provider === undefined
            ? await selectAuthProvider()
            : parseAuthProvider(options.provider);
        await performBrowserLogin({ tokenStore, provider });
        recordCommandLog(
          process.cwd(),
          "auth login",
          "Success",
          `browser login completed with ${provider}`,
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "auth login", error);
        throw error;
      }
    });
  auth
    .command("status")
    .description("Show the current OpenDock Registry login.")
    .action(async () => {
      try {
        const token = new TokenStore().loadToken();
        if (!token) {
          console.log(terminalStyle.warning("Not logged in."));
          recordCommandLog(process.cwd(), "auth status", "Skipped", "not logged in");
          return;
        }
        const user = await new OpenDockRegistryClient().currentUser(token);
        console.log(`${terminalStyle.success("Logged in as")} ${terminalStyle.bold(user.email)}.`);
        recordCommandLog(process.cwd(), "auth status", "Success", `logged in as ${user.email}`);
      } catch (error) {
        recordCommandFailure(process.cwd(), "auth status", error);
        throw error;
      }
    });
  auth
    .command("logout")
    .description("Log out of OpenDock Registry on this machine.")
    .action(async () => {
      try {
        const tokenStore = new TokenStore();
        const token = tokenStore.loadToken();
        if (token) {
          try {
            await new OpenDockRegistryClient().logout(token);
          } catch (error) {
            if (!(error instanceof RegistryRequestError && error.status === 401)) {
              throw error;
            }
          }
        }
        tokenStore.clearToken();
        console.log(terminalStyle.success("Logged out of OpenDock Registry."));
        recordCommandLog(
          process.cwd(),
          "auth logout",
          token ? "Success" : "Skipped",
          token ? "logged out of registry" : "no local auth token to clear",
        );
      } catch (error) {
        recordCommandFailure(process.cwd(), "auth logout", error);
        throw error;
      }
    });
}

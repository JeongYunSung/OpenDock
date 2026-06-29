import type { InstalledDockUpdateCheck } from "./change-output.js";
import { errorMessage } from "./cli-errors.js";
import { resolveCliPlatform } from "./cli-options.js";
import type { InstalledDockRecord } from "./core/domain/state-store.js";
import { isOpenDockPlatform, type OpenDockPlatform } from "./platform.js";
import { type DockVersionResponse, OpenDockRegistryClient } from "./registry.js";
import { verifyReleaseSignature } from "./release-signature.js";

async function resolveLatestDockVersion(
  dockId: string,
  platform: OpenDockPlatform,
): Promise<DockVersionResponse> {
  const [owner, name, extra] = dockId.split("/");
  if (!owner || !name || extra !== undefined) {
    throw new Error(`invalid dock id in lock file: ${dockId}`);
  }
  const metadata = await new OpenDockRegistryClient().resolveDockVersion(
    owner,
    name,
    "latest",
    platform,
  );
  if (metadata.id !== dockId) {
    throw new Error(`registry returned dock id \`${metadata.id}\` for installed \`${dockId}\``);
  }
  if (!metadata.approved) {
    throw new Error(`dock \`${dockId}@latest\` is not approved by OpenDock Registry`);
  }
  if (metadata.platform !== undefined && metadata.platform !== platform) {
    throw new Error(
      `registry returned ${metadata.platform} artifact for requested platform \`${platform}\``,
    );
  }
  const releasePlatform = metadata.platform ?? platform;
  if (!isOpenDockPlatform(releasePlatform)) {
    throw new Error(`registry returned unsupported platform \`${releasePlatform}\``);
  }
  verifyReleaseSignature(
    {
      id: metadata.id,
      version: metadata.version,
      platform: releasePlatform,
      checksum: metadata.checksum,
    },
    metadata.signature,
  );
  return metadata;
}

export function lockedDockVersionSelector(dock: { requested?: string; version: string }): string {
  const requested = dock.requested?.trim();
  if (requested !== undefined && requested !== "" && requested !== "latest") {
    return requested;
  }
  return dock.version;
}

export async function checkInstalledDockUpdates(
  docks: InstalledDockRecord[],
  platformOverride: OpenDockPlatform | undefined,
): Promise<InstalledDockUpdateCheck[]> {
  return Promise.all(
    docks.map(async (dock) => {
      let platform: OpenDockPlatform | undefined;
      try {
        platform = platformOverride ?? resolveCliPlatform(dock.platform);
        const latest = await resolveLatestDockVersion(dock.id, platform);
        return {
          dock,
          latestVersion: latest.version,
          platform,
          updateAvailable: latest.version !== dock.version,
        };
      } catch (error) {
        return {
          dock,
          error: errorMessage(error),
          ...(platform === undefined ? {} : { platform }),
          updateAvailable: false,
        };
      }
    }),
  );
}

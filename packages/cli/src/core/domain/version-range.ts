export type VersionOperator = ">=" | ">" | "<=" | "<" | "=";

export interface VersionCondition {
  expected: string;
  operator: VersionOperator;
}

const versionPattern = /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/u;
const conditionPattern = /^(>=|>|<=|<|=)?(v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?)$/u;

export function parseVersionRange(range: string): VersionCondition[] | undefined {
  const normalized = range.trim();
  if (!normalized) {
    return undefined;
  }

  const conditions: VersionCondition[] = [];
  for (const condition of normalized.split(/\s+/u)) {
    const match = condition.match(conditionPattern);
    if (!match) {
      return undefined;
    }
    conditions.push({
      expected: match[2] ?? "",
      operator: (match[1] ?? "=") as VersionOperator,
    });
  }
  return conditions;
}

export function isValidVersionRange(range: string): boolean {
  return parseVersionRange(range) !== undefined;
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (const delta of leftVersion.map((value, index) => value - (rightVersion[index] ?? 0))) {
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(version: string): [number, number, number] {
  if (!versionPattern.test(version)) {
    throw new Error(`invalid version \`${version}\``);
  }
  const numeric = version.replace(/^v/u, "").split(/[-+]/u, 1)[0] ?? "";
  const parts = numeric.split(".");
  return [
    Number.parseInt(parts[0] ?? "0", 10),
    Number.parseInt(parts[1] ?? "0", 10),
    Number.parseInt(parts[2] ?? "0", 10),
  ];
}

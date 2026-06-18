export async function installRegistryFixtures(page) {
  await page.route("**/registry/v1/docks**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const registryPath = requestUrl.pathname.replace(/^\/registry/, "");
    const response = registryFixtureFor(registryPath, requestUrl.searchParams);
    if (!response) {
      await route.fallback();
      return;
    }
    await route.fulfill(response);
  });
}

function registryFixtureFor(path, searchParams) {
  if (path.endsWith("/logo")) {
    return {
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg==",
        "base64",
      ),
      contentType: "image/png",
    };
  }

  if (path === "/v1/docks") {
    const query = (searchParams.get("query") ?? "").trim().toLowerCase();
    const sort = searchParams.get("sort") ?? "downloads";
    const page = Number(searchParams.get("page") ?? "1");
    const limit = Number(searchParams.get("limit") ?? "12");
    const filtered = registryDockSummaries()
      .filter((dock) => {
        if (!query) return true;
        return [dock.id, dock.name, dock.summary, ...(dock.tags ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((left, right) => compareRegistryDocks(left, right, sort));
    const start = Math.max(0, (page - 1) * limit);
    return jsonResponse({ items: filtered.slice(start, start + limit), page, limit, total: filtered.length });
  }

  const versionsMatch = /^\/v1\/docks\/([^/]+)\/([^/]+)\/versions$/.exec(path);
  if (versionsMatch) {
    const id = `${versionsMatch[1]}/${versionsMatch[2]}`;
    const page = Number(searchParams.get("page") ?? "1");
    const limit = Number(searchParams.get("limit") ?? "6");
    const items = registryVersionFixtures(id);
    const start = Math.max(0, (page - 1) * limit);
    return jsonResponse({ id, items: items.slice(start, start + limit), page, limit, total: items.length });
  }

  const detailMatch = /^\/v1\/docks\/([^/]+)\/([^/]+)$/.exec(path);
  if (detailMatch) {
    const id = `${detailMatch[1]}/${detailMatch[2]}`;
    const summary = registryDockSummaries().find((dock) => dock.id === id);
    if (!summary) return jsonResponse({ message: `fixture dock ${id} not found` }, 404);
    return jsonResponse({
      ...summary,
      description: summary.summary,
      readmeMarkdown: registryReadmeFixture(id),
      links: {
        install: `opendock install ${id}@${summary.latestVersion}`,
        versions: `https://registry.opendock.app/v1/docks/${id}/versions`,
      },
    });
  }

  return null;
}

function registryDockSummaries() {
  return [
    registryDock(
      "backend-ultrawork",
      "Backend quality gate for API contracts, validation, authentication, migrations, logging, and service safety.",
      ["api", "backend", "harness", "security", "ultrawork"],
      31,
      12,
    ),
    registryDock(
      "designer-ai",
      "Design workspace setup with prompts, UX review notes, and reusable product design guidance.",
      ["design", "ux", "figma"],
      28,
      9,
    ),
    registryDock(
      "frontend-ai",
      "Frontend setup for UI implementation, responsive checks, accessibility, and review workflows.",
      ["frontend", "ui", "accessibility"],
      24,
      11,
    ),
    registryDock(
      "workspace-agent",
      "Shared agent instructions and conventions for AI-assisted project work.",
      ["ai-agent", "starter"],
      19,
      7,
    ),
    registryDock(
      "mcp-safe",
      "MCP safety notes and review checks for tool-enabled agent workspaces.",
      ["mcp", "security"],
      13,
      5,
    ),
    registryDock(
      "writer-ai",
      "Documentation writing and review setup for user-facing guides.",
      ["docs", "writing"],
      11,
      4,
    ),
  ];
}

function registryDock(name, summary, tags, downloads, stars) {
  return {
    id: `opendock/${name}`,
    owner: "opendock",
    name,
    displayName: name,
    summary,
    official: true,
    publisher: { nickname: "opendock", official: true },
    logo: {
      url: `https://registry.opendock.app/v1/docks/opendock/${name}/logo`,
      contentType: "image/png",
      sizeBytes: 68,
      storageBackend: "fixture",
    },
    platforms: ["macos", "windows"],
    latestVersion: "1.1.0",
    downloads,
    stars,
    updatedAt: "2026-06-17T06:02:50Z",
    tags,
  };
}

function registryReadmeFixture(id) {
  if (id === "opendock/backend-ultrawork") {
    return [
      "# Backend Ultrawork",
      "",
      "Backend quality gate for API contracts, validation, authentication, migrations, logging, and service safety.",
      "",
      "## What It Checks",
      "",
      "- Formatter, lint, test, and build must be available for backend services.",
      "- Request bodies must be validated before use.",
      "- Authenticated endpoints need explicit guards.",
      "- Hardcoded secrets and sensitive logging are blocked.",
      "- Database migrations should be dry-runnable and rollback-aware.",
      "- OpenAPI or schema documentation should not drift from routes.",
      "",
      "Use this dock when the workspace needs a focused backend quality gate.",
    ].join("\n");
  }

  return [
    `# ${id.split("/").at(-1)}`,
    "",
    "A reviewed OpenDock fixture used by desktop visual verification.",
    "",
    "## Included",
    "",
    "- Setup files",
    "- Review prompts",
    "- Doctor checks",
  ].join("\n");
}

function registryVersionFixtures(id) {
  return ["1.1.0", "1.0.0", "0.9.0"].map((version, index) => ({
    version,
    status: "approved",
    summary: `${id} ${version}`,
    updatedAt: `2026-06-${17 - index}T06:02:50Z`,
    platforms: [
      {
        version,
        platform: "macos",
        approved: true,
        status: "approved",
        checksum: `sha256:${version.replaceAll(".", "")}macos`,
        downloadCount: 3 - index,
        archive: { sizeBytes: 12000 + index },
      },
      {
        version,
        platform: "windows",
        approved: true,
        status: "approved",
        checksum: `sha256:${version.replaceAll(".", "")}windows`,
        downloadCount: 2 - index,
        archive: { sizeBytes: 13000 + index },
      },
    ],
  }));
}

function compareRegistryDocks(left, right, sort) {
  if (sort === "name") {
    if (left.name === "backend-ultrawork") return -1;
    if (right.name === "backend-ultrawork") return 1;
    return left.name.localeCompare(right.name);
  }
  if (sort === "stars") return right.stars - left.stars || left.name.localeCompare(right.name);
  if (sort === "updated") return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name);
  return right.downloads - left.downloads || left.name.localeCompare(right.name);
}

function jsonResponse(value, status = 200) {
  return { body: JSON.stringify(value), contentType: "application/json", status };
}

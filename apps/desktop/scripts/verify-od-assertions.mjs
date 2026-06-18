const forbiddenVisibleText = new RegExp(
  [
    "\\b[Pp]lan\\b",
    ["Dash", "board"].join(""),
    ["dash", "board"].join(""),
    ["right", "sidebar"].join("-"),
    ["opendock", "runner"].join("-"),
    ["app", "runner"].join("-")
  ].join("|")
);

export function catalogPageLimitForViewport(width, height) {
  const columns = catalogColumnsForViewport(width);
  const baseRows = width <= 520 ? 5 : 3;
  const extraRows = Math.max(0, Math.floor((height - 980) / 420));
  return Math.min(24, columns * Math.min(8, baseRows + extraRows));
}

function catalogColumnsForViewport(width) {
  if (width <= 520) return 1;
  if (width <= 980) return 2;
  if (width >= 1600) return 4;
  return 3;
}

export function versionPageLimitForViewport(width, height) {
  const baseRows = width <= 980 ? 5 : 6;
  const extraRows = Math.max(0, Math.floor((height - 900) / 180));
  return Math.min(18, baseRows + extraRows);
}

export async function assertCatalogGridDensity(page, viewport) {
  const expectedColumns = catalogColumnsForViewport(viewport.width);
  const metrics = await page.locator(".dock-card").evaluateAll((cards) => {
    const rects = cards.map((card) => card.getBoundingClientRect());
    const firstTop = Math.min(...rects.map((rect) => Math.round(rect.top)));
    const firstRow = rects.filter((rect) => Math.abs(Math.round(rect.top) - firstTop) <= 1);
    return {
      firstCardWidth: rects[0]?.width ?? 0,
      firstRowCount: firstRow.length
    };
  });
  if (metrics.firstRowCount !== expectedColumns) {
    throw new Error(`catalog grid should render ${expectedColumns} columns at ${viewport.width}px, got ${metrics.firstRowCount}`);
  }
  if (viewport.width >= 1600 && metrics.firstCardWidth < 320) {
    throw new Error(`wide catalog cards should be enlarged, got ${metrics.firstCardWidth}px`);
  }
}

export async function assertVisible(locator, label) {
  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    throw new Error(`expected visible: ${label}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function assertOneVisible(locators, label) {
  const deadline = Date.now() + 5000;
  let lastError = "";
  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        if (await locator.first().isVisible({ timeout: 250 })) return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  throw new Error(`expected visible: ${label}${lastError ? `\n${lastError}` : ""}`);
}

export async function assertNoForbiddenText(page, label) {
  const text = await page.locator("body").evaluate((body) => {
    const clone = body.cloneNode(true);
    clone
      .querySelectorAll(".dock-grid, .detail-panel, .detail-sidebar, .installed-table, .readme-panel, .versions-panel")
      .forEach((element) => element.remove());
    return clone.innerText;
  });
  if (forbiddenVisibleText.test(text)) {
    throw new Error(`forbidden non-OD text found on ${label}`);
  }
}

export async function assertNoHorizontalOverflow(page, label, viewport) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) {
    throw new Error(`${label} overflows horizontally at ${viewport.width}x${viewport.height}: ${overflow}px`);
  }
}

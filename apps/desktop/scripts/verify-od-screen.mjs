import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appUrl = process.env.OPENDOCK_APP_URL ?? "http://127.0.0.1:1420";
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

let server;
let browser;

try {
  if (!(await isReachable(appUrl))) {
    server = spawn("bun", ["run", "dev:web"], {
      cwd: appRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    server.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
    server.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
    await waitForReachable(appUrl);
  }

  browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromeExecutable()
  });

  await runViewportFlow({ width: 1180, height: 760 });
  await runViewportFlow({ width: 1360, height: 800 });
  await runViewportFlow({ width: 1720, height: 900 });
  await runViewportFlow({ width: 1024, height: 720 });
  await runViewportFlow({ width: 960, height: 640 });
  await assertWindowsAppMenuFlyoutDoesNotOverlap({ width: 1180, height: 760 });

  console.log("OD Applied Mockup verification passed");
} finally {
  await browser?.close().catch(() => {});
  if (server) await terminateServer(server);
}

async function runViewportFlow(viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await installRegistryFixtures(page);
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });

    await assertVisible(page.getByRole("heading", { name: "로그인" }), "signed-out login screen");
    await assertNoForbiddenText(page, "signed-out screen");
    await assertWindowControls(page);
    await assertWindowFrame(page);
    await assertThemeAndLanguageControls(page);
    await assertRegisteredProjectSkipsChooser(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertVisible(page.getByRole("heading", { name: "로그인" }), "signed-out login screen after registered-project check");
    await page.getByRole("button", { name: /Google로 계속/ }).click();

    await assertVisible(page.getByRole("heading", { name: "프로젝트를 선택하세요" }), "empty project screen");
    await page.getByRole("button", { name: /새 프로젝트 만들기/ }).first().click();

    await assertWorkspaceList(page);
    await assertNoHorizontalOverflow(page, "workspace list", viewport);
    await assertSidebarToggle(page);
    await assertSortMenu(page);
    await assertCommandPaletteEscapeClosesWithoutInputFocus(page);

    const catalogStatusCount = await page.locator(".catalog-status").count();
    if (catalogStatusCount !== 0) {
      throw new Error(`registry status badge should not be visible, got ${catalogStatusCount}`);
    }
    await page.waitForFunction(() => document.querySelectorAll(".dock-card").length >= 4);
    const initialCardCount = await page.locator(".dock-card").count();
    if (initialCardCount < 4) {
      throw new Error(`expected at least 4 dock cards, got ${initialCardCount}`);
    }
    const expectedCatalogLimit = catalogPageLimitForViewport(viewport.width, viewport.height);
    if (initialCardCount > expectedCatalogLimit) {
      throw new Error(`catalog should respect responsive page limit ${expectedCatalogLimit}, got ${initialCardCount}`);
    }
    await assertCatalogGridDensity(page, viewport);
    await assertVisible(page.locator(".dock-card .dock-metric").first(), "dock card download metric");
    await assertVisible(page.locator(".dock-card .star-button").first(), "dock card star metric");

    await page.getByRole("searchbox", { name: "Dock 검색" }).fill("backend-ultrawork");
    await page.waitForFunction(() => document.querySelectorAll(".dock-card").length >= 1);
    const titleBadgeCount = await page.locator(".dock-card .dock-title img").count();
    if (titleBadgeCount !== 0) {
      throw new Error(`explore dock title should not render official badges, got ${titleBadgeCount}`);
    }
    await assertVisible(page.locator(".dock-card .dock-publisher-line img").first(), "explore publisher official badge");
    await page.locator(".dock-card").first().click();
    await assertVisible(page.locator(".detail-panel"), "backend dock detail panel");
    const detailTitleBadgeCount = await page.locator(".detail-title-row img").count();
    if (detailTitleBadgeCount !== 0) {
      throw new Error(`detail dock title should not render official badges, got ${detailTitleBadgeCount}`);
    }
    await assertVisible(page.locator(".detail-meta img").first(), "detail publisher official badge");
    await page.waitForFunction(() => document.querySelector(".readme-markdown ul li"));
    const backendLogoSrc = await page.locator(".detail-hero .dock-icon img").first().getAttribute("src");
    if (!backendLogoSrc?.includes("/registry/v1/docks/opendock/backend-ultrawork/logo")) {
      throw new Error(`backend detail should render the registry logo, got ${backendLogoSrc}`);
    }
    const backendReadmeCopy = await page.locator(".readme-card").innerText();
    if (!backendReadmeCopy.includes("Backend Ultrawork") || !backendReadmeCopy.includes("What It Checks")) {
      throw new Error(`backend readme should render registry markdown content, got ${backendReadmeCopy}`);
    }
    const deprecatedRunCommand = "opendock " + "verify" + "-hook";
    if (backendReadmeCopy.includes(deprecatedRunCommand)) {
      throw new Error(`backend readme should not expose deprecated run instructions, got ${backendReadmeCopy}`);
    }
    if (backendReadmeCopy.includes("Categories") || backendReadmeCopy.includes("분류")) {
      throw new Error(`readme card should not append a local categories section, got ${backendReadmeCopy}`);
    }
    const backendReadmeListCount = await page.locator(".readme-markdown ul li").count();
    if (backendReadmeListCount < 6) {
      throw new Error(`backend readme should render markdown bullets as list items, got ${backendReadmeListCount}`);
    }
    const backendVerifyHookCodeBlockCount = await page.locator(".readme-markdown pre code", { hasText: deprecatedRunCommand }).count();
    if (backendVerifyHookCodeBlockCount !== 0) {
      throw new Error(`backend readme should not render deprecated run commands, got ${backendVerifyHookCodeBlockCount}`);
    }
    await page.getByRole("button", { name: "뒤로" }).click();
    await assertWorkspaceList(page);

    await page.getByRole("searchbox", { name: "Dock 검색" }).fill("frontend");
    await page.waitForFunction(() => document.querySelectorAll(".dock-card").length === 1);
    await page.locator(".dock-card").first().click();
    await assertVisible(page.locator(".detail-panel"), "dock detail panel");
    await assertVisible(page.locator(".detail-sidebar"), "detail metadata sidebar");
    await assertVisible(page.locator(".detail-meta .star-button"), "detail star action next to updated metadata");
    const detailActionStarCount = await page.locator(".detail-action .star-button").count();
    if (detailActionStarCount !== 0) {
      throw new Error(`detail star action should not sit next to install/delete actions, got ${detailActionStarCount}`);
    }
    await assertVisible(page.locator(".detail-sidebar .meta-row", { hasText: "Stars" }), "detail sidebar stars metric");
    const backButtonText = await page.getByRole("button", { name: "뒤로" }).innerText();
    const expandedDetailHeader = viewport.width >= 1360 && viewport.height >= 800;
    if (expandedDetailHeader) {
      if (!backButtonText.includes("뒤로")) {
        throw new Error(`expanded detail back button should include a text label, got ${backButtonText}`);
      }
      await assertVisible(page.locator(".detail-header-description"), "expanded detail header description");
      const titleWhiteSpace = await page.locator(".detail-title-row h1").evaluate((element) => getComputedStyle(element).whiteSpace);
      if (titleWhiteSpace === "nowrap") {
        throw new Error("expanded detail title should allow wrapping");
      }
    } else if (backButtonText.trim() !== "") {
      throw new Error(`compact detail back button should be icon-only, got ${backButtonText}`);
    }
    const readmeSidebarBox = await page.locator(".detail-sidebar").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, top: rect.top };
    });
    await page.getByRole("button", { name: "Versions" }).click();
    await assertOneVisible(
      [page.locator(".versions-list"), page.locator(".empty-state", { hasText: "이 dock에서 확인할 수 있는 버전이 없습니다" })],
      "versions panel or empty registry versions state"
    );
    const versionsSidebarBox = await page.locator(".detail-sidebar").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, top: rect.top };
    });
    if (Math.abs(readmeSidebarBox.top - versionsSidebarBox.top) > 1 || Math.abs(readmeSidebarBox.height - versionsSidebarBox.height) > 1) {
      throw new Error(`detail sidebar frame should match between tabs: ${JSON.stringify({ readmeSidebarBox, versionsSidebarBox })}`);
    }
    const expectedSidebarHeight = expandedDetailHeader ? 430 : 360;
    if (Math.abs(readmeSidebarBox.height - expectedSidebarHeight) > 1) {
      throw new Error(`detail sidebar height should follow viewport mode: expected ${expectedSidebarHeight}, got ${readmeSidebarBox.height}`);
    }
    const versionRowCount = await page.locator(".versions-list > button").count();
    const expectedVersionLimit = versionPageLimitForViewport(viewport.width, viewport.height);
    if (versionRowCount > expectedVersionLimit) {
      throw new Error(`versions should respect responsive page limit ${expectedVersionLimit}, got ${versionRowCount}`);
    }
    await page.getByRole("button", { name: "Readme" }).click();
    await page.getByRole("button", { name: "설치", exact: true }).click();
    await assertVisible(page.locator(".command-progress-overlay .command-progress"), "command progress popup after install");
    await assertVisible(page.locator(".command-progress-overlay .command-progress-bar"), "command progress popup bar after install");
    await assertVisible(page.locator(".command-progress-log", { hasText: "추가됨" }), "install change log");
    const inlineProgressCount = await page.locator(".detail-panel > .command-progress").count();
    if (inlineProgressCount !== 0) {
      throw new Error("command progress must render as a popup, not inline inside the detail panel");
    }
    await page.locator(".command-progress-overlay").getByRole("button", { name: "닫기" }).click();
    await assertVisible(page.getByRole("button", { name: "삭제", exact: true }), "delete button after install");

    await page.getByRole("button", { name: "설치됨" }).click();
    await assertVisible(page.locator(".installed-row"), "installed dock row");
    const installedRowCopy = await page.locator(".installed-row").first().innerText();
    const installedSearchTerm = installedRowCopy.split("\n").find((line) => line.startsWith("opendock/")) ?? "frontend";
    if (installedRowCopy.includes(["설치", "현재"].join(" "))) {
      throw new Error(`installed row should not show awkward copy: ${installedRowCopy}`);
    }
    if (!installedRowCopy.includes("설치됨")) {
      throw new Error(`installed row should show installed state, got ${installedRowCopy}`);
    }
    await assertVisible(page.locator(".installed-row .ready-chip, .installed-row .update-chip"), "installed status dot");
    const installedStatusText = await page.locator(".installed-row .ready-chip, .installed-row .update-chip").first().innerText();
    if (installedStatusText.trim() !== "") {
      throw new Error(`installed status should be icon-only, got ${installedStatusText}`);
    }
    const statusDotSize = await page.locator(".installed-row .ready-chip, .installed-row .update-chip").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderWidth: style.borderWidth, height: style.height, justifySelf: style.justifySelf, width: style.width };
    });
    if (statusDotSize.width !== "8px" || statusDotSize.height !== "8px" || statusDotSize.borderWidth !== "0px" || statusDotSize.justifySelf !== "center") {
      throw new Error(`installed status should render as a centered single 8px dot, got ${JSON.stringify(statusDotSize)}`);
    }
    await assertVisible(page.locator(".installed-actions").getByRole("button", { name: "상세 보기" }), "installed row detail button");
    await assertVisible(page.locator(".installed-actions").getByRole("button", { name: /삭제/ }), "installed row delete button");
    const visibleActionText = await page.locator(".installed-actions").first().innerText();
    if (visibleActionText.trim() !== "") {
      throw new Error(`installed row actions should be icon-only, got ${visibleActionText}`);
    }
    const actionChrome = await page.locator(".installed-icon-action").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, borderWidth: style.borderWidth };
    });
    if (actionChrome.borderWidth !== "0px" || actionChrome.backgroundColor !== "rgba(0, 0, 0, 0)") {
      throw new Error(`installed row icon actions should have no button chrome, got ${JSON.stringify(actionChrome)}`);
    }
    const actionAlignment = await page.locator(".installed-actions").first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { alignItems: style.alignItems, justifyContent: style.justifyContent, justifySelf: style.justifySelf };
    });
    if (actionAlignment.alignItems !== "center" || actionAlignment.justifyContent !== "center" || actionAlignment.justifySelf !== "center") {
      throw new Error(`installed row actions should align to the table centerline, got ${JSON.stringify(actionAlignment)}`);
    }
    const installedColumnAlignment = await page.evaluate(() => {
      const centerX = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.left + rect.width / 2;
      };
      const statusHead = document.querySelector(".installed-head span:nth-child(3)");
      const actionHead = document.querySelector(".installed-head span:nth-child(4)");
      const statusDot = document.querySelector(".installed-row .ready-chip, .installed-row .update-chip");
      const actions = document.querySelector(".installed-row .installed-actions");
      if (!statusHead || !actionHead || !statusDot || !actions) return null;
      const statusHeadCenter = centerX(statusHead);
      const statusDotCenter = centerX(statusDot);
      const actionHeadCenter = centerX(actionHead);
      const actionCenter = centerX(actions);
      return {
        actionDelta: Math.abs(actionHeadCenter - actionCenter),
        columnDistance: Math.abs(actionCenter - statusDotCenter),
        statusDelta: Math.abs(statusHeadCenter - statusDotCenter)
      };
    });
    if (!installedColumnAlignment) {
      throw new Error("installed table alignment targets are missing");
    }
    if (installedColumnAlignment.statusDelta > 1 || installedColumnAlignment.actionDelta > 1 || installedColumnAlignment.columnDistance < 64) {
      throw new Error(`installed status/action columns are misaligned: ${JSON.stringify(installedColumnAlignment)}`);
    }
    await assertVisible(page.getByRole("button", { name: /전체 업데이트/ }), "update all button on installed screen");
    await assertVisible(page.getByRole("searchbox", { name: "설치된 dock 검색" }), "installed search box");
    await page.getByRole("searchbox", { name: "설치된 dock 검색" }).fill("not-a-real-dock");
    await assertVisible(page.locator(".empty-state", { hasText: "검색 결과가 없습니다" }), "installed search empty state");
    await page.getByRole("searchbox", { name: "설치된 dock 검색" }).fill(installedSearchTerm);
    await assertVisible(page.locator(".installed-row"), "installed search restored row");
    await page.getByRole("button", { name: /전체 업데이트/ }).click();
    await assertVisible(page.locator(".installed-panel"), "installed screen stays visible after update all");
    await assertVisible(page.locator(".command-progress-overlay .command-progress"), "command progress popup after update all");
    await assertVisible(page.locator(".command-progress-log", { hasText: "수정됨" }), "update change log");
    await page.locator(".command-progress-overlay").getByRole("button", { name: "닫기" }).click();
    await page.locator(".installed-actions").getByRole("button", { name: /삭제/ }).click();
    await assertVisible(page.locator(".command-progress-overlay .command-progress"), "command progress popup after delete");
    await assertVisible(page.locator(".command-progress-log", { hasText: "삭제됨" }), "delete change log");
    await page.locator(".command-progress-overlay").getByRole("button", { name: "닫기" }).click();
    await page.getByRole("button", { name: "로그" }).click();
    await assertVisible(page.locator(".log-shell"), "project logs panel");
    await assertVisible(page.getByRole("button", { name: "로그 복사" }), "copy logs button");
    const logLinesCanScrollHorizontally = await page.locator(".log-lines").evaluate((node) => {
      const firstMessage = node.querySelector(".log-line p");
      if (!firstMessage) return false;
      firstMessage.textContent = `${firstMessage.textContent} ${"x".repeat(360)}`;
      return node.scrollWidth > node.clientWidth;
    });
    if (!logLinesCanScrollHorizontally) {
      throw new Error("project logs should support horizontal scrolling for long messages");
    }

    await page.locator(".avatar-button").click();
    await assertVisible(page.locator(".account-name", { hasText: "kjyscom@gmail.com" }), "gmail account menu label");
    await page.getByRole("button", { name: /^계정$/ }).click();
    await assertVisible(page.getByRole("heading", { name: "내 계정" }), "account profile panel");
    await assertVisible(page.locator(".account-tabs").getByRole("button", { name: "프로필" }), "account profile tab");
    await assertVisible(page.locator(".account-tabs").getByRole("button", { name: "내 Docks" }), "account my docks tab");
    const shortcutSettingsVisible = await page.locator(".shortcut-settings").count();
    if (shortcutSettingsVisible !== 0) {
      throw new Error(`account panel should not render shortcut settings, got ${shortcutSettingsVisible}`);
    }
    await page.locator(".account-tabs").getByRole("button", { name: "내 Docks" }).click();
    await assertOneVisible(
      [page.locator(".starred-dock-list"), page.locator(".starred-empty", { hasText: "아직 제출한 dock이 없습니다" })],
      "account my docks tab"
    );
    await assertVisible(page.locator(".account-list-panel .account-range", { hasText: "0-0 / 0" }), "account my docks range");
    await page.locator(".account-tabs").getByRole("button", { name: "Stars" }).click();
    await assertOneVisible(
      [page.locator(".starred-dock-list"), page.locator(".starred-empty")],
      "account stars tab"
    );
    await page.getByRole("button", { name: /메인으로/ }).click();
    await assertWorkspaceList(page);

    await page.locator(".project-sidebar-head .icon-button").last().click();
    await assertVisible(page.getByRole("heading", { name: "프로젝트 추가" }), "project add modal");
    await page.locator(".modal").getByRole("button", { name: /새 프로젝트 만들기/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".project-row").length === 2);
    await assertWorkspaceList(page);
    const activeProjectAfterAdd = await page.locator(".project-row.active strong").innerText();
    if (activeProjectAfterAdd !== "Empty Project 2") {
      throw new Error(`newly added project should be active, got ${activeProjectAfterAdd}`);
    }
    const storedProjectsAfterAdd = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.projects") ?? "[]"));
    if (storedProjectsAfterAdd[1]?.folderName !== "empty-project-2") {
      throw new Error(`blank project folder name should be an English slug, got ${JSON.stringify(storedProjectsAfterAdd)}`);
    }
    await page.getByRole("searchbox", { name: "Dock 검색" }).fill("frontend");
    await page.locator(".dock-card").first().click();
    await assertVisible(page.locator(".detail-panel"), "detail before project selection reset");
    await page.locator(".project-row").first().getByRole("button").first().click();
    await assertWorkspaceList(page);
    const searchAfterProjectSwitch = await page.getByRole("searchbox", { name: "Dock 검색" }).inputValue();
    if (searchAfterProjectSwitch !== "") {
      throw new Error(`project selection should reset search query, got ${searchAfterProjectSwitch}`);
    }

    await page.locator(".project-sidebar-head .icon-button").last().click();
    await assertVisible(page.getByRole("heading", { name: "프로젝트 추가" }), "project add modal reopened");
    await page.getByRole("button", { name: "닫기", exact: true }).click();

    const originalProjectName = await page.locator(".project-row strong").first().innerText();
    await page.locator(".project-row .icon-button").first().click();
    await assertVisible(page.getByRole("heading", { name: "프로젝트 이름 변경" }), "project rename modal");
    await page.getByRole("textbox", { name: "프로젝트 이름" }).fill("임시 이름");
    await page.getByRole("button", { name: "취소" }).click();
    await page.locator(".project-row .icon-button").first().click();
    const reopenedRenameValue = await page.getByRole("textbox", { name: "프로젝트 이름" }).inputValue();
    if (reopenedRenameValue !== originalProjectName) {
      throw new Error(`rename cancel leaked draft value: ${reopenedRenameValue}`);
    }
    await page.getByRole("button", { name: "취소" }).click();
    await assertProjectDeleteFlow(page);

    await page.locator(".avatar-button").click();
    await page.getByRole("button", { name: /로그아웃/ }).click();
    await assertVisible(page.getByRole("heading", { name: "로그인" }), "login screen after logout");
    const storedProjectsAfterLogout = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.projects") ?? "[]"));
    if (
      storedProjectsAfterLogout.length !== 1 ||
      storedProjectsAfterLogout[0]?.name !== "Empty Project 2" ||
      storedProjectsAfterLogout[0]?.folderName !== "empty-project-2"
    ) {
      throw new Error(`logout must keep registered projects, got ${JSON.stringify(storedProjectsAfterLogout)}`);
    }
    const activeProjectAfterLogout = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.activeProjectId") ?? "\"\""));
    if (activeProjectAfterLogout !== storedProjectsAfterLogout[0]?.id) {
      throw new Error(`logout must keep the active project id, got ${activeProjectAfterLogout}`);
    }

    await page.getByRole("button", { name: /GitHub로 계속/ }).click();
    await assertWorkspaceList(page);
    const chooserVisibleAfterRelogin = await page.getByRole("heading", { name: "프로젝트를 선택하세요" }).isVisible().catch(() => false);
    if (chooserVisibleAfterRelogin) {
      throw new Error("re-login after logout should restore existing projects without the project chooser");
    }
    await page.locator(".avatar-button").click();
    await assertVisible(page.locator(".account-name", { hasText: "GitHub 계정" }), "github account menu label");
    await assertNoForbiddenText(page, "github account menu");
  } finally {
    await context.close();
  }
}

async function assertWindowsAppMenuFlyoutDoesNotOverlap(viewport) {
  const context = await browser.newContext({
    viewport,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
  });
  const page = await context.newPage();
  try {
    await installRegistryFixtures(page);
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });

    await assertVisible(page.locator('.titlebar.windows[data-platform="windows"]'), "Windows titlebar");
    await page.locator(".app-menu-button").click();
    await assertVisible(page.locator(".app-menu-panel"), "Windows app menu panel");

    await page.locator(".app-menu-group-button").nth(0).click();
    await assertSingleVisibleAppMenuFlyout(page, "after clicking a Windows app menu group");
    await page.locator(".app-menu-group-button").nth(1).hover();
    await assertSingleVisibleAppMenuFlyout(page, "after hovering a second Windows app menu group");
  } finally {
    await context.close();
  }
}

async function assertSingleVisibleAppMenuFlyout(page, label) {
  const menuState = await page.evaluate(() => {
    const visibleFlyoutCount = Array.from(document.querySelectorAll(".app-menu-flyout")).filter((element) => {
      const rect = element.getBoundingClientRect();
      return getComputedStyle(element).display !== "none" && rect.width > 0 && rect.height > 0;
    }).length;
    return {
      activeGroupCount: document.querySelectorAll(".app-menu-group.active").length,
      visibleFlyoutCount
    };
  });
  if (menuState.activeGroupCount !== 1 || menuState.visibleFlyoutCount !== 1) {
    throw new Error(`Windows app menu must show one flyout ${label}, got ${JSON.stringify(menuState)}`);
  }
}

async function assertThemeAndLanguageControls(page) {
  await page.getByRole("button", { name: "테마 전환" }).click();
  const themeAfterToggle = await page.locator(".app-root").getAttribute("data-theme");
  if (themeAfterToggle !== "dark") {
    throw new Error(`theme toggle should switch to dark, got ${themeAfterToggle}`);
  }

  await page.locator(".control-button").click();
  await page.locator(".dropdown-menu.compact").getByRole("button", { name: /English/ }).click();
  await assertVisible(page.getByRole("heading", { name: "Sign in" }), "English signed-out screen");
  const languageAfterEnglish = await page.locator(".app-root").getAttribute("data-lang");
  if (languageAfterEnglish !== "en") {
    throw new Error(`language switch should set en, got ${languageAfterEnglish}`);
  }

  await page.locator(".control-button").click();
  await page.locator(".dropdown-menu.compact").getByRole("button", { name: /한국어/ }).click();
  await assertVisible(page.getByRole("heading", { name: "로그인" }), "Korean signed-out screen");
}

async function assertWindowControls(page) {
  const titlebar = page.locator(".titlebar");
  await assertVisible(titlebar, "custom titlebar");
  const titlebarDragRegion = await titlebar.getAttribute("data-tauri-drag-region");
  if (titlebarDragRegion !== null) {
    throw new Error("titlebar must not be a full drag region because it blocks window control clicks");
  }
  const brandDragRegion = await page.locator(".titlebar-brand").getAttribute("data-tauri-drag-region");
  if (brandDragRegion === null) {
    throw new Error("titlebar brand should be the dedicated native drag region");
  }
  const platform = await titlebar.getAttribute("data-platform");
  if (platform === "macos") {
    await assertVisible(page.locator(".window-controls.macos"), "macOS window controls");
    const controlCount = await page.locator(".window-controls.macos button").count();
    if (controlCount !== 3) {
      throw new Error(`macOS titlebar should have 3 traffic-light controls, got ${controlCount}`);
    }
    await assertVisible(page.locator(".mac-window-control.close"), "macOS close traffic light");
    await assertVisible(page.locator(".mac-window-control.minimize"), "macOS minimize traffic light");
    await assertVisible(page.locator(".mac-window-control.maximize"), "macOS maximize traffic light");
    return;
  }

  await assertVisible(page.locator(".window-controls.windows"), "Windows window controls");
  const controlCount = await page.locator(".window-controls.windows button").count();
  if (controlCount !== 3) {
    throw new Error(`Windows titlebar should have 3 caption controls, got ${controlCount}`);
  }
  await assertVisible(page.locator(".windows-window-control.close"), "Windows close control");
}

async function assertWindowFrame(page) {
  const frame = page.locator(".app-root");
  const frameStyle = await frame.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderTopLeftRadius: style.borderTopLeftRadius,
      overflow: style.overflow
    };
  });
  if (Number.parseFloat(frameStyle.borderTopLeftRadius) < 10) {
    throw new Error(`app window frame should have soft rounded corners, got ${frameStyle.borderTopLeftRadius}`);
  }
  if (frameStyle.overflow !== "hidden") {
    throw new Error(`app window frame should clip rounded corners, got overflow ${frameStyle.overflow}`);
  }
}

async function assertSidebarToggle(page) {
  await page.locator(".project-sidebar .icon-button").first().click();
  await assertVisible(page.locator(".project-sidebar.collapsed"), "collapsed project sidebar");
  await page.locator(".project-sidebar.collapsed .icon-button").click();
  await assertVisible(page.locator(".project-sidebar:not(.collapsed)"), "expanded project sidebar");
}

async function assertSortMenu(page) {
  await page.locator(".sort-button").click();
  await assertVisible(page.locator(".sort-menu").getByRole("button", { name: /Star 많은 순/ }), "stars sort option");
  await page.locator(".sort-menu").getByRole("button", { name: /이름순/ }).click();
  const sortMode = await page.evaluate(() => localStorage.getItem("opendock.sortMode"));
  if (sortMode !== "\"name\"") {
    throw new Error(`sort selection should persist name mode, got ${sortMode}`);
  }
  await page.waitForFunction(
    () => document.querySelector(".dock-title strong")?.textContent?.trim() === "backend-ultrawork"
  );
  const firstDockTitle = await page.locator(".dock-title strong").first().innerText();
  if (firstDockTitle !== "backend-ultrawork") {
    throw new Error(`name sort should put backend-ultrawork first, got ${firstDockTitle}`);
  }
}

async function assertCommandPaletteEscapeClosesWithoutInputFocus(page) {
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Meta" : "Control"));
  await page.keyboard.press(`${modifier}+K`);
  await assertVisible(page.locator(".command-palette"), "command palette");
  await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
  });
  const focusedInput = await page.evaluate(() => document.activeElement?.tagName === "INPUT");
  if (focusedInput) {
    throw new Error("command palette input should lose focus before Escape regression check");
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".command-palette"));

  await page.keyboard.press(`${modifier}+K`);
  await assertVisible(page.locator(".command-palette"), "command palette after reopen");
  await page.mouse.click(20, 60);
  await page.waitForFunction(() => !document.querySelector(".command-palette"));
}

async function installRegistryFixtures(page) {
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
        "base64"
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
        return [dock.id, dock.name, dock.summary, ...(dock.tags ?? [])].join(" ").toLowerCase().includes(query);
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
    registryDock("backend-ultrawork", "Backend quality gate for API contracts, validation, authentication, migrations, logging, and service safety.", ["api", "backend", "harness", "security", "ultrawork"], 31, 12),
    registryDock("designer-ai", "Design workspace setup with prompts, UX review notes, and reusable product design guidance.", ["design", "ux", "figma"], 28, 9),
    registryDock("frontend-ai", "Frontend setup for UI implementation, responsive checks, accessibility, and review workflows.", ["frontend", "ui", "accessibility"], 24, 11),
    registryDock("workspace-agent", "Shared agent instructions and conventions for AI-assisted project work.", ["ai-agent", "starter"], 19, 7),
    registryDock("mcp-safe", "MCP safety notes and review checks for tool-enabled agent workspaces.", ["mcp", "security"], 13, 5),
    registryDock("writer-ai", "Documentation writing and review setup for user-facing guides.", ["docs", "writing"], 11, 4),
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

function catalogPageLimitForViewport(width, height) {
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

function versionPageLimitForViewport(width, height) {
  const baseRows = width <= 980 ? 5 : 6;
  const extraRows = Math.max(0, Math.floor((height - 900) / 180));
  return Math.min(18, baseRows + extraRows);
}

async function assertCatalogGridDensity(page, viewport) {
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

async function assertRegisteredProjectSkipsChooser(page) {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("opendock.loggedIn", JSON.stringify(true));
    localStorage.setItem("opendock.authProvider", JSON.stringify("gmail"));
    localStorage.setItem("opendock.accountEmail", JSON.stringify("kjyscom@gmail.com"));
    localStorage.setItem(
      "opendock.projects",
      JSON.stringify([
        {
          id: "project-existing",
          name: "research",
          folderName: "research",
          path: "/Users/jys/Workspace/side/research"
        }
      ])
    );
    localStorage.setItem("opendock.activeProjectId", JSON.stringify(""));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertWorkspaceList(page);
  const chooserVisible = await page.getByRole("heading", { name: "프로젝트를 선택하세요" }).isVisible().catch(() => false);
  if (chooserVisible) {
    throw new Error("registered projects should skip the create-or-add project chooser");
  }
  await page.waitForFunction(() => localStorage.getItem("opendock.activeProjectId") === JSON.stringify("project-existing"));
}

async function assertProjectDeleteFlow(page) {
  const initialCount = await page.locator(".project-row").count();
  if (initialCount !== 2) {
    throw new Error(`project delete flow expects 2 projects, got ${initialCount}`);
  }

  await page.locator(".project-row").first().locator(".icon-button").nth(1).click();
  await assertVisible(page.getByRole("heading", { name: "정말로 삭제하시겠습니까?" }), "project delete confirmation");
  await assertVisible(page.locator(".modal", { hasText: "실제 폴더와 경로는 삭제되지 않습니다." }), "project delete safety copy");
  await assertVisible(page.locator(".delete-project-name", { hasText: "Empty Project 1" }), "project name in delete modal");
  await page.locator(".modal").getByRole("button", { name: "취소" }).click();
  const countAfterCancel = await page.locator(".project-row").count();
  if (countAfterCancel !== initialCount) {
    throw new Error(`cancel should keep project count at ${initialCount}, got ${countAfterCancel}`);
  }

  await page.locator(".project-row").first().locator(".icon-button").nth(1).click();
  await page.locator(".modal").getByRole("button", { name: "삭제" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".project-row").length === 1);
  const remainingProject = await page.locator(".project-row strong").first().innerText();
  if (remainingProject !== "Empty Project 2") {
    throw new Error(`delete should remove only the selected project and activate the remaining project, got ${remainingProject}`);
  }
  const storedProjects = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.projects") ?? "[]"));
  if (
    storedProjects.length !== 1 ||
    storedProjects[0]?.name !== "Empty Project 2" ||
    storedProjects[0]?.folderName !== "empty-project-2"
  ) {
    throw new Error(`delete should update only stored project registration, got ${JSON.stringify(storedProjects)}`);
  }
  const chooserVisible = await page.getByRole("heading", { name: "프로젝트를 선택하세요" }).isVisible().catch(() => false);
  if (chooserVisible) {
    throw new Error("deleting one project while another remains should not show the project chooser");
  }
}

async function assertWorkspaceList(page) {
  await assertVisible(page.getByRole("heading", { name: "프로젝트에 맞는 dock 찾기" }), "dock explore list");
  await assertVisible(page.getByRole("button", { name: "탐색" }), "explore tab");
  await assertVisible(page.getByRole("button", { name: "설치됨" }), "installed tab");
  await assertVisible(page.getByRole("button", { name: "로그" }), "logs tab");
  await assertVisible(page.locator(".project-sidebar"), "project sidebar");
  await assertNoForbiddenText(page, "workspace list");
}

async function assertVisible(locator, label) {
  try {
    await locator.waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    throw new Error(`expected visible: ${label}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertOneVisible(locators, label) {
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

async function assertNoForbiddenText(page, label) {
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

async function assertNoHorizontalOverflow(page, label, viewport) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) {
    throw new Error(`${label} overflows horizontally at ${viewport.width}x${viewport.height}: ${overflow}px`);
  }
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReachable(url) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await isReachable(url)) return;
    if (server?.exitCode !== null) {
      throw new Error(`dev server exited before ${url} was reachable`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function resolveChromeExecutable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function terminateServer(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    await new Promise((resolveStop) => setTimeout(resolveStop, 300));
    child.kill("SIGKILL");
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The process group may already be gone.
  }
  await new Promise((resolveStop) => setTimeout(resolveStop, 300));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already stopped.
  }
}

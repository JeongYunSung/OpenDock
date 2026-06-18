import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  isReachable,
  resolveChromeExecutable,
  terminateServer,
  waitForReachable
} from "./browser-test-runtime.mjs";
import {
  assertCatalogGridDensity,
  assertNoForbiddenText,
  assertNoHorizontalOverflow,
  assertOneVisible,
  assertVisible,
  catalogPageLimitForViewport,
  versionPageLimitForViewport
} from "./verify-od-assertions.mjs";
import {
  assertCommandPaletteEscapeClosesWithoutInputFocus,
  assertProjectDeleteFlow,
  assertRegisteredProjectSkipsChooser,
  assertSidebarToggle,
  assertSortMenu,
  assertThemeAndLanguageControls,
  assertWindowControls,
  assertWindowFrame,
  assertWorkspaceList
} from "./verify-od-flow-assertions.mjs";
import { installRegistryFixtures } from "./registry-fixtures.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appUrl = process.env.OPENDOCK_APP_URL ?? "http://127.0.0.1:1420";

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
    await waitForReachable(appUrl, server);
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

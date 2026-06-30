import { assertNoForbiddenText, assertVisible } from "./verify-od-assertions.mjs";

export async function assertThemeAndLanguageControls(page) {
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

export async function assertWindowControls(page) {
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

export async function assertWindowFrame(page) {
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

export async function assertSidebarToggle(page) {
  await page.locator(".project-sidebar .icon-button").first().click();
  await assertVisible(page.locator(".project-sidebar.collapsed"), "collapsed project sidebar");
  await page.locator(".project-sidebar.collapsed .icon-button").click();
  await assertVisible(page.locator(".project-sidebar:not(.collapsed)"), "expanded project sidebar");
}

export async function assertSortMenu(page) {
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

export async function assertCommandPaletteEscapeClosesWithoutInputFocus(page) {
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

export async function assertRegisteredProjectSkipsChooser(page) {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("opendock.loggedIn", JSON.stringify(true));
    localStorage.setItem("opendock.authProvider", JSON.stringify("gmail"));
    localStorage.setItem("opendock.accountEmail", JSON.stringify("hello@opendock.app"));
    localStorage.setItem(
      "opendock.projects",
      JSON.stringify([
        {
          id: "project-existing",
          name: "bigs-pay-backend-spring-with-long-service-name",
          folderName: "bigs-pay-backend-spring-with-long-service-name",
          path: "/Users/jys/Workspace/side/bigs-pay-backend-spring-with-long-service-name"
        }
      ])
    );
    localStorage.setItem("opendock.activeProjectId", JSON.stringify(""));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertWorkspaceList(page);
  await assertProjectRowActionsStayClear(page);
  const chooserVisible = await page.getByRole("heading", { name: "워크스페이스를 선택하세요" }).isVisible().catch(() => false);
  if (chooserVisible) {
    throw new Error("registered projects should skip the create-or-add project chooser");
  }
  await page.waitForFunction(() => localStorage.getItem("opendock.activeProjectId") === JSON.stringify("project-existing"));
}

export async function assertProjectRowActionsStayClear(page) {
  const metrics = await page.locator(".project-row.active").evaluate((row) => {
    const copy = row.querySelector(".project-row-copy");
    const actions = row.querySelector(".project-row-actions");
    const buttons = row.querySelectorAll(".project-row-actions .icon-button");
    if (!copy || !actions || buttons.length < 2) return null;

    const copyRect = copy.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const renameRect = buttons[0].getBoundingClientRect();
    const deleteRect = buttons[1].getBoundingClientRect();

    return {
      copyRight: copyRect.right,
      actionsLeft: actionsRect.left,
      renameCenterY: renameRect.top + renameRect.height / 2,
      deleteCenterY: deleteRect.top + deleteRect.height / 2
    };
  });

  if (!metrics) {
    throw new Error("project row should render text and action controls");
  }
  if (metrics.copyRight > metrics.actionsLeft - 4) {
    throw new Error(`project row text overlaps action controls: ${JSON.stringify(metrics)}`);
  }
  if (Math.abs(metrics.renameCenterY - metrics.deleteCenterY) > 1) {
    throw new Error(`project row action controls should be vertically aligned: ${JSON.stringify(metrics)}`);
  }
}

export async function assertProjectDeleteFlow(page) {
  const initialCount = await page.locator(".project-row").count();
  if (initialCount !== 2) {
    throw new Error(`project delete flow expects 2 projects, got ${initialCount}`);
  }

  await page.locator(".project-row").first().locator(".icon-button").nth(1).click();
  await assertVisible(page.getByRole("heading", { name: "정말로 삭제하시겠습니까?" }), "project delete confirmation");
  await assertVisible(page.locator(".modal", { hasText: "실제 폴더와 경로는 삭제되지 않습니다." }), "workspace delete safety copy");
  await assertVisible(page.locator(".delete-project-name", { hasText: "Untitled Workspace" }), "workspace name in delete modal");
  await page.locator(".modal").getByRole("button", { name: "취소" }).click();
  const countAfterCancel = await page.locator(".project-row").count();
  if (countAfterCancel !== initialCount) {
    throw new Error(`cancel should keep project count at ${initialCount}, got ${countAfterCancel}`);
  }

  await page.locator(".project-row").first().locator(".icon-button").nth(1).click();
  await page.locator(".modal").getByRole("button", { name: "삭제" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".project-row").length === 1);
  const remainingProject = await page.locator(".project-row strong").first().innerText();
  if (remainingProject !== "Untitled Workspace 2") {
    throw new Error(`delete should remove only the selected project and activate the remaining project, got ${remainingProject}`);
  }
  const storedProjects = await page.evaluate(() => JSON.parse(localStorage.getItem("opendock.projects") ?? "[]"));
  if (
    storedProjects.length !== 1 ||
    storedProjects[0]?.name !== "Untitled Workspace 2" ||
    storedProjects[0]?.folderName !== "untitled-workspace-2"
  ) {
    throw new Error(`delete should update only stored project registration, got ${JSON.stringify(storedProjects)}`);
  }
  const chooserVisible = await page.getByRole("heading", { name: "워크스페이스를 선택하세요" }).isVisible().catch(() => false);
  if (chooserVisible) {
    throw new Error("deleting one project while another remains should not show the project chooser");
  }
}

export async function assertWorkspaceList(page) {
  await assertVisible(page.getByRole("heading", { name: "워크스페이스에 맞는 dock 찾기" }), "dock explore list");
  await assertVisible(page.getByRole("button", { name: "탐색" }), "explore tab");
  await assertVisible(page.getByRole("button", { name: "설치됨" }), "installed tab");
  await assertVisible(page.getByRole("button", { name: "로그" }), "logs tab");
  await assertVisible(page.locator(".project-sidebar"), "project sidebar");
  await assertNoForbiddenText(page, "workspace list");
}

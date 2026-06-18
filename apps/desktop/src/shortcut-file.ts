export interface ShortcutFileResult {
  contents: string;
  path: string;
}

export function chooseShortcutFileFromBrowser(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result ?? "")), { once: true });
        reader.addEventListener("error", () => resolve(null), { once: true });
        reader.readAsText(file);
      },
      { once: true }
    );
    input.style.display = "none";
    document.body.appendChild(input);
    input.click();
  });
}

export function downloadShortcutFile(contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "opendock-shortcuts.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

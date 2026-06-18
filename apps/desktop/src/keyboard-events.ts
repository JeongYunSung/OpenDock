export function shouldIgnoreGlobalShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented) return true;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return false;
  const editable =
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT";
  return editable && !event.metaKey && !event.ctrlKey;
}

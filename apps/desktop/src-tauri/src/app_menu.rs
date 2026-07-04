use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Runtime;

pub(crate) fn build_app_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let version_label = format!("OpenDock {}", env!("CARGO_PKG_VERSION"));
    let quit = MenuItem::with_id(app, "app:quit", "Quit OpenDock", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(app, "OpenDock", true, &[&quit])?;

    let new_project =
        MenuItem::with_id(app, "file:new-project", "New Workspace", true, None::<&str>)?;
    let add_existing = MenuItem::with_id(
        app,
        "file:add-existing-project",
        "Add Existing Workspace",
        true,
        None::<&str>,
    )?;
    let file_menu = Submenu::with_items(app, "File", true, &[&new_project, &add_existing])?;

    let rename_project = MenuItem::with_id(
        app,
        "edit:rename-project",
        "Rename Workspace",
        true,
        None::<&str>,
    )?;
    let cut = MenuItem::with_id(app, "edit:cut", "Cut", true, Some("CmdOrCtrl+X"))?;
    let copy = MenuItem::with_id(app, "edit:copy", "Copy", true, Some("CmdOrCtrl+C"))?;
    let paste = MenuItem::with_id(app, "edit:paste", "Paste", true, Some("CmdOrCtrl+V"))?;
    let select_all =
        MenuItem::with_id(app, "edit:select-all", "Select All", true, Some("CmdOrCtrl+A"))?;
    let copy_project_path = MenuItem::with_id(
        app,
        "edit:copy-project-path",
        "Copy Workspace Path",
        true,
        Some("CmdOrCtrl+Shift+C"),
    )?;
    let import_shortcuts = MenuItem::with_id(
        app,
        "edit:import-shortcuts",
        "Import Shortcuts...",
        true,
        None::<&str>,
    )?;
    let export_shortcuts = MenuItem::with_id(
        app,
        "edit:export-shortcuts",
        "Export Shortcuts...",
        true,
        None::<&str>,
    )?;
    let edit_sep = PredefinedMenuItem::separator(app)?;
    let clipboard_sep = PredefinedMenuItem::separator(app)?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &rename_project,
            &edit_sep,
            &cut,
            &copy,
            &paste,
            &select_all,
            &clipboard_sep,
            &copy_project_path,
            &import_shortcuts,
            &export_shortcuts,
        ],
    )?;

    let explore_docks =
        MenuItem::with_id(app, "view:explore", "Explore Docks", true, None::<&str>)?;
    let installed_docks =
        MenuItem::with_id(app, "view:installed", "Installed Docks", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "view:logs", "Logs", true, None::<&str>)?;
    let toggle_sidebar = MenuItem::with_id(
        app,
        "view:toggle-sidebar",
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+B"),
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&explore_docks, &installed_docks, &logs, &toggle_sidebar],
    )?;

    let run_doctor = MenuItem::with_id(
        app,
        "project:run-doctor",
        "Run Doctor",
        true,
        Some("CmdOrCtrl+D"),
    )?;
    let update_docks = MenuItem::with_id(
        app,
        "project:update-docks",
        "Update Docks",
        true,
        None::<&str>,
    )?;
    let open_folder = MenuItem::with_id(
        app,
        "project:open-folder",
        "Open Workspace Folder",
        true,
        None::<&str>,
    )?;
    let reveal_folder = MenuItem::with_id(
        app,
        "project:reveal-folder",
        "Reveal in Finder / Explorer",
        true,
        None::<&str>,
    )?;
    let remove_project = MenuItem::with_id(
        app,
        "project:remove-from-opendock",
        "Remove from OpenDock",
        true,
        None::<&str>,
    )?;
    let project_menu = Submenu::with_items(
        app,
        "Workspace",
        true,
        &[
            &run_doctor,
            &update_docks,
            &open_folder,
            &reveal_folder,
            &remove_project,
        ],
    )?;

    let install_dock = MenuItem::with_id(app, "dock:install", "Install Dock", true, None::<&str>)?;
    let delete_dock = MenuItem::with_id(app, "dock:delete", "Delete Dock", true, None::<&str>)?;
    let refresh_registry = MenuItem::with_id(
        app,
        "dock:refresh-registry",
        "Refresh Registry",
        true,
        None::<&str>,
    )?;
    let open_dock_detail = MenuItem::with_id(
        app,
        "dock:open-detail",
        "Open Dock Detail",
        true,
        None::<&str>,
    )?;
    let dock_menu = Submenu::with_items(
        app,
        "Dock",
        true,
        &[
            &install_dock,
            &delete_dock,
            &refresh_registry,
            &open_dock_detail,
        ],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let zoom = PredefinedMenuItem::maximize(app, None)?;
    let reload_window = MenuItem::with_id(
        app,
        "window:reload",
        "Reload Window",
        true,
        Some("CmdOrCtrl+Shift+R"),
    )?;
    let window_menu =
        Submenu::with_items(app, "Window", true, &[&minimize, &zoom, &reload_window])?;

    let docs = MenuItem::with_id(app, "help:docs", "OpenDock Docs", true, None::<&str>)?;
    let current_version = MenuItem::with_id(
        app,
        "help:current-version",
        version_label,
        true,
        None::<&str>,
    )?;
    let check_for_updates = MenuItem::with_id(
        app,
        "help:check-for-updates",
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    let help_sep = PredefinedMenuItem::separator(app)?;
    let cli_commands = MenuItem::with_id(
        app,
        "help:cli-commands",
        "View CLI Commands",
        true,
        None::<&str>,
    )?;
    let troubleshooting = MenuItem::with_id(
        app,
        "help:troubleshooting",
        "Troubleshooting",
        true,
        None::<&str>,
    )?;
    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &current_version,
            &check_for_updates,
            &help_sep,
            &docs,
            &cli_commands,
            &troubleshooting,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &project_menu,
            &dock_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

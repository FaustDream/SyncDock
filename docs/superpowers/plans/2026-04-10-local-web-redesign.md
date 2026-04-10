# Local Web Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild SyncDock as a local Rust web service with a Vue 3 browser UI, preserving local Git/data capabilities while applying the approved product simplifications.

**Architecture:** Add a local-only HTTP server that serves the built web app and exposes JSON APIs backed by existing Rust storage, Git, sync, models, and errors. Replace the React/Tauri frontend with a Vue 3 app that uses a local API client and a Cal.com-inspired neutral top-navigation interface.

**Tech Stack:** Rust 1.77+, Axum, Tokio, Tower HTTP, Serde, Vue 3, TypeScript, Vite, Pinia, Vitest, Playwright.

---

## Approved Spec

`docs/superpowers/specs/2026-04-10-local-web-design.md`

## File Structure

- Create backend: `src-tauri/src/lib.rs`, `src-tauri/src/bin/syncdock.rs`, `src-tauri/src/server/mod.rs`, `src-tauri/src/server/api.rs`, `src-tauri/src/server/state.rs`, `src-tauri/src/server/errors.rs`, `src-tauri/src/server/static_files.rs`, `src-tauri/src/runtime/mod.rs`, `src-tauri/src/sync/force_ignore.rs`.
- Modify backend: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/src/models.rs`, `src-tauri/src/storage/*.rs`, `src-tauri/src/sync/*.rs`.
- Create frontend: `src/main.ts`, `src/App.vue`, `src/api/client.ts`, `src/api/types.ts`, `src/stores/appStore.ts`, `src/pages/OverviewPage.vue`, `src/pages/TasksPage.vue`, `src/pages/SettingsPage.vue`, `src/components/TopNav.vue`, `src/components/EditableSelect.vue`, `src/components/RepositoryFilters.vue`, `src/components/RepositoryTable.vue`, `src/components/RepositoryLogPanel.vue`, `src/components/ForceIgnoreRules.vue`, `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/components.css`.
- Remove after replacement: `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/context/AppContext.tsx`, obsolete React components/pages.
- Tests: `src-tauri/tests/storage_paths.rs`, `src-tauri/tests/repository_sorting.rs`, `src-tauri/tests/force_ignore_rules.rs`, `src-tauri/tests/http_api.rs`, `tests/frontend/overview.test.ts`, `tests/frontend/settings.test.ts`, `tests/frontend/tasks.test.ts`, `tests/e2e/local-web.spec.ts`.

## Task 1: Local Server Skeleton

**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/bin/syncdock.rs`, `src-tauri/src/server/mod.rs`, `src-tauri/src/server/state.rs`, `src-tauri/src/server/errors.rs`

- [ ] **Step 1: Run failing check**

Run: `cd src-tauri; cargo check --bin syncdock`

Expected: FAIL because `syncdock` binary does not exist.

- [ ] **Step 2: Add Rust dependencies**

Add to `src-tauri/Cargo.toml`:

```toml
axum = "0.7"
clap = { version = "4.5", features = ["derive"] }
dirs = "5.0"
globset = "0.4"
tokio = { version = "1.37", features = ["macros", "rt-multi-thread", "net", "signal"] }
tower-http = { version = "0.5", features = ["fs", "cors"] }

[[bin]]
name = "syncdock"
path = "src/bin/syncdock.rs"
```

- [ ] **Step 3: Export shared Rust modules**

Create `src-tauri/src/lib.rs`:

```rust
pub mod errors;
pub mod git;
pub mod models;
pub mod runtime;
pub mod server;
pub mod storage;
pub mod sync;
```

- [ ] **Step 4: Add server state and error adapter**

Create `src-tauri/src/server/state.rs`:

```rust
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use crate::sync::SyncRuntimeState;

#[derive(Clone)]
pub struct ServerState {
    pub storage_root: PathBuf,
    pub default_storage_root: PathBuf,
    pub sync_runtime: Arc<SyncRuntimeState>,
    pub session_token: String,
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub requested_addr: SocketAddr,
    pub open_browser: bool,
    pub storage_root: Option<PathBuf>,
}
```

Create `src-tauri/src/server/errors.rs`:

```rust
use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use crate::{errors::AppError, models::NoticeLevel};

pub struct HttpAppError(pub AppError);

impl IntoResponse for HttpAppError {
    fn into_response(self) -> Response {
        let status = match self.0.level {
            NoticeLevel::Info => StatusCode::OK,
            NoticeLevel::Warning => StatusCode::BAD_REQUEST,
            NoticeLevel::Error | NoticeLevel::Fatal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(self.0)).into_response()
    }
}

impl From<AppError> for HttpAppError {
    fn from(error: AppError) -> Self { Self(error) }
}
```

- [ ] **Step 5: Add CLI and minimal server**

Create `src-tauri/src/bin/syncdock.rs` with `clap` command `serve --addr 127.0.0.1:1420 --no-open --storage-root <path>` and call `syncdock_desktop::server::serve(...)`.

Create `src-tauri/src/server/mod.rs` with:

```rust
pub mod errors;
pub mod state;

use std::net::{SocketAddr, TcpListener};
use axum::{routing::get, Router};
use crate::errors::{AppError, AppResult};
use state::{ServerConfig, ServerState};

async fn health() -> &'static str { "ok" }

pub fn default_local_storage_root() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_else(|| ".".into()).join(".syncdock")
}

pub fn build_router(state: ServerState) -> Router {
    Router::new().route("/api/health", get(health)).with_state(state)
}

pub async fn serve(config: ServerConfig) -> AppResult<SocketAddr> {
    let listener = bind_with_fallback(config.requested_addr)?;
    let addr = listener.local_addr().map_err(|e| AppError::internal(e.to_string()))?;
    listener.set_nonblocking(true).map_err(|e| AppError::internal(e.to_string()))?;
    let state = ServerState {
        storage_root: config.storage_root.clone().unwrap_or_else(default_local_storage_root),
        default_storage_root: default_local_storage_root(),
        sync_runtime: std::sync::Arc::new(crate::sync::SyncRuntimeState::default()),
        session_token: uuid::Uuid::new_v4().simple().to_string(),
    };
    if config.open_browser { let _ = open::that_detached(format!("http://{}", addr)); }
    axum::serve(tokio::net::TcpListener::from_std(listener).map_err(|e| AppError::internal(e.to_string()))?, build_router(state))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(addr)
}

fn bind_with_fallback(requested: SocketAddr) -> AppResult<TcpListener> {
    TcpListener::bind(requested)
        .or_else(|_| TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))))
        .map_err(|e| AppError::internal(e.to_string()))
}
```

- [ ] **Step 6: Verify and commit**

Run: `cd src-tauri; cargo check --bin syncdock`

Expected: PASS.

Commit:

```powershell
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/bin/syncdock.rs src-tauri/src/server
git commit -m "feat: add local web server skeleton"
```

## Task 2: Storage Outside Tauri

**Files:** `src-tauri/src/runtime/mod.rs`, `src-tauri/src/storage/paths.rs`, `src-tauri/src/storage/settings.rs`, `src-tauri/src/storage/repositories.rs`, `src-tauri/src/storage/tasks.rs`, `src-tauri/src/storage/mod.rs`, `src-tauri/tests/storage_paths.rs`

- [ ] **Step 1: Write failing tests**

Create `src-tauri/tests/storage_paths.rs`:

```rust
#[test]
fn default_local_storage_root_ends_with_dot_syncdock() {
    let root = syncdock_desktop::server::default_local_storage_root();
    assert_eq!(root.file_name().unwrap().to_string_lossy(), ".syncdock");
}

#[test]
fn local_storage_initializes_json_files() {
    let temp = tempfile::tempdir().unwrap();
    let paths = syncdock_desktop::storage::resolve_local_paths(temp.path().join(".syncdock")).unwrap();
    assert!(paths.config_file.exists());
    assert!(paths.repositories_file.exists());
    assert!(paths.tasks_file.exists());
    assert!(paths.logs_dir.exists());
}
```

Run: `cd src-tauri; cargo test --test storage_paths`

Expected: FAIL because `resolve_local_paths` is missing.

- [ ] **Step 2: Add runtime paths**

Create `src-tauri/src/runtime/mod.rs`:

```rust
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    pub default_storage_root: PathBuf,
    pub configured_storage_root: Option<PathBuf>,
}

impl RuntimePaths {
    pub fn effective_storage_root(&self) -> PathBuf {
        self.configured_storage_root.clone().unwrap_or_else(|| self.default_storage_root.clone())
    }
}
```

- [ ] **Step 3: Add path-based storage APIs**

In `paths.rs`, add:

```rust
pub fn resolve_local_paths(root: PathBuf) -> AppResult<StoragePaths> {
    let paths = build_storage_paths(root);
    prepare_base_storage(&paths)?;
    Ok(paths)
}
```

In `settings.rs`, `repositories.rs`, and `tasks.rs`, add `*_from_paths` load/save functions that use existing `load_json_or_default` and `save_json` with files from `StoragePaths`.

Export in `storage/mod.rs`:

```rust
pub use paths::{build_storage_paths, prepare_base_storage, resolve_local_paths};
pub use repositories::{load_repositories_from_paths, save_repositories_to_paths};
pub use settings::{load_settings_from_paths, save_settings_to_paths};
pub use tasks::{load_tasks_from_paths, save_tasks_to_paths};
```

- [ ] **Step 4: Verify and commit**

Run:

```powershell
cd src-tauri
cargo test --test storage_paths
cargo check --bin syncdock
```

Expected: PASS.

Commit:

```powershell
git add src-tauri/src/runtime src-tauri/src/storage src-tauri/tests/storage_paths.rs
git commit -m "refactor: support local storage paths"
```

## Task 3: Core HTTP APIs And Ownership Sorting

**Files:** `src-tauri/src/server/api.rs`, `src-tauri/src/server/mod.rs`, `src-tauri/src/models.rs`, `src-tauri/src/storage/repositories.rs`, `src-tauri/tests/http_api.rs`, `src-tauri/tests/repository_sorting.rs`

- [ ] **Step 1: Write failing API test**

Create `src-tauri/tests/http_api.rs`:

```rust
use axum::{body::Body, http::{Request, StatusCode}};
use tower::ServiceExt;

#[tokio::test]
async fn snapshot_returns_ok() {
    let temp = tempfile::tempdir().unwrap();
    let app = syncdock_desktop::server::build_router_for_tests(temp.path().join(".syncdock")).unwrap();
    let response = app.oneshot(Request::builder().uri("/api/snapshot").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
```

Add dev dependency: `tower = { version = "0.5", features = ["util"] }`.

- [ ] **Step 2: Write failing repository sorting test**

Create `src-tauri/tests/repository_sorting.rs` asserting repository ownership order is `mine`, `unassigned`, `other` after `storage::sort_repositories`.

- [ ] **Step 3: Add force ignore model fields**

Add `#[serde(default)] pub force_ignore_rules: Vec<String>` to `RepositoryRecord`, `RepositoryDraftInput`, `RepositoryUpdateInput`, and `CloneRepositoryRequest`.

Normalize rules with:

```rust
fn normalize_force_ignore_rules(rules: Vec<String>) -> Vec<String> {
    rules.into_iter().map(|rule| rule.trim().replace('\\', "/")).filter(|rule| !rule.is_empty()).collect()
}
```

- [ ] **Step 4: Sort other-author repositories last**

In `storage/repositories.rs`, compare ownership before existing status priority:

```rust
fn ownership_priority(repo: &RepositoryRecord) -> u8 {
    match repo.ownership {
        crate::models::RepositoryOwnership::Mine => 0,
        crate::models::RepositoryOwnership::Unassigned => 1,
        crate::models::RepositoryOwnership::Other => 2,
    }
}
```

- [ ] **Step 5: Implement HTTP handlers**

Create `server/api.rs` with handlers for:

```text
GET /api/snapshot
PUT /api/settings
GET /api/repositories
PUT /api/repositories/:id
```

Handlers must use `resolve_local_paths`, path-based storage functions, existing `detect_git_environment`, `AppSnapshot`, `AppSettings`, and `RepositoryRecord`.

- [ ] **Step 6: Wire routes and test router**

In `server/mod.rs`, add `pub mod api;`, route the endpoints above, and add:

```rust
pub fn build_router_for_tests(storage_root: std::path::PathBuf) -> crate::errors::AppResult<Router> {
    Ok(build_router(ServerState {
        storage_root,
        default_storage_root: default_local_storage_root(),
        sync_runtime: std::sync::Arc::new(crate::sync::SyncRuntimeState::default()),
        session_token: "test-token".into(),
    }))
}
```

- [ ] **Step 7: Verify and commit**

Run:

```powershell
cd src-tauri
cargo test --test http_api
cargo test --test repository_sorting
cargo check --bin syncdock
```

Expected: PASS.

Commit:

```powershell
git add src-tauri/Cargo.toml src-tauri/src src-tauri/tests
git commit -m "feat: add core local HTTP APIs"
```

## Task 4: Force Ignore Rules And Sync API Boundary

**Files:** `src-tauri/src/sync/force_ignore.rs`, `src-tauri/src/sync/mod.rs`, `src-tauri/src/sync/force_sync.rs`, `src-tauri/src/server/api.rs`, `src-tauri/src/server/mod.rs`, `src-tauri/tests/force_ignore_rules.rs`

- [ ] **Step 1: Write failing ignore matcher test**

Create `src-tauri/tests/force_ignore_rules.rs`:

```rust
use std::path::Path;

#[test]
fn force_ignore_rules_match_files_and_globs() {
    let rules = vec!["config/local.json".to_string(), ".env*".to_string(), "storage/**".to_string()];
    assert!(syncdock_desktop::sync::should_preserve_force_path(Path::new("config/local.json"), &rules));
    assert!(syncdock_desktop::sync::should_preserve_force_path(Path::new(".env.local"), &rules));
    assert!(syncdock_desktop::sync::should_preserve_force_path(Path::new("storage/app.db"), &rules));
    assert!(!syncdock_desktop::sync::should_preserve_force_path(Path::new("src/main.rs"), &rules));
}
```

- [ ] **Step 2: Implement matcher**

Create `sync/force_ignore.rs`:

```rust
use std::path::Path;
use globset::{Glob, GlobSetBuilder};

pub fn should_preserve_force_path(path: &Path, rules: &[String]) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let mut builder = GlobSetBuilder::new();
    for rule in rules.iter().map(|rule| rule.trim()).filter(|rule| !rule.is_empty()) {
        if let Ok(glob) = Glob::new(&rule.replace('\\', "/")) {
            builder.add(glob);
        }
    }
    builder.build().map(|set| set.is_match(normalized)).unwrap_or(false)
}
```

Export it from `sync/mod.rs`.

- [ ] **Step 3: Preserve ignored files during force sync**

In `force_sync.rs`, before `git reset --hard`, read all files matching `repo.force_ignore_rules` into memory. After a successful reset, recreate parent directories and write those bytes back. Use `walkdir`, `strip_prefix`, `std::fs::read`, and `std::fs::write`.

- [ ] **Step 4: Add sync HTTP handlers**

Add `SyncRequest { repo_ids: Option<Vec<String>>, group: Option<String> }`. Add handlers for refresh, sync, force-sync, and cancel that return `SyncTaskRecord` or `Option<String>`. They must call real sync functions, not static success JSON.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
cd src-tauri
cargo test --test force_ignore_rules
cargo test
cargo check --bin syncdock
```

Expected: PASS.

Commit:

```powershell
git add src-tauri/src/sync src-tauri/src/server src-tauri/tests/force_ignore_rules.rs
git commit -m "feat: support force update ignore rules"
```

## Task 5: Vue 3 Shell

**Files:** `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/App.vue`, `src/api/client.ts`, `src/api/types.ts`, `src/stores/appStore.ts`, `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/components.css`

- [ ] **Step 1: Replace frontend dependencies**

Remove React and `@tauri-apps/api`. Add Vue, Pinia, `@vitejs/plugin-vue`, Vitest, Vue Test Utils, and jsdom. Run `npm install`.

- [ ] **Step 2: Configure Vite**

Use Vue plugin, port `1420`, proxy `/api` to `http://127.0.0.1:1421`, and `test.environment = "jsdom"`.

- [ ] **Step 3: Create API client**

Create `src/api/types.ts` matching Rust camelCase JSON. Create `src/api/client.ts`:

```ts
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw await response.json();
  return response.json() as Promise<T>;
}
```

- [ ] **Step 4: Create Pinia store**

Store must expose `loadSnapshot`, `repositories`, `tasks`, `settings`, `groups`, `configDirectory`, `logsDirectory`, and `notice`.

- [ ] **Step 5: Create top navigation shell**

`App.vue` must render only top navigation buttons: `总览`, `任务`, `设置`. No left sidebar.

- [ ] **Step 6: Add neutral visual tokens**

Create CSS using white/near-white/black/gray, one restrained accent, radius <= 8px, compact controls, table-first layout, no gradient hero or decorative blobs.

- [ ] **Step 7: Verify and commit**

Run: `npm run build`

Expected: PASS.

Commit:

```powershell
git add package.json package-lock.json vite.config.ts tsconfig.json index.html src
git commit -m "feat: migrate frontend shell to Vue"
```

## Task 6: Overview Repository Workspace

**Files:** `src/pages/OverviewPage.vue`, `src/components/EditableSelect.vue`, `src/components/RepositoryFilters.vue`, `src/components/RepositoryTable.vue`, `src/components/RepositoryLogPanel.vue`, `src/components/ForceIgnoreRules.vue`, `src/App.vue`, `src/stores/appStore.ts`, `tests/frontend/overview.test.ts`

- [ ] **Step 1: Write failing overview test**

Create a Vitest test that mounts `RepositoryTable`, passes one `mine` repo and one `other` repo, and asserts the `other` row is last and its default action text is `强制更新`.

- [ ] **Step 2: Implement editable dropdown**

`EditableSelect.vue` must render options and an `新增` choice that accepts a new value and emits it.

- [ ] **Step 3: Implement filters**

`RepositoryFilters.vue` must use:

```css
.repo-filters {
  display: grid;
  grid-template-columns: minmax(96px, 0.33fr) minmax(96px, 0.33fr) minmax(240px, 2fr);
  gap: 8px;
}
```

- [ ] **Step 4: Implement repository table**

Show name, branch, status, group, ownership, recent sync time, and actions. Sort `other` ownership last. Use `强制更新` as default action for `other`.

- [ ] **Step 5: Implement overview page**

Overview must contain `仓库列表` and `日志`, merge repository grouping/list/filter/sync behavior, show group counts including `0`, and omit the removed helper text `仅展示名称、分支、状态与最近同步时间。`.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npx vitest run tests/frontend/overview.test.ts
npm run build
```

Expected: PASS.

Commit:

```powershell
git add src tests/frontend/overview.test.ts
git commit -m "feat: merge repositories into overview"
```

## Task 7: Simplify Tasks And Settings

**Files:** `src/pages/TasksPage.vue`, `src/pages/SettingsPage.vue`, `src/App.vue`, `src-tauri/src/models.rs`, `src-tauri/src/storage/settings.rs`, `tests/frontend/settings.test.ts`, `tests/frontend/tasks.test.ts`

- [ ] **Step 1: Write removal tests**

Settings test must assert these strings do not render: `默认启动页`, `界面主题`, `窗口关闭行为`, `启动时自动刷新状态`, `语言`, `最新版本`, `发布时间`, `检查更新`, `版本号`, `应用信息`.

Tasks test must assert `任务日志中心` does not render.

- [ ] **Step 2: Implement TasksPage**

Keep current task and task history only. Do not create standalone task log center.

- [ ] **Step 3: Implement SettingsPage**

Keep config/log directories, useful sync settings, import/export, and environment status. Put `日志文件数`, `占用空间`, `Git 说明` in environment status. Do not render removed version/update/general settings.

- [ ] **Step 4: Remove active use of deleted settings**

Remove active use of `default_view`, `theme_mode`, and `language_mode` from `AppSettings` and frontend types. Serde should ignore old JSON fields.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npx vitest run tests/frontend/settings.test.ts tests/frontend/tasks.test.ts
npm run build
cd src-tauri
cargo test
```

Expected: PASS.

Commit:

```powershell
git add src src-tauri/src/models.rs src-tauri/src/storage/settings.rs tests/frontend
git commit -m "feat: simplify tasks and settings"
```

## Task 8: Serve Web UI And Document Startup

**Files:** `src-tauri/src/server/static_files.rs`, `src-tauri/src/server/mod.rs`, `package.json`, `tests/e2e/local-web.spec.ts`, `README.md`, `BUILD.md`, `RELEASE_GUIDE.md`

- [ ] **Step 1: Add Playwright smoke test**

Create `tests/e2e/local-web.spec.ts` asserting top nav has `总览`, `任务`, and `设置`.

- [ ] **Step 2: Add static serving**

Create `server/static_files.rs`:

```rust
use std::path::PathBuf;
use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

pub fn static_router(dist_dir: PathBuf) -> Router {
    Router::new().fallback_service(ServeDir::new(&dist_dir).not_found_service(ServeFile::new(dist_dir.join("index.html"))))
}
```

Merge this router after API routes.

- [ ] **Step 3: Document startup**

Document:

```powershell
npm install
npm run build
cd src-tauri
cargo run --bin syncdock -- serve
```

Document default data directory `~/.syncdock` and that browser cache cleanup does not delete app data.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm run build
npm test
cd src-tauri
cargo test
cargo check --bin syncdock
```

Expected: PASS.

Commit:

```powershell
git add src-tauri/src/server package.json package-lock.json tests/e2e README.md BUILD.md RELEASE_GUIDE.md
git commit -m "feat: serve local web UI"
```

## Task 9: Remove Legacy React Frontend

**Files:** `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/context/AppContext.tsx`, obsolete React components/pages, `package.json`, `package-lock.json`

- [ ] **Step 1: Find legacy imports**

Run:

```powershell
Get-ChildItem -Recurse -File src | Select-String -Pattern 'react|tsx|@tauri-apps/api|invoke|listen'
```

Expected: no active Vue source depends on React or Tauri APIs.

- [ ] **Step 2: Remove obsolete files**

Use `git rm` for confirmed-unused React files:

```powershell
git rm src/main.tsx src/App.tsx src/api.ts src/context/AppContext.tsx
```

Remove obsolete React components/pages after import check.

- [ ] **Step 3: Remove old dependencies**

Ensure `package.json` has no `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, or `@tauri-apps/api`. Run `npm install`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm run build
npm test
cd src-tauri
cargo test
cargo check --bin syncdock
```

Expected: PASS.

Commit:

```powershell
git add src package.json package-lock.json
git commit -m "chore: remove legacy React frontend"
```

## Final Verification

- [ ] Run `npm run build`.
- [ ] Run `npm test`.
- [ ] Run `cd src-tauri; cargo test`.
- [ ] Run `cd src-tauri; cargo check --bin syncdock`.
- [ ] Run `cd src-tauri; cargo run --bin syncdock -- serve --no-open`.
- [ ] Open the printed local URL and verify top navigation, overview repository list/logs, removed repository page, other-author sorting/default force update, editable group/ownership dropdowns, no task log center, simplified settings, and persistent `~/.syncdock` data.

## Plan Self-Review

Spec coverage:

- Local web runtime: Tasks 1, 3, 8.
- Local storage: Task 2.
- Vue 3 rewrite: Tasks 5, 6, 7.
- Cal.com-inspired style: Tasks 5 and 6.
- Top navigation: Tasks 5 and 6.
- Overview/repository merge: Task 6.
- Other-author sorting and force default: Tasks 3, 4, 6.
- Force ignore rules: Task 4 and Task 6.
- Task log center removal: Task 7.
- Settings cleanup: Task 7.
- Static serving and docs: Task 8.
- Legacy cleanup: Task 9.

Completeness scan:

- No unresolved marker strings or empty implementation steps are present.

Type consistency:

- Rust field `force_ignore_rules` maps to JSON/TypeScript `forceIgnoreRules`.
- Removed active settings fields are absent from the Vue settings type and page.

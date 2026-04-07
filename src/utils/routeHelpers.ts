import type { ThemeMode, LanguageMode, PreferredView } from "../types";
import type { ViewKey } from "../constants";

/**
 * 规范化默认视图设置
 */
export function normalizePreferredView(view?: PreferredView | string | null): ViewKey {
  return view === "repositories" || view === "tasks" || view === "settings" ? view : "overview";
}

/**
 * 规范化主题模式设置
 */
export function normalizeThemeMode(mode?: ThemeMode | string | null): ThemeMode {
  return mode === "light" || mode === "dark" ? mode : "system";
}

/**
 * 规范化语言模式设置
 */
export function normalizeLanguageMode(mode?: LanguageMode | string | null): LanguageMode {
  return mode === "en-US" ? mode : "zh-CN";
}

/**
 * 路由相关类型
 */
export type MainRouteState = { kind: "main"; view: ViewKey };
export type RepoDetailRouteState = { kind: "repo-detail"; repoId: string; originView: ViewKey };
export type RouteState = MainRouteState | RepoDetailRouteState;
export type NavigationMode = "push" | "replace";

/**
 * 构建路由路径
 */
export function buildRoutePath(route: RouteState): string {
  return route.kind === "repo-detail" ? `/repo/${encodeURIComponent(route.repoId)}` : "/";
}

/**
 * 从 URL 读取路由状态
 */
export function readRouteStateFromLocation(): RouteState | null {
  const pathname = decodeURIComponent(window.location.pathname);
  const routeMatch = pathname.match(/^\/repo\/([^/]+)$/);
  if (routeMatch) {
    const state = parseRouteState(window.history.state);
    return {
      kind: "repo-detail",
      repoId: routeMatch[1],
      originView: state?.kind === "repo-detail" ? state.originView : "repositories"
    };
  }
  return parseRouteState(window.history.state);
}

/**
 * 解析路由状态
 */
export function parseRouteState(value: unknown): RouteState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const kind = "kind" in value ? value.kind : null;
  if (kind === "repo-detail") {
    const repoId = "repoId" in value ? value.repoId : null;
    const originView = parseViewKey("originView" in value ? value.originView : null);
    if (typeof repoId === "string" && repoId.trim() && originView) {
      return { kind, repoId, originView };
    }
    return null;
  }

  if (kind === "main") {
    const view = parseViewKey("view" in value ? value.view : null);
    return view ? { kind, view } : null;
  }

  return null;
}

/**
 * 解析视图键
 */
export function parseViewKey(value: unknown): ViewKey | null {
  return value === "overview" || value === "repositories" || value === "tasks" || value === "settings"
    ? value
    : null;
}

/**
 * 获取初始视图
 */
export function getInitialView(): ViewKey {
  const route = readRouteStateFromLocation();
  return route?.kind === "main" ? route.view : "repositories";
}

/**
 * 获取初始仓库详情路由
 */
export function getInitialRepoDetailRoute(): RepoDetailRouteState | null {
  const route = readRouteStateFromLocation();
  return route?.kind === "repo-detail" ? route : null;
}

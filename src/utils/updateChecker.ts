// 作者：凌致
import { invoke } from "@tauri-apps/api/tauri";
import tauriConfig from "../../src-tauri/tauri.conf.json";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  releaseNotes?: string;
  publishedAt?: string;
  source: "github-releases";
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}

const GITHUB_REPO_OWNER = "FaustDream";
const GITHUB_REPO_NAME = "SyncDock";
const DEFAULT_VERSION = "2.0.0";
const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;
const GITHUB_LATEST_RELEASE_PAGE = `${GITHUB_RELEASES_PAGE}/latest`;

/**
 * 从 tauri 配置获取当前版本
 */
export function getCurrentVersion(): string {
  return tauriConfig.package?.version || DEFAULT_VERSION;
}

/**
 * 比较语义化版本号
 * @returns 1 if a > b, -1 if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => {
    const match = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  };

  const versionA = parseVersion(a);
  const versionB = parseVersion(b);

  for (let i = 0; i < 3; i++) {
    if (versionA[i] > versionB[i]) return 1;
    if (versionA[i] < versionB[i]) return -1;
  }
  return 0;
}

/**
 * 从 GitHub Releases API 获取最新稳定版信息
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo> {
  const releaseApiUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;

  try {
    const response = await fetch(releaseApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "SyncDock-Update-Checker"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const release: GitHubRelease = await response.json();
    const latestVersion = release.tag_name.replace(/^v/, "");
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    return {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseUrl: release.html_url || GITHUB_LATEST_RELEASE_PAGE,
      releaseNotes: release.body,
      publishedAt: release.published_at,
      source: "github-releases"
    };
  } catch (error) {
    console.error("Failed to check for updates:", error);
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: GITHUB_LATEST_RELEASE_PAGE,
      source: "github-releases"
    };
  }
}

/**
 * 打开外部链接
 */
export async function openReleasePage(url: string): Promise<void> {
  try {
    await invoke("open_external", { target: url });
  } catch (error) {
    console.error("Failed to open release page:", error);
    window.open(url, "_blank");
  }
}



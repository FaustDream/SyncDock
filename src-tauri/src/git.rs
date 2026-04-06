use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};


use chrono::Utc;
use wait_timeout::ChildExt;
use walkdir::{DirEntry, WalkDir};

use crate::{
    errors::{AppError, AppResult},
    models::{AppSettings, GitEnvironment, NoticeLevel, RepositoryStatus, ScannedRepository},
};

#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone)]
pub struct RepositoryInspection {
    pub normalized_path: String,
    pub name: String,
    pub remote_url: Option<String>,
    pub status: RepositoryStatus,
}

pub fn detect_git_environment() -> GitEnvironment {
    let checked_at = Utc::now().to_rfc3339();
    match which::which("git") {
        Ok(path) => match run_command("git", &["--version"], None, Duration::from_secs(10)) {
            Ok(output) if output.success => GitEnvironment {
                available: true,
                version: Some(output.stdout.trim().to_string()),
                executable_path: Some(path.to_string_lossy().to_string()),
                message: "Git 环境可用".into(),
                checked_at,
            },
            Ok(output) => GitEnvironment {
                available: false,
                version: None,
                executable_path: Some(path.to_string_lossy().to_string()),
                message: output.stderr.trim().to_string(),
                checked_at,
            },
            Err(error) => GitEnvironment {
                available: false,
                version: None,
                executable_path: Some(path.to_string_lossy().to_string()),
                message: error.message,
                checked_at,
            },
        },
        Err(_) => GitEnvironment {
            available: false,
            version: None,
            executable_path: None,
            message: "未检测到 Git，请先安装 Git。".into(),
            checked_at,
        },
    }
}

pub fn normalize_existing_path(path: &str) -> AppResult<String> {
    let raw = PathBuf::from(path.trim());
    if !raw.exists() {
        return Err(
            AppError::new(
                "SD-FS-001",
                NoticeLevel::Warning,
                "路径不存在",
                "仓库路径不存在，已跳过该仓库。",
            )
            .with_action("重新定位仓库或移除条目")
            .with_detail(path.to_string()),
        );
    }

    let normalized = dunce::canonicalize(&raw).map_err(|error| {
        AppError::new(
            "SD-FS-002",
            NoticeLevel::Error,
            "路径无访问权限",
            "无法访问该仓库路径，请检查目录权限。",
        )
        .with_action("以可访问权限重新打开")
        .with_detail(error.to_string())
    })?;

    Ok(normalized.to_string_lossy().to_string())
}

pub fn inspect_repository(path: &str, _settings: &AppSettings) -> AppResult<RepositoryInspection> {
    let normalized_path = normalize_existing_path(path)?;
    ensure_git_available()?;

    let health_output = run_git(
        Some(&normalized_path),
        &["rev-parse", "--is-inside-work-tree"],
        Duration::from_secs(10),
    )?;

    if !health_output.success || health_output.stdout.trim() != "true" {
        return Err(
            AppError::new(
                "SD-REPO-001",
                NoticeLevel::Warning,
                "不是有效仓库",
                "该目录不是有效的 Git 仓库，已跳过。",
            )
            .with_action("检查仓库路径")
            .with_detail(health_output.stderr),
        );
    }

    let branch_output = run_git(
        Some(&normalized_path),
        &["branch", "--show-current"],
        Duration::from_secs(10),
    )?;
    let branch = branch_output.stdout.trim().to_string();
    let detached_head = branch.is_empty();
    let current_branch = if detached_head {
        "detached-head".to_string()
    } else {
        branch.clone()
    };

    let git_dir_output = run_git(
        Some(&normalized_path),
        &["rev-parse", "--git-dir"],
        Duration::from_secs(10),
    )?;
    let git_dir_raw = git_dir_output.stdout.trim();
    let git_dir = if Path::new(git_dir_raw).is_absolute() {
        PathBuf::from(git_dir_raw)
    } else {
        PathBuf::from(&normalized_path).join(git_dir_raw)
    };
    let in_progress_operation = git_dir.join("MERGE_HEAD").exists()
        || git_dir.join("rebase-merge").exists()
        || git_dir.join("rebase-apply").exists()
        || git_dir.join("CHERRY_PICK_HEAD").exists();

    let status_output = run_git(
        Some(&normalized_path),
        &["status", "--porcelain"],
        Duration::from_secs(10),
    )?;

    let mut has_uncommitted_changes = false;
    let mut has_untracked_files = false;
    let mut untracked_count = 0usize;
    for line in status_output.stdout.lines() {
        if line.starts_with("??") {
            has_untracked_files = true;
            untracked_count += 1;
        } else if !line.trim().is_empty() {
            has_uncommitted_changes = true;
        }
    }

    let upstream_name_output = run_git(
        Some(&normalized_path),
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        Duration::from_secs(10),
    );

    let (upstream_configured, upstream_name) = match upstream_name_output {
        Ok(output) if output.success => (true, Some(output.stdout.trim().to_string())),
        _ => (false, None),
    };

    let mut ahead_count = 0usize;
    let mut behind_count = 0usize;
    if upstream_configured {
        if let Ok(output) = run_git(
            Some(&normalized_path),
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            Duration::from_secs(10),
        ) {
            if output.success {
                let parts = output.stdout.split_whitespace().collect::<Vec<_>>();
                if parts.len() == 2 {
                    ahead_count = parts[0].parse::<usize>().unwrap_or(0);
                    behind_count = parts[1].parse::<usize>().unwrap_or(0);
                }
            }
        }
    }

    let remote_url = if let Some(branch_name) = (!detached_head).then_some(branch.clone()) {
        match run_git(
            Some(&normalized_path),
            &["config", "--get", &format!("branch.{branch_name}.remote")],
            Duration::from_secs(10),
        ) {
            Ok(output) if output.success => {
                let remote_name = output.stdout.trim().to_string();
                if remote_name.is_empty() {
                    None
                } else {
                    match run_git(
                        Some(&normalized_path),
                        &["remote", "get-url", &remote_name],
                        Duration::from_secs(10),
                    ) {
                        Ok(url_output) if url_output.success => {
                            Some(url_output.stdout.trim().to_string())
                        }
                        _ => None,
                    }
                }
            }
            _ => None,
        }
    } else {
        None
    };

    let sync_required = behind_count > 0;
    let status_text = if in_progress_operation {
        "处理中断".to_string()
    } else if detached_head {
        "Detached HEAD".to_string()
    } else if has_uncommitted_changes {
        "存在未提交修改".to_string()
    } else if has_untracked_files {
        "存在未跟踪文件".to_string()
    } else if !upstream_configured {
        "未配置 upstream".to_string()
    } else if sync_required {
        format!("待同步，落后 {behind_count} 提交")
    } else if ahead_count > 0 {
        format!("本地领先 {ahead_count} 提交")
    } else {
        "状态正常".to_string()
    };

    Ok(RepositoryInspection {
        normalized_path: normalized_path.clone(),
        name: Path::new(&normalized_path)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| normalized_path.clone()),
        remote_url,
        status: RepositoryStatus {
            repo_healthy: true,
            current_branch,
            upstream_configured,
            upstream_name,
            has_uncommitted_changes,
            has_untracked_files,
            untracked_count,
            ahead_count,
            behind_count,
            sync_required,
            detached_head,
            in_progress_operation,
            status_text,
            last_checked_at: Some(Utc::now().to_rfc3339()),
        },
    })
}

pub fn scan_repositories(
    root_path: &str,
    max_depth: usize,
    settings: &AppSettings,
) -> AppResult<Vec<ScannedRepository>> {
    ensure_git_available()?;
    let normalized_root = normalize_existing_path(root_path)?;
    let ignored = settings
        .ignored_directories
        .iter()
        .map(|item| item.to_lowercase())
        .collect::<HashSet<_>>();

    let mut paths = HashSet::new();
    let mut repos = Vec::new();

    let should_keep = |entry: &DirEntry| {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if entry.depth() == 0 {
            return true;
        }
        !ignored.contains(&name)
    };

    for entry in WalkDir::new(&normalized_root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(should_keep)
        .filter_map(Result::ok)
    {
        let name = entry.file_name().to_string_lossy();
        if name != ".git" {
            continue;
        }

        let Some(parent) = entry.path().parent() else {
            continue;
        };

        let parent_str = parent.to_string_lossy().to_string();
        if !paths.insert(parent_str.clone()) {
            continue;
        }

        if let Ok(inspection) = inspect_repository(&parent_str, settings) {
            repos.push(ScannedRepository {
                path: inspection.normalized_path,
                name: inspection.name,
                current_branch: inspection.status.current_branch,
                remote_url: inspection.remote_url,
                group: "未分组".into(),
                status: inspection.status.status_text,
                selected: true,
            });
        }
    }

    repos.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(repos)
}

pub fn clone_repository(
    request: &crate::models::CloneRepositoryRequest,
    settings: &AppSettings,
) -> AppResult<String> {
    ensure_git_available()?;
    let destination_parent = normalize_existing_path(&request.destination_parent)?;

    let directory_name = request
        .directory_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| derive_repo_directory_name(&request.remote_url));

    let target_path = Path::new(&destination_parent).join(directory_name);
    if target_path.exists() {
        return Err(
            AppError::new(
                "SD-FS-001",
                NoticeLevel::Warning,
                "路径不存在",
                "目标目录已存在，请更换目录名称或目标位置。",
            )
            .with_action("重新选择目录")
            .with_detail(target_path.to_string_lossy().to_string()),
        );
    }

    let timeout = Duration::from_secs(settings.command_timeout_secs.max(20));
    let target_path_string = target_path.to_string_lossy().to_string();
    let output = run_command(
        "git",
        &["clone", request.remote_url.as_str(), target_path_string.as_str()],
        None,
        timeout,
    )?;


    if !output.success {
        return Err(classify_git_failure("clone", &output.stderr, output.exit_code).with_detail(output.stderr));
    }

    Ok(target_path.to_string_lossy().to_string())
}

fn derive_repo_directory_name(remote_url: &str) -> String {
    remote_url
        .rsplit('/')
        .next()
        .unwrap_or("repository")
        .trim_end_matches(".git")
        .to_string()
}

fn ensure_git_available() -> AppResult<()> {
    let env = detect_git_environment();
    if env.available {
        return Ok(());
    }

    Err(
        AppError::new(
            "SD-ENV-001",
            NoticeLevel::Fatal,
            "未检测到 Git",
            "未检测到 Git，请先安装 Git 后再启动同步坞。",
        )
        .with_action("安装 Git")
        .with_detail(env.message),
    )
}

pub fn run_git(cwd: Option<&str>, args: &[&str], timeout: Duration) -> AppResult<CommandOutput> {
    run_git_with_cancel(cwd, args, timeout, None)
}

pub fn run_git_with_cancel(
    cwd: Option<&str>,
    args: &[&str],
    timeout: Duration,
    cancel_requested: Option<&AtomicBool>,
) -> AppResult<CommandOutput> {
    run_command_with_cancel("git", args, cwd, timeout, cancel_requested)
}

pub fn run_command(
    program: &str,
    args: &[&str],
    cwd: Option<&str>,
    timeout: Duration,
) -> AppResult<CommandOutput> {
    run_command_with_cancel(program, args, cwd, timeout, None)
}

pub fn run_command_with_cancel(
    program: &str,
    args: &[&str],
    cwd: Option<&str>,
    timeout: Duration,
    cancel_requested: Option<&AtomicBool>,
) -> AppResult<CommandOutput> {
    let started = Instant::now();
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0");

    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    let mut child = command.spawn().map_err(|error| {
        AppError::new(
            "SD-ENV-002",
            NoticeLevel::Fatal,
            "Git 不可执行",
            "已检测到 Git，但当前无法执行，请检查安装路径或权限设置。",
        )
        .with_action("重新检测 Git")
        .with_detail(error.to_string())
    })?;

    let poll_interval = Duration::from_millis(200);
    let mut timed_out = false;
    let mut cancelled = false;

    loop {
        if cancel_requested
            .map(|flag| flag.load(Ordering::SeqCst))
            .unwrap_or(false)
        {
            cancelled = true;
            let _ = child.kill();
            break;
        }

        let elapsed = started.elapsed();
        if elapsed >= timeout {
            timed_out = true;
            let _ = child.kill();
            break;
        }

        let wait_for = std::cmp::min(timeout.saturating_sub(elapsed), poll_interval);
        if child.wait_timeout(wait_for)?.is_some() {
            break;
        }
    }

    let output = child.wait_with_output()?;
    let duration_ms = started.elapsed().as_millis();

    if cancelled {
        return Err(cancelled_sync_error(program, args));
    }

    if timed_out {
        return Err(
            AppError::new(
                "SD-SYNC-004",
                NoticeLevel::Error,
                "同步超时",
                "同步超时，任务已停止。",
            )
            .with_action("重试或检查网络和仓库状态")
            .with_detail(format!("{program} {:?} timeout after {}s", args, timeout.as_secs()))
            .retryable(true),
        );
    }

    Ok(CommandOutput {
        success: output.status.success(),
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        duration_ms,
    })
}


pub fn cancelled_sync_error(program: &str, args: &[&str]) -> AppError {
    AppError::new(
        "SD-SYNC-006",
        NoticeLevel::Warning,
        "同步被取消",
        "同步任务已取消。",
    )
    .with_action("重新发起同步")
    .with_detail(format!("{program} {:?} cancelled by user", args))
}

pub fn classify_git_failure(stage: &str, stderr: &str, exit_code: i32) -> AppError {

    let lower = stderr.to_lowercase();

    if lower.contains("permission denied (publickey)") || lower.contains("ssh key") {
        return AppError::new(
            "SD-AUTH-001",
            NoticeLevel::Error,
            "SSH 鉴权失败",
            "远端 SSH 鉴权失败，请检查 SSH key 或 agent 配置。",
        )
        .with_action("检查 SSH 配置")
        .retryable(false);
    }

    if lower.contains("authentication failed")
        || lower.contains("terminal prompts disabled")
        || lower.contains("could not read username")
        || lower.contains("credential")
    {
        return AppError::new(
            "SD-AUTH-002",
            NoticeLevel::Error,
            "HTTPS 凭证失效",
            "远端凭证无效或已过期，请重新登录或更新凭证。",
        )
        .with_action("更新凭证")
        .retryable(false);
    }

    if lower.contains("could not resolve host")
        || lower.contains("failed to connect")
        || lower.contains("connection refused")
        || lower.contains("network is unreachable")
    {
        return AppError::new(
            "SD-NET-001",
            NoticeLevel::Error,
            "网络连接失败",
            "无法连接远端服务，请检查网络或代理设置。",
        )
        .with_action("检查网络后重试")
        .retryable(true);
    }

    if lower.contains("timed out") {
        return AppError::new(
            "SD-NET-002",
            NoticeLevel::Error,
            "网络超时",
            "远端响应超时，请稍后重试。",
        )
        .with_action("稍后重试")
        .retryable(true);
    }

    if stage == "pull" {
        return AppError::new(
            "SD-SYNC-003",
            NoticeLevel::Error,
            "无法快进拉取",
            "当前分支无法 fast-forward，请先手动处理分支差异。",
        )
        .with_action("打开仓库处理后再重试")
        .with_detail(format!("exit code {exit_code}: {stderr}"));
    }

    AppError::new(
        "SD-SYNC-002",
        NoticeLevel::Error,
        "获取远端更新失败",
        "获取远端更新失败，请检查网络或鉴权状态。",
    )
    .with_action("稍后重试")
    .with_detail(format!("exit code {exit_code}: {stderr}"))
    .retryable(true)
}

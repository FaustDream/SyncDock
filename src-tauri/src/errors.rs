use std::fmt;

use serde::Serialize;



use crate::models::{InlineNotice, NoticeLevel};


pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub level: NoticeLevel,
    pub title: String,
    pub message: String,
    pub action: Option<String>,
    pub detail: Option<String>,
    pub repo_id: Option<String>,
    pub task_id: Option<String>,
    pub retryable: bool,
}

impl AppError {
    pub fn new(
        code: impl Into<String>,
        level: NoticeLevel,
        title: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            level,
            title: title.into(),
            message: message.into(),
            action: None,
            detail: None,
            repo_id: None,
            task_id: None,
            retryable: false,
        }
    }

    pub fn with_action(mut self, action: impl Into<String>) -> Self {
        self.action = Some(action.into());
        self
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn with_repo_id(mut self, repo_id: impl Into<String>) -> Self {
        self.repo_id = Some(repo_id.into());
        self
    }

    pub fn with_task_id(mut self, task_id: impl Into<String>) -> Self {
        self.task_id = Some(task_id.into());
        self
    }

    pub fn retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn into_inline_notice(self) -> InlineNotice {
        InlineNotice {
            code: self.code,
            level: self.level,
            title: self.title,
            message: self.message,
            action: self.action,
            detail: self.detail,
            repo_id: self.repo_id,
            task_id: self.task_id,
            retryable: self.retryable,
        }
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new(
            "SD-INT-001",
            NoticeLevel::Error,
            "未分类内部错误",
            "发生未预期问题，请查看日志或重试。",
        )
        .with_detail(detail)
    }
}


impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        AppError::internal(value.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        AppError::internal(value.to_string())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}


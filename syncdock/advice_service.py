from __future__ import annotations


def get_sync_suggestion(message: str) -> str | None:
    if "网络连接异常" in message:
        return "检查网络、VPN、代理或远端地址"
    if "没有权限访问仓库" in message:
        return "检查仓库权限、SSH 密钥或访问令牌"
    if "需要手动处理分支差异" in message:
        return "先人工处理分支分叉，再重新同步"
    if "当前分支未设置同步目标" in message:
        return "先为当前分支设置 upstream"
    if "当前不在分支上" in message:
        return "切回正常分支后再操作"
    if "有未提交修改" in message:
        return "先提交、暂存或清理本地修改"
    if "有未跟踪文件" in message:
        return "先清理未跟踪文件或加入版本管理"
    if "路径不存在" in message:
        return "检查配置中的仓库路径是否正确"
    if "不是 Git 仓库" in message:
        return "确认路径指向 Git 仓库根目录"
    if "Git 执行超时" in message:
        return "检查网络或增大超时时间后重试"
    if "查询远端状态失败" in message:
        return "先排查远端连接问题，再重新查询状态"
    if "本地有未推送提交" in message:
        return "确认后手动推送，或改用强制同步策略"
    if "需要强制同步" in message:
        return "同步时会直接覆盖本地内容，请确认无需保留本地改动"
    if "需要同步" in message:
        return "可直接执行同步"
    if "Git 命令执行失败" in message:
        return "检查远端配置或手动执行 Git 命令确认原因"
    return None


def append_sync_suggestion(message: str) -> str:
    suggestion = get_sync_suggestion(message)
    if suggestion is None:
        return message
    return f"{message}；建议：{suggestion}"

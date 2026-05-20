"""测试前端渲染中的文本转义约束。"""

from pathlib import Path


INDEX_HTML = Path(__file__).resolve().parents[1] / "syncdock" / "gui" / "static" / "index.html"


def test_index_html_uses_escape_helper_for_untrusted_text():
    """仓库配置、状态文本和日志来自本地文件/接口，写入 innerHTML 前必须转义。"""
    html = INDEX_HTML.read_text(encoding="utf-8")

    assert "function escapeHtml" in html
    assert "const safeName = escapeHtml(r.name);" in html
    assert "const safePath = escapeHtml(r.path);" in html
    assert "const safeDetail = escapeHtml(detail);" in html
    assert "escapeHtml(text)" in html
    assert "escapeHtml(line)" in html
    assert "'local_status_failed': 0" in html
    assert "'branch_compare_failed': 0" in html
    assert "data.outcome === 'NEEDS_SYNC'" in html
    assert "data.status_code" in html

    assert "${r.name}</span>" not in html
    assert "${r.path}</span>" not in html
    assert "${line}</div>" not in html

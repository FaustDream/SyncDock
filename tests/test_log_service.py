from syncdock.log_service import render_summary


def test_render_summary_returns_simple_chinese_totals():
    text = render_summary(total=5, updated=2, up_to_date=1, skipped=1, failed=1, invalid=0)

    assert "同步完成" in text
    assert "总仓库数：5" in text
    assert "已同步：2" in text
    assert "失败：1" in text

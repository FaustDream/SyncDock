from syncdock.menu import render_main_menu


def test_render_main_menu_contains_required_options():
    text = render_main_menu()

    assert "1. 同步全部仓库" in text
    assert "2. 同步指定仓库" in text
    assert "3. 查看仓库状态" in text
    assert "4. 查看最近日志" in text
    assert "5. 重新加载配置" in text
    assert "0. 退出" in text


def test_handle_menu_choice_returns_exit_for_zero():
    from syncdock.menu import handle_menu_choice

    assert handle_menu_choice("0") == "exit"

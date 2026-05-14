' SyncDock 5.0 — 静默启动器（无窗口）
' 双击此文件启动服务器并打开浏览器

CreateObject("WScript.Shell").Run "py -3 gui_launcher.py", 0, False

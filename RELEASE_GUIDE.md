# SyncDock v2.0.0 发布指南

## 发布内容

- Windows 安装版
- Windows 免安装版压缩包
- `docs/v2.0.0` 文档集

## 产物位置

- 安装版目录：`Releases\v2.0.0\installer\`
- 免安装版压缩包：`Releases\v2.0.0\SyncDock_2.0.0_x64_portable.zip`

## 推荐发布步骤

1. 执行 `build-release.bat`
2. 检查安装版是否可正常运行
3. 检查免安装版是否可正常解压并启动
4. 核对 `docs/v2.0.0` 是否齐全
5. 再执行 `release-upload.bat` 或手动上传到 GitHub Release

## 上传说明

- Release tag：`v2.0.0`
- Release title：`SyncDock v2.0.0`
- 附件建议：
  - `installer` 目录中的安装包
  - `SyncDock_2.0.0_x64_portable.zip`


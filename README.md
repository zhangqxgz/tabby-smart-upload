# tabby-smart-upload（智能上传）

Tabby 插件，解决上传体验的两个痛点：

1. **上传找不到当前目录** —— 无需手动改远端 shell 配置。SSH 会话建立后自动注入
   OSC 1337 目录上报钩子（bash / zsh；仅当前会话生效，不动 dotfiles），
   内置 SFTP 面板打开时自动落在当前目录，「上传到当前目录」直接可用。
2. **传输进度界面差** —— 传输中心汇聚全部传输（含内置 SFTP 面板与拖拽发起的），
   提供总进度、逐文件进度、速度、ETA、状态与取消，最新传输在最上面。

## 功能

- **目录自动感知（CWD）**
  - 会话建立后自动注入紧凑单行钩子（bash / zsh 通用，幂等、可读、无 base64）
  - 远端 dotfiles 已配置过上报的主机会**自动跳过注入（零回显）**
  - 点击上传时按需探测一次当前目录（发不可见的 OSC 查询），钩子未生效也不会误弹路径框
  - tmux 内自动走 DCS 透传（tmux ≥3.3 需 `set -g allow-passthrough on`）
- **上传到当前目录**：工具栏按钮 / `Ctrl-Shift-U` / 标签页右键菜单
  - 目录解析顺序：终端实际上报 → 按需探测 → 按主机记忆 → 弹窗询问（默认 profile cwd）
  - 上传走 `.tabby-upload` 临时文件 + rename，失败不污染目标文件
- **拖拽上传**：把文件或整个文件夹拖到 SSH 终端区域即上传到当前目录
  - 拖动时底部提示「松手上传到当前目录」；分屏下按拖入的面板定位
  - 文件夹递归创建并上传；与 SFTP 面板拖放、标签页拖拽互不干扰
- **传输中心**：工具栏按钮 / `Ctrl-Shift-Y`
  - 订阅 Tabby 的 `fileTransferStarted$`，内置面板 / 拖拽 / 插件自身的传输全部可见
  - 总速度、逐文件速度 / ETA / 状态、取消、清除已完成；**最新传输在最上**
  - 可选：让 Tabby 自带的传输下拉也按最新在前排序（设置项，默认开）
- **设置页**：注入开关、失败提示、自动弹出传输中心、完成通知、并发数、按主机记忆、
  手动配置片段（bash/zsh 通用 + fish 专用）一键复制

## 安装

Tabby → 设置 → 插件 → 搜索 `tabby-smart-upload`（发布到 npm 后）。

开发调试见 [docs/2026-10-25-开发调试手册.md](docs/2026-10-25-开发调试手册.md)。

仓库：https://github.com/zhangqxgz/tabby-smart-upload （MIT）

## 手动目录上报（fish 或自动注入失败时）

把设置页对应片段加入远端 shell 配置文件后重新登录：

- bash / zsh：通用片段（自动注入使用的同一段），加入 `~/.bashrc` 或 `~/.zshrc`
- fish：`~/.config/fish/config.fish`（fish 语法与 POSIX shell 不兼容，不支持自动注入）

配置过 dotfiles 后，插件检测到远端已自行上报会跳过注入，连接时零回显。

## 环境要求

- Tabby ≥ 1.0.2xx（在 1.0.238 上实测；依赖 OSC 1337 解析与 `fileTransferStarted$`，建议保持最新版）
- 远端 shell 为 bash / zsh（fish 需手动配置；非 POSIX shell 仅支持点击时探测）

## 构建

```bash
npm install
npm run build     # 产出 dist/index.js
npm run watch     # 开发监听
```

Windows 宿主机部署（Junction，重启 Tabby 生效）：

```powershell
.\use-in-tabby.ps1 -RestartTabby
```

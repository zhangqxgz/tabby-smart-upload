# tabby-smart-upload（智能上传）

Tabby 插件，解决两个痛点：

1. **上传找不到当前目录** —— 无需再手动改远端 shell 配置。SSH 会话建立后自动向远端
   shell（bash/zsh/fish）注入 OSC 1337 目录上报钩子（仅当前会话生效，不动 dotfiles），
   之后内置 SFTP 面板打开时自动落在当前目录，「上传到当前目录」也直接可用。
2. **上传进度界面差** —— 传输中心汇聚全部传输（含内置 SFTP 面板发起的），
   提供总进度、逐文件进度、速度、ETA、状态与取消。

## 功能

- **目录自动感知（CWD）**：会话建立 1.2s 后自动注入；16s 内未生效则按主机提示一次；
  tmux 内自动走 DCS 透传（tmux ≥3.3 需 `set -g allow-passthrough on`）。
- **上传到当前目录**：工具栏按钮 / `Ctrl-Shift-U` / 标签页右键菜单。
  目录解析顺序：终端实际上报目录 → 按主机记忆 → 弹窗询问（默认取 profile 的 cwd）。
  上传走 `.tabby-upload` 临时文件 + rename，失败不污染目标文件。
- **传输中心**：工具栏按钮 / `Ctrl-Shift-Y`；订阅 Tabby 的 `fileTransferStarted$`，
  内置 SFTP 面板、拖拽、本插件的传输全部可见；可取消、可清除已完成。
- 设置页：注入开关、失败提示、自动弹出、完成通知、并发数、按主机记忆等。

## 安装

Tabby → 设置 → 插件 → 搜索 `tabby-smart-upload`（发布到 npm 后）。

开发调试见 [docs/2026-10-25-开发调试手册.md](docs/2026-10-25-开发调试手册.md)。

仓库：https://github.com/zhangqxgz/tabby-smart-upload （MIT）

## 手动目录上报（自动注入失败时）

把设置页里的片段加入远端 `~/.bashrc` / `~/.zshrc` 等并重新登录即可，三个 shell 通用。

## 环境要求

- Tabby ≥ 1.0.2xx（依赖 OSC 1337 解析与 `fileTransferStarted$`，建议保持最新版）
- 远端有 `base64`（无则使用上面的手动配置方式）

## 构建

```bash
npm install
npm run build     # 产出 dist/index.js
npm run watch     # 开发监听
```

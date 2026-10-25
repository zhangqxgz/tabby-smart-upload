# tabby-smart-upload（智能上传插件）项目记忆

## 项目概述
- 位置：`/mnt/c/dev/code/tabby-upload-plugin`（Windows: `C:\dev\code\tabby-upload-plugin`）
- 用途：Tabby 插件，解决①上传找不到当前目录②进度界面差两个痛点
- 方案：独立插件（不改内置 tabby-ssh），两模块——A: SSH 会话建立后自动注入 OSC 1337 CWD 上报钩子；B: 传输中心（订阅 `fileTransferStarted$` 汇聚全部传输）+「上传到当前目录」链路
- 开发时间：2026-10-24

## 构建环境（WSL）
- WSL 无系统 Node；便携 Node v22.17.0 在 `/tmp/opencode/node`（重启即失，重装见 docs/2026-10-24-开发调试手册.md 第二节）
- Windows 宿主 Node：`C:\nvm4w\nodejs\node.exe`（v24.16.0）
- npm 必须走 `https://registry.npmmirror.com`（WSL 直连 GitHub/npm 官方不通；NAS 代理 192.168.50.36:7890 备用）
- 构建：`export PATH=/tmp/opencode/node/bin:$PATH && npm run build`（webpack 5 + ts-loader，产物 dist/index.js）

## 关键技术要点（勿踩坑）
- Tabby 插件 = npm 包（`tabby-plugin` keyword）默认导出 NgModule；`/^tabby-/`、`@angular`、`@ng-bootstrap`、`rxjs` 全部 external，运行时共享宿主实例（webpack.plugin.config.mjs 的既有约定）
- 用户插件目录：`%APPDATA%\tabby\plugins\node_modules\tabby-*`（Tabby 宿主机在 Windows；userPluginsPath = userData/plugins）
- 部署：`use-in-tabby.ps1`（Junction 模式推荐，npm run watch + 重启 Tabby 生效）；验证 = 设置→插件出现 Smart Upload + DevTools 见 `[smart-upload] module loaded`
- **tabby-ssh 的 npm 类型声明不导出 SSHTabComponent**（master 源码有）→ 一律用鸭式判断 `'sshSession' in tab` + 本地结构化接口，不 import 该类
- npm 版 tabby-* typings 滞后源码（如 FileTransfer 无 getStatus）→ 防御式 `(x as any).method?.()`
- Tabby 原生 i18n .po 不含插件键（缺失回显 key）→ 自带 I18nService 词典（zh*/en），按 `config.store.language` 切换
- CWD 注入：` eval "$(printf %s '<b64>' | base64 -d)" 2>/dev/null # tabby-smart-upload\n`，会话建立 1.2s 后经 `session.feedFromTerminal` 写入；轮询 `getWorkingDirectory()` 16s 验证；失败按主机（user@host:port）提示一次记入 failedHosts
- bash hook 前置拼接 PROMPT_COMMAND（尾插遇空值/尾分号会语法错误）；tmux 走 DCS 透传（tmux≥3.3 需 allow-passthrough on）；fish 用 --on-event fish_prompt
- 模态组件：NgbModal.open + 插件 module declarations 即可（插件模块会注入为根模块依赖，组件工厂可解析）；样式用 ViewEncapsulation.None + `su-`/`su-tc-` 前缀
- 上传复用内置 `SFTPSession.upload`（.tabby-upload 临时文件 + rename）；openSFTP() 每连接实际复用同一 SFTP 通道

## 当前状态
- [x] M1 骨架（模块/设置页/i18n/工具栏按钮）
- [x] M2 CWD 自动注入 + 验证回退
- [x] M3 传输中心（聚合内置传输）
- [x] M4 上传到当前目录（cwd→按主机记忆→弹窗；并发 1-8）
- [ ] M5 打磨：npm 发布、（可选）文件夹上传、真机回归
- 构建通过（webpack production，13 个 TS 错误已清零）

## 约定
- 内部文档命名：`docs/YYYY-MM-DD-中文标题.md`
- 默认热键：上传到当前目录 `Ctrl-Shift-U`；传输中心 `Ctrl-Shift-Y`（可在 Tabby 设置改绑）
- 配置存 Tabby config.yaml 的 `smartUpload:` 段（ConfigProvider defaults 必须写全，漏键 ConfigProxy 不建 accessor 会存不住）
- git 尚未初始化（用户未要求）；发布仓库预留 github.com/zhangqxgz/tabby-smart-upload

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
- **TDZ 坑（真机实测）**：service ↔ component 循环依赖（service 里 ngbModal.open(组件) + 组件构造器 DI 该 service）打包后报 `Cannot access 'X' before initialization`；解法 = service 只发 openRequested$ Subject，组件文件导出 bridgeTransferCenterUi()，模块构造函数接线；无头验证用 scripts/cdp-check.mjs（Tabby 加 --remote-debugging-port=9223，Windows 侧 node 运行，看 UPLOAD_ICON_IN_DOM: true）
- Tabby 原生 i18n .po 不含插件键（缺失回显 key）→ 自带 I18nService 词典（zh*/en），按 `config.store.language` 切换
- CWD 自动配置（silentSetup 默认开）：**首选 SFTP 静默写入远端 ~/.bashrc / ~/.zshrc**（受管块带 `# >>> tabby-smart-upload >>>` 标记 + 首次修改前 `.tabby-smart-upload.bak` 备份 + 保留原 mode），连接零回显；失败才回退终端注入。远端已有标记/已自行上报 → 跳过。上传点击时 probeCwd 兜底（当前会话无钩子时也能定位）
- **交互式守卫**：bash 在非交互 ssh 远程命令里也会 source ~/.bashrc → 片段用 `case $- in *i*)` 包住，避免 OSC 字节污染 `ssh host cmd` 输出（Ubuntu 默认 .bashrc 顶部也有 return 守卫，双保险）
- 终端注入兜底：紧凑单行（无 base64，约 430 字符）+ 幂等守卫；SSHShellSession.write 在 shell 未就绪时**静默丢弃**、sessionChanged$ 早于认证 → 重试 8 次 × 2s；失败按主机提示一次记入 failedHosts
- **shell 语法解析坑（真机实测）**：shell 会先完整解析整段代码再执行分支——fish 的 `function --on-event`/`end` 在 bash 中是语法错误，混在一个片段里会让**整个 eval 失败**（bash 分支也不执行）。自动注入只放 bash+zsh（互可解析）；fish 只能在设置页手动配置（buildFishSnippet）
- **拖拽重复记录坑（1.0.238）**：内置 `startUploadFromDragEvent` 会自己 `fileTransferStarted.next()`，插件不能再 `_registerFileTransfer`（否则一条文件两条记录）；文件夹选择器 `startUploadDirectory → getAllFiles` 不登记，需要补登记 → 统一用 `TransferCenterService.hasTransfer()` 判重后再登记
- **Tabby Vault 锁定时**：SSH 标签页显示 Reconnect，reconnect() 会卡在等主密码，session 始终为 null；CDP 验证脚本默认**不重载页面**（RELOAD=1 才重载），避免断开用户会话
- **点击上传时按需探测 CWD**（probeCwd）：钩子要等下一次提示符才上报，刚连接/钩子失效时会误弹路径框 → 点击后发 ` printf '\033]1337;CurrentDir=%s\007' "$PWD"`（Tabby 拦截 OSC 不上屏，仅命令行回显），150ms 轮询取回；探测失败才走记忆/弹窗
- bash hook 前置拼接 PROMPT_COMMAND（尾插遇空值/尾分号会语法错误）；tmux 走 DCS 透传（tmux≥3.3 需 allow-passthrough on）；fish 用 --on-event fish_prompt
- 模态组件：NgbModal.open + 插件 module declarations 即可（插件模块会注入为根模块依赖，组件工厂可解析）；样式用 ViewEncapsulation.None + `su-`/`su-tc-` 前缀
- 上传复用内置 `SFTPSession.upload`（.tabby-upload 临时文件 + rename）；openSFTP() 每连接实际复用同一 SFTP 通道
- **拖拽上传**（dropZone.service）：document 捕获阶段监听，命中检测 `div.terminal`、排除 `sftp-panel,[dropzone]`；用 hostView.rootNodes 反查 DOM 到具体 tab（分屏精确定位）；目录树递归 mkdir + 上传
- **上传增强**：同名冲突策略（overwrite/skip/rename，stat 判重）、文件夹选择上传（startUploadDirectory + 递归树）、失败重试（ElectronFileUpload.filePath → startUpload({paths}) 重新读取本地文件，闭包挂在 TransferItem.retry 上，避免 service 循环依赖）
- **传输列表顺序**：传输中心 `sortedItems` = startedAt 降序（最新在前）；**内置传输下拉**通过 `ApplicationRef.components[0].activeTransfers`（AppRoot 公开属性，1.0.238 确认存在）原地 splice 重排 + tick，实现"最新在前"（设置项 reorderBuiltinTransfers 可关，内置结构变化时静默跳过）
- **Tabby 自动更新坑（真机）**：electron-updater 下载好新版本后在**退出时静默安装**（pending 目录 `%LOCALAPPDATA%\tabby-updater\pending`），安装期间窗口消失、随后以新版本重启——看起来像"闪退"，实为升级流程；核对 `(Get-Item Tabby.exe).VersionInfo.ProductVersion` 与 `%APPDATA%\tabby\log.txt` 末尾是否 `module loaded`/`CWD reported for` 即可确认插件无恙。Keygen 更新检查报错（ERR_NAME_NOT_RESOLVED/代理断）无害
- **分屏坑（真机实测）**：`app.activeTab` 可能是 SplitTabComponent 外壳（无 sshSession），直接判断会误报"不是 SSH 会话"（红色 toast，用户以为插件坏了）；必须 `resolveFocusedTab()` 先 getFocusedTab() 再判断

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

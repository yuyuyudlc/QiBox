# 栖盒 Qibox

Windows 桌面上的 Claude Code 工作区。通过 WSL2 运行 Claude Code，提供项目与会话管理、双向翻译、终端、文件浏览和 Git 差异查看。

界面使用 React + TypeScript，桌面外壳使用 Tauri / Rust，后台使用 Node.js。桌面服务在 Windows 上运行，Claude 会话及项目工具在 WSL2 内运行。

## 运行要求

- Windows，以及可用的 WebView2 Runtime。
- Node.js 24，`node` 命令可在终端使用。
- WSL2 发行版，默认使用 `Ubuntu`。发行版内需要 Node.js 24、Claude Code、Claude Agent SDK、`node-pty` 和 Git。
- 可用的 Claude 账号或 API 配置。
- 使用“本机 Codex”翻译时，还需安装并登录本机 Codex CLI；选择 OpenAI 兼容 API 翻译则无需安装 Codex。

## 准备 WSL2

如果还没有 Ubuntu，在管理员 PowerShell 中运行 `wsl --install -d Ubuntu`，按提示重启并初始化 Linux 用户。用 `wsl -l -v` 确认发行版的 `VERSION` 为 `2`。 [Microsoft WSL 安装指南](https://learn.microsoft.com/zh-cn/windows/wsl/install)

打开栖盒后，在“设置 → 运行环境”点击“配置 WSL”。栖盒通过 `wsl.exe` 直接在所选发行版内运行 `scripts/setup-wsl.sh`，使用已保存的 Linux 用户和工作目录。首次使用时会自动读取 Ubuntu 的默认 Linux 用户。配置终端会补齐 WSL2 内的 Node.js、Claude Code、Claude Agent SDK、`node-pty` 和 Git，并创建缺失的 `/opt/isolation` 和工作目录。遇到 `sudo` 提示时，输入终端所显示用户的 Ubuntu 密码。配置完成后按任意键返回，栖盒会重新检查依赖，再由你点击“启动环境”。也可以在发布包目录单独运行 `Setup-WSL.bat`，完成后在栖盒里点“刷新状态”。

### 处理 sudo 权限

如果配置终端显示 `I'm sorry ... I'm afraid I can't do that` 或提示用户不在 `sudoers` 中，说明该 Linux 用户没有执行安装所需命令的权限。把下面示例中的 `Ubuntu` 和 `qibox` 替换为“运行环境”里显示的发行版与用户名，先在 Windows PowerShell 检查权限。

```powershell
wsl -d Ubuntu -u qibox -- sudo -l
```

如果这台电脑的所有者确认该账号应拥有 Ubuntu 管理员权限，可以在同一台电脑的 PowerShell 把它加入 `sudo` 组，再重新执行上面的检查。

```powershell
wsl -d Ubuntu -u root -- usermod -aG sudo qibox
```

权限通过后，回栖盒重试“配置 WSL”。如果运行账号应保持普通用户权限，请让 Ubuntu 管理员按下文准备依赖，并让运行账号可以写入 `/opt/isolation` 和工作目录。 [Ubuntu 用户权限说明](https://ubuntu.com/server/docs/how-to/security/user-management/)

### 手动安装

1. 在 Ubuntu 内为运行用户安装 Node.js 24 和 Git，并将 Claude Code 安装到 `/usr/local/bin/claude` 或 `/usr/bin/claude`。后台进程使用 `/usr/local/bin:/usr/bin:/bin`，因此从这个 PATH 也要能找到 `node` 和 `claude`（如果通过 `nvm` 或用户目录安装，可创建软链接到 `/usr/local/bin`）。 [Node.js 24 下载](https://nodejs.org/en/download/archive/v24) · [Claude Code 安装指南](https://code.claude.com/docs/en/setup)
2. 首次启动时，栖盒读取发行版的默认 Linux 用户。可以在桌面设置中改用另一个现有用户。确保该用户能写入 `/opt/isolation` 和工作目录（默认 `/workspace`）。在 Ubuntu 内以准备运行栖盒的用户执行：

   ```bash
   sudo mkdir -p /opt/isolation /workspace
   sudo chown "$(id -un):$(id -gn)" /opt/isolation /workspace
   npm install --prefix /opt/isolation @anthropic-ai/claude-agent-sdk@0.3.323 node-pty
   ```

   如果 `node-pty` 在安装时无可用预编译产物而需要本机编译，可额外安装 `build-essential python3`。若要在右侧工作台直接执行 `git commit`，请在 WSL2 内提前设置 `git config --global user.name` 与 `user.email`。

3. 公共配置模板默认使用 `UTC` 时区与 `C.UTF-8` Locale（Ubuntu 开箱自带）。如需改为 `ja_JP.UTF-8` 等地区 Locale，可先在 Ubuntu 中运行例如 `sudo locale-gen ja_JP.UTF-8`，再在桌面设置中选择。

当前开发机的运行环境为 Windows Node.js `24.19.0`、Ubuntu `26.04.1 LTS`（WSL2）、Linux Node.js `24.22.3`、Claude Code `2.1.323`、Claude Agent SDK `0.3.323` 和 `node-pty` `1.1.0`。复现时可先使用这一组版本。

程序用 `wsl.exe --list --verbose` 按设置里的发行版名称检查 WSL 版本，再以配置的 Linux 用户检查 `/usr/local/bin:/usr/bin:/bin` 中是否有 `node` 和 `claude`，以及 `/opt/isolation/node_modules` 下是否已安装 `@anthropic-ai/claude-agent-sdk` 和 `node-pty`。当前列表解析识别 `Running` 和 `Stopped` 两种英文状态。启动 Claude 会话时优先使用 `/usr/local/bin/claude`，其次使用 `/usr/bin/claude`，并从 `/opt/isolation/node_modules` 加载 SDK。WSL2、Linux 依赖和 Claude 认证需要在目标电脑上准备（桌面端的“启动环境”仅检查并同步代码，不会自动安装系统依赖）。

## 使用发布包

1. 下载并完整解压 `Isolation Console.zip` 到一个可写目录（不要单独移动 `Isolation Console.exe`）。
2. 运行 `Start-Isolation.bat` 打开栖盒，在“设置 → 运行环境”点击“配置 WSL”。依赖已就绪时，可以直接启动环境。
3. 配置终端结束后，点击“启动环境”。程序会将运行源码同步到 `/opt/isolation/src` 并启动 WSL2 后台服务。
4. 按下文配置 Claude 和翻译服务，再返回对话界面创建项目和会话。

`Isolation Console.exe` 依赖同目录下的 `src` 和 `config`。环境就绪后也可以直接打开 EXE。

## 配置 Claude

“设置 → 账号与连接”中的“Claude 配置同步”读取 Windows 上的 Claude `settings.json`，将支持的 API、模型和权限设置同步到 WSL2。

配置文件按以下顺序查找：

1. 本机 CC Switch 设置中的 `claudeConfigDir`（如果已配置）。
2. 环境变量 `CLAUDE_CONFIG_DIR` 指定的目录。
3. 默认目录 `%USERPROFILE%\.claude`。

CC Switch 不是必需依赖。使用 API Key 时，可在实际配置目录的 `settings.json` 中合并以下内容；不要覆盖已有的其他设置：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_API_KEY": "YOUR_CLAUDE_API_KEY"
  }
}
```

如果使用其他 Claude 兼容接口，请按服务商说明填写基础地址、密钥或 `ANTHROPIC_AUTH_TOKEN`，以及所需模型名称。此处需要 Claude / Anthropic 兼容接口；下文的 OpenAI 兼容 API 配置仅用于翻译。

配置完成后：

1. 点击“读取 Windows 配置”，检查来源路径、接口域名和密钥状态。
2. 环境启动完成后，点击“同步到 WSL2”。
3. 新建会话使用同步后的配置。

接口地址支持 HTTP 或 HTTPS。请确认 WSL2 内能访问所配置的服务。

使用 Claude 账号登录时，请在 WSL2 内以配置的 Linux 用户运行 Claude 并完成登录。配置同步会在 WSL2 内备份旧设置，范围以界面显示的键名为准。

## 配置翻译

打开“设置 → 对话与翻译”，选择翻译服务（`关闭翻译（仅原文对话）`、`本机 Codex` 或 `OpenAI 兼容 API`），以及“输入翻译目标语言”与“回复回译目标语言”，然后点击“保存对话偏好”。

默认将输入译为日语，并将 Claude 回复回译为简体中文；两者均可按需切换为英语、日语、韩语、简体中文等支持语言。不需要翻译时可直接选择“关闭翻译（仅原文对话）”；启用翻译时也可在输入框切换“原文直发”跳过输入翻译。

### 本机 Codex

- 在 Windows 上安装并登录 Codex CLI。
- 翻译服务选择“本机 Codex”。
- “Codex 翻译模型”留空时使用本机 Codex 默认模型，也可填写账号支持的模型名称。
- 保存后，点击“检查翻译连接”。

程序会自动查找 `PATH` 中的 `codex.exe` / `codex.cmd`、`npm` / `pnpm` / `Volta` / `NVM` / `fnm` / `Bun` / `Scoop` / `WinGet` / `Chocolatey` / `Cargo` 全局安装位置，以及 Windows Store 版 `OpenAI.Codex` 或 VS Code / Cursor / Antigravity 扩展自带的 `codex.exe`。如需指定自定义位置，可在启动程序前设置 `ISOLATION_CODEX_EXECUTABLE` 为 `codex.exe`、`codex.cmd` 或 `codex.js` 的完整路径。

本机翻译使用 Windows 登录态。“同步 Codex 登录态”供 WSL2 内的程序使用同一账号，按需启用。

### OpenAI 兼容 API

翻译服务选择“OpenAI 兼容 API”，填写以下字段：

| 字段 | 填写方式 |
| --- | --- |
| API 基础地址 | 服务商提供的基础地址，例如 `https://api.example.com/v1`；如果服务商要求 `/v1`，请保留 |
| API 模型 | 服务商提供且当前账号可用的模型 ID |
| API 密钥 | 该接口的 API Key |

程序会在基础地址后追加 `/chat/completions`，不要把这一段重复填入基础地址。接口必须支持 Chat Completions 请求与 `choices[0].message.content` 文本响应。远程接口要求 HTTPS，本机服务允许 `http://127.0.0.1:端口` 或 `http://localhost:端口`。

界面预填了 DeepSeek 地址和模型（`deepseek-chat`）；请以自己账号实际可用的模型为准。保存后点击“检查翻译连接”，该操作会发送一条简短测试请求。

翻译密钥保存在本机 `config/chat.local.json`，待翻译内容会发往填写的接口。该文件不应提交到 Git。

## 项目与文件

- **项目**：在对话侧栏选择或新建项目，再创建会话。
- **聊天附件**：在输入框添加文件。上传完成后，程序会在送给 Claude 的消息中附上项目内的文件引用。开启输入翻译时，翻译服务处理正文，附件引用在发送前原样拼接。
- **项目工具**：在工作区浏览文件、查看 Git 差异，或打开终端在 WSL2 内运行命令。

默认项目根目录为 WSL2 内的 `/workspace`，可在“设置 → 运行环境 → 环境与 WSL2”修改。

## 环境配置与数据

| 位置 | 内容 | 是否提交 Git |
| --- | --- | --- |
| `config/isolation.example.json` | 公共环境配置模板 | 是 |
| `config/isolation.json` | 本机 WSL2 发行版、用户、工作目录及环境设置 | 否 |
| `config/chat.local.json` | 翻译偏好和 API 密钥 | 否 |
| `.runtime/` | 聊天数据库、运行状态与本机临时数据 | 否 |
| WSL2 `/workspace` | 默认工作区和项目文件 | 不包含在源码仓库中 |
| WSL2 用户目录中的 `.claude` 和 `.isolation` | Claude 历史、配置和项目会话索引 | 不包含在源码仓库中 |

环境模板默认使用 `UTC` 时区和 `C.UTF-8` Locale。时区和 Locale 应用于后台进程和内置终端。代理可在“运行环境 → 网络与代理”配置。

修改环境配置时，先停止后台服务，保存后再启动。项目文件和历史保存在所选发行版内，备份时同时保留上表中的 Windows 本机数据和 WSL2 数据。

## 从源码构建

除运行依赖外，还需要 Git、Rust MSVC 工具链、微软 C++ Build Tools 和 Windows SDK。在克隆后的项目根目录运行：

```powershell
npm ci
cd desktop
npm ci
npm run desktop:build
cd ..
```

构建会生成并覆盖根目录的 `Isolation Console.exe`，因此构建前应关闭旧窗口。首次构建需要下载依赖。

开发桌面应用：在 `desktop` 目录运行 `npm run desktop:dev`。仅检查前端构建可运行 `npm run build`。

在项目根目录打包完整发布文件：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1
```

输出为 `dist/Isolation Console.zip`。打包脚本递归收集完整的 `src` 文件树，并按清单加入 EXE、启动脚本与配置模板。本机配置和聊天数据留在发布包之外。

图标源文件为 `desktop/src/assets/qibox.svg`。在 `desktop` 目录执行 `npm run tauri -- icon src/assets/qibox.svg` 重新生成平台图标；生成后的 `src-tauri/icons` 文件需要提交，供其他人构建。

## 源码仓库与发布文件

上传源码仓库的内容：

```text
desktop/                  React 界面和 Tauri 源码、配置、图标、锁文件
src/                      Windows 与 WSL2 后台源码
config/isolation.example.json
scripts/                  启动与打包脚本
package.json
package-lock.json
Start-Isolation.bat
Setup-WSL.bat
README.md
LICENSE
.gitignore
.gitattributes
```

保留 `desktop/package-lock.json` 和 `desktop/src-tauri/Cargo.lock`，用于固定构建依赖。`AGENTS.md` 是可选的开发协作约定，不影响程序运行。

以下内容已由 Git 忽略规则排除：本机配置与配置备份、`.runtime`、依赖目录、Rust 构建缓存、前端构建结果、Tauri 生成目录、日志、临时文件、个人开发工具目录及 EXE / 发布 ZIP。

将 `dist/Isolation Console.zip` 作为 GitHub Releases 附件分发；源码仓库无需提交 EXE、ZIP 或 `node_modules`。克隆源码的人通过 `npm ci` 安装依赖。

首次提交前，在项目根目录初始化 Git 并检查文件清单：

```powershell
git init
git add .
git diff --cached --name-only
git status --short
```

确认暂存清单中没有本机配置、聊天数据或凭据后，再提交并推送到自己的仓库。`.gitignore` 不会移除已经被 Git 跟踪的文件，也不会清除旧提交中的内容；已有仓库应另外检查已跟踪文件和历史。

## 常见问题

- **启动脚本检查失败**：在 Windows 终端检查 `node --version` 和 `wsl -l -v`，确认发行版名称和 WSL 版本与设置一致。
- **WSL2 后台启动失败**：确认所选 Linux 用户可访问 `/usr/local/bin:/usr/bin:/bin` 下的 `node` 和 `claude`，已安装 `@anthropic-ai/claude-agent-sdk` 和 `node-pty`，并有权写入 `/opt/isolation` 和工作目录。后台日志位于 `.runtime/wsl-daemon.log`。
- **找不到 Claude 配置**：检查上文的配置目录优先级，以及 `settings.json` 是否存在、JSON 是否有效。
- **同步后仍未认证**：确认 API 配置可用，或在 WSL2 中以配置的 Linux 用户完成 Claude 登录。
- **翻译请求失败**：检查翻译服务、基础地址、模型和密钥；若返回 404，先核对 `/v1` 等路径以及是否重复填写 `/chat/completions`。
- **无法覆盖 EXE**：先关闭正在运行的栖盒窗口，再构建。

## 许可证

源码采用 [MIT 许可证](LICENSE)。

# 康莱德工坊 · 本机 Codex 版

默认使用这台电脑已通过 ChatGPT 登录的官方 Codex，不需要 OpenAI API Key，也不依赖 API 余额。仍使用 Codex 的联网模型和订阅用量，不是离线模型或无限额度。

## 启动与生成

1. macOS 双击解压目录里的 `启动康莱德工坊.command`。需 Python 3.10+，首次自动建立虚拟环境并安装 PDF 组件；保持终端窗口开启。
2. 浏览器打开 http://127.0.0.1:8765/ 。如未登录，在终端运行 `codex login`，选择 ChatGPT。启动器能找到 PATH 中的 Codex CLI，也支持本机 ChatGPT 应用内置 CLI。
3. 点击“上传材料 · AI 整理”，选择材料及专利类型。顶部“本机 Codex”可检查登录状态和选择 GPT-6.2 Sol / Astra。
4. 确认材料使用授权后点击“开始整理并生成”。默认自动下载 Word ZIP，并另存为新专利；也可选逐项审阅。
5. Word 包含适用的请求书、权利要求书、说明书和摘要；已有正式附图时另生成说明书附图、摘要附图，其他文书按申请类型与选项生成。同时包含待补清单、整理依据与 JSON 备份。

其他系统可手动建立 Python 虚拟环境，安装 `scripts/local-codex-requirements.txt`，再执行 `python scripts/local_codex.py --open-browser`。CLI 需支持 `exec --ignore-user-config --ignore-rules --ephemeral --output-schema`；版本过旧时请更新官方 Codex。

## 在线网站与本机网站

GitHub Pages 是静态网站，不能自行运行电脑上的 Codex。在线入口提供“下载本机版”和“打开本机工坊”，使用前需先运行启动文件。不要把本机服务暴露到公网。

两个网址的草稿分别存储。需要迁移时，从原网址“备份专利资料”下载 JSON，再到本机网址“导入备份”。这不会覆盖原项目。个人资料和真实课题不应提交到公开仓库。

## 文件与数据

支持 1–8 份 PDF / DOCX / PPTX / TXT / MD / PNG / JPG；单份 5 MB，合计 15 MB。PDF 每份最多 30 页，全部材料最多 24 张需识别图片/图页。文本过长时需按课题拆分。加密 PDF 先解除密码；旧 DOC/PPT 请先转换。

PDF 读取文字并渲染含图或扫描页；DOCX/PPTX 读取文字及内嵌 PNG/JPG。复杂排版、矢量图和图文位置建议先转成 PDF。原图供 AI 理解，不自动转换为正式专利附图。

浏览器把所选材料发送到本机服务；提取的文字和图片由官方 Codex CLI 交给云端模型。没有工坊云端中转。临时文件在任务完成、失败或取消后删除，结果暂存在服务内存中；浏览器采纳后的专利保存在 IndexedDB。刷新或关闭上传页面会丢失尚未保存的上传选择。

AI 整理名称、技术领域、背景技术、技术问题、技术方案、有益效果、实施方式、权利要求和摘要。缺失的人员、证件、实验数据、签署和正式附图不编造；输出属于待核对的专利草稿。

## 常见情况

- 未找到 CLI / 未登录：安装或更新 Codex，使用 `codex login` 登录 ChatGPT。本机模式拒绝 API Key 登录，不自动改用 API 计费。
- 订阅用量受限：在 Codex 中查看用量，等待恢复或按订阅规则处理。API 充值不是本机模式的前提。
- 模型不可用：在“本机 Codex”中切换模型，或更新 CLI；不会偷偷换模型。
- 本机页面打不开：先双击启动文件，检查终端是否仍在运行、8765 端口是否被占用。
- 任务超时：单次最多 10 分钟，减少材料后重试；失败保留页面中的材料选择和说明。
- 取消任务：会停止对应 CLI 进程；已经处理的内容可能计入订阅用量。
- Word 打包失败：保留 AI 结果重新打包，不重复调用 Codex。

## 可选 API 模式

GitHub Pages 仍提供“其他方式：使用自己的 API Key”。这是独立选项，使用者自行承担 API 用量，与本机模式不混用。Key 仅在页面内存，刷新或关闭后清除，不存入浏览器数据库或备份。tracking ID 不能代替 secret。

API 请求直接发送至固定的 OpenAI Responses 地址并使用 `store:false`；数据保留以账户政策为准。429 按实际代码区分余额耗尽、消费上限和临时限流。余额错误不自动重试；可下载无密钥的诊断信息。仅明确的临时限流、且等待不超过 30 秒时自动重试一次。

## 维护与验证

`dist/local-codex.js` 连接本机服务，`scripts/local_codex.py` 负责解析与 CLI；`dist/ai.js` 负责上传和结果流转。提示词与 Schema 来自 `dist/ai-prompt.mjs`，修改后执行 `node scripts/build-local-config.mjs`，CI 检查同步。

本机仅监听回环地址；请求检查 Host、Origin 和每次启动生成的访问令牌。CLI 强制 ChatGPT 登录，移除 API 环境变量，在独立临时目录以只读模式运行，关闭工具调用及用户规则。不复制或返回 Codex 登录凭据。

官方说明：[Codex 登录方式](https://learn.chatgpt.com/docs/auth.md)、[非交互执行](https://learn.chatgpt.com/docs/non-interactive-mode.md)。

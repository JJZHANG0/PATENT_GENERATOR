# 康莱德工坊 · 个人版

直接使用 GitHub Pages 网站，无需注册、Supabase、后台或插件授权。其他使用者各自填写自己的 OpenAI API Key，费用各自承担。

## 使用步骤

1. 点击“上传材料 · AI 整理”或右上角“AI 密钥”。
2. 在网站密码输入框填自己的完整 OpenAI secret（以 `sk-` 开头）。`key_…` tracking ID 不能调用 API。遗失 secret 时，需要在自己的 OpenAI 账户中新建。
3. 默认使用 GPT-6.2 Sol（专利整理）；可选 GPT-6.2 Astra（复杂材料，费用较高），并保留 GPT-5.4 mini（经济方案）和 GPT-5.4（备选）。具体可用性以自己的 API 项目权限为准，失败时不会自动换模型。保存设置不会调用 API。
4. 上传技术材料，确认材料使用授权后，点击“开始整理并生成”。
5. 默认直接下载 Word 材料包，同时另存一份专利；原稿不覆盖。材料不足时输出带待补清单的草稿包，不编造人员、实验或附图。
6. 如需逐项选择，可在上传页面将生成方式改为“先逐项审阅，再自行导出”。

## 数据与密钥

Key 只在当前页面的 JavaScript 内存中使用，不写入浏览器存储、草稿、备份或代码。刷新、关闭页面、离开页面或手动清除后需重新填写。更换 Key 不切换或删除草稿。

这是使用者自带 Key 的浏览器工具，请只在自己信任的设备及页面使用。请求只发向固定的 OpenAI API 地址，不支持第三方中转地址，也不发送到工坊后台。上传原文件只留在本次页面内存，不自动保存到草稿。采纳后的技术字段和手动上传的正式附图保存在 IndexedDB；更换设备前请导出备份。

OpenAI 请求使用 `store:false`，不建立长期 Files 上传；服务商的数据保留取决于账户政策，不代表零数据保留。浏览器网络必须能访问 OpenAI API。

## 文件与质量

支持 1–8 份 PDF / DOCX / PPTX / TXT / MD / PNG / JPG；单份 5 MB，合计 15 MB。非 PDF 文档只提取文字，含结构图的 Word/PPT 请先转为 PDF；加密文件先解除密码。

AI 整理名称、技术领域、背景技术、技术问题、技术方案、有益效果、实施方式、权利要求、摘要。人员、证件、签署和正式附图需自行核对填写。提示词禁止编造实验数据和不存在的结构，材料不足会列出待补问题。生成内容仍是需核对的审阅初稿。

## 常见情况

- 401：Key 无效或过期，更换完整 secret。
- 403：账户、地区、项目或模型权限不可用。
- 404：所选模型不存在或当前 Key 无访问权限，请检查项目或手动更换模型。
- 429：按返回代码区分 `credit_balance_exhausted`（预付余额）、`project_spend_limit_exceeded`（项目上限）、`organization_spend_limit_exceeded`（组织上限）、`organization_usage_limit_exceeded`（获批用量）、`insufficient_quota`（尚需核对的额度问题）与 `rate_limit_exceeded` / `slow_down`（临时限流）。未知原因不推断成余额不足。错误卡片可下载 HTTP 状态、分类代码与请求编号；不包含 Key、原始错误文本或上传内容。
- 网络失败：检查浏览器能否访问 OpenAI API；本工具没有代理中转。
- 超时或输出不完整（单次最多等待 5 分钟）：减少文件或缩小课题范围。已发出的请求即使取消或失败，也可能产生用量；仅已识别的临时限流在 Retry-After 不超过 30 秒时重试一次；计费、额度、过大请求和未知错误不自动重试。

## 开发与发布

`dist/ai.js` 管理临时 Key 和上传审阅界面；`ai-core.mjs` 直接调用 Responses API 并校验结果；`ai-prompt.mjs` 包含系统提示词与严格 JSON Schema。页面不含任何预置 Key。

推送 main 后自动部署 GitHub Pages。运行 `node scripts/test-validation.cjs`、`node scripts/test-public-config.cjs`、`node --test scripts/test-ai.mjs`。可选浏览器测试用模拟响应验证流程，不使用真实 Key 或产生费用。

官方说明：[API Key](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key)、[文件输入](https://developers.openai.com/api/docs/guides/file-inputs)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)。

模型依据（2026-11-24 核对）：[GPT-6.2 Sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol)、[GPT-6.2 Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra)。两者支持 Responses、图片输入和结构化输出；本工具使用 medium reasoning。

默认自动导出按现有模板生成适用的请求书、权利要求书、说明书、摘要；已有正式附图时附说明书附图和摘要附图，申请类型/选项需要时附其他文书。缺少的技术附图不会伪造，写入待补清单。ZIP 同时包含 AI 整理依据和 JSON 备份。Word 打包失败可保留 AI 结果重新打包，不再次调用 API。

429 分类依据：[OpenAI 错误码](https://developers.openai.com/api/docs/guides/error-codes)。旧版没有保留具体错误体，不能仅根据旧截图追溯某次 429 的确切原因。

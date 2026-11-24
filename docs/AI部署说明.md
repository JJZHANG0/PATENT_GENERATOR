# 康莱德工坊 · 个人版

直接使用 GitHub Pages 网站，无需注册、Supabase、后台或插件授权。其他使用者各自填写自己的 OpenAI API Key，费用各自承担。

## 使用步骤

1. 点击“上传材料 · AI 整理”或右上角“AI 密钥”。
2. 在网站密码输入框填自己的完整 OpenAI secret（以 `sk-` 开头）。`key_…` tracking ID 不能调用 API。遗失 secret 时，需要在自己的 OpenAI 账户中新建。
3. 选择 GPT-5.4 mini（日常整理）或 GPT-5.4（深入起草）。保存设置不会调用 API。
4. 上传技术材料，确认材料使用授权后，点击“生成专利建议稿”。
5. 核对来源线索、待补问题和每个字段，再勾选采纳；已有内容默认不替换。
6. 补齐人员和附图，按原有步骤导出 Word。

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
- 429：余额不足或调用过于频繁，检查自己的 OpenAI API 账单及额度。
- 网络失败：检查浏览器能否访问 OpenAI API；本工具没有代理中转。
- 超时或输出不完整：减少文件或缩小课题范围。已发出的请求即使取消或失败，也可能产生用量；不会自动重试。

## 开发与发布

`dist/ai.js` 管理临时 Key 和上传审阅界面；`ai-core.mjs` 直接调用 Responses API 并校验结果；`ai-prompt.mjs` 包含系统提示词与严格 JSON Schema。页面不含任何预置 Key。

推送 main 后自动部署 GitHub Pages。运行 `node scripts/test-validation.cjs`、`node scripts/test-public-config.cjs`、`node --test scripts/test-ai.mjs`。可选浏览器测试用模拟响应验证流程，不使用真实 Key 或产生费用。

官方说明：[API Key](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key)、[文件输入](https://developers.openai.com/api/docs/guides/file-inputs)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)。

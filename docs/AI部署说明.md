# 康莱德工坊 AI 后台

GitHub Pages 托管公开前端；Supabase Auth 管理登录；Postgres 保存队伍、成员关系和每日调用次数；Edge Function 验证权限后调用 OpenAI Responses API。API secret 只放在后台。

## 当前存储范围

- 专利草稿、附图和导出记录仍保存在浏览器 IndexedDB。访客与各登录账号使用独立存储键；同队不同成员、不同设备不自动同步。
- 这是本地界面隔离，不是共享电脑上的加密保险箱。共用电脑应使用各自的浏览器个人资料；浏览器开发工具能查看本机缓存。需要云端协同和服务器保存专利正文时，应另建带 RLS 的草稿表。
- 登录 token 只留在页面内存，刷新或关闭页面后重新登录。不存储密码。
- 上传文件不进入数据库、对象存储或应用日志，仅在本次请求中转给 OpenAI。使用 `store:false`，不建立 OpenAI Files 长期文件；OpenAI 的服务端数据保留仍受账户的数据控制政策约束，不等同于零数据保留。

## 1. 连接并创建 Supabase 项目

由工坊所有者连接 Supabase 插件，选择自己的项目。创建新项目涉及托管套餐时由所有者选择套餐。

在 SQL Editor 执行 `supabase/migrations/202611240001_workshop.sql`。三个表都启用 RLS，撤销浏览器角色访问；仅后台 service role 操作。每日额度通过数据库行锁和原子事务分配，按北京时间日期计算，队伍成员共用额度。

Auth 设置：启用邮箱密码登录，关闭公开注册。管理员在 Authentication → Users 创建账号（不要自动给陌生访问者开放额度）。用户邮箱与初始密码通过你们已有的安全渠道交付；忘记密码由管理员重置。本仓库不发送邀请邮件。

创建队伍及加入成员，替换占位值后在 SQL Editor 执行：

```sql
insert into public.workshop_teams(name, daily_limit)
values ('康莱德 · 你的队伍名称', 10) returning id;

insert into public.workshop_members(user_id, team_id)
values ('Auth 用户 UUID', '上一步的队伍 UUID');
```

同一队伍可加入多个不同登录账号。用户不能在网页中自选其他队伍或修改额度。停用队伍：`update public.workshop_teams set enabled=false where id='队伍 UUID';`。

## 2. 配置后台 secret

OpenAI `key_…` 是管理标识，不能作为 Bearer API secret。遗失 secret 后需新建。不要把 secret 放入聊天、截图、网页配置、GitHub 仓库或 VITE 环境变量。

在 Supabase 项目 Edge Functions → Secrets 设置：

| 名称 | 内容 |
| --- | --- |
| OPENAI_API_KEY | 工坊所有者自己的 OpenAI secret |
| OPENAI_MODEL | 默认 `gpt-5.4-mini`，需账户有 Responses、图像输入和结构化输出权限 |
| ALLOWED_ORIGINS | `https://jjzhang0.github.io`；本地测试可逗号追加 `http://127.0.0.1:4173` |

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 运行环境提供，不能写入前端。管理员还应在 OpenAI 项目设置适合自己的用量控制。队伍默认每天 10 次、两次至少间隔 45 秒；已提交上游的请求在失败、超时或前端取消时仍计次，避免重试绕过额度。

## 3. 部署函数

优先通过连接的 Supabase 插件部署 `supabase/functions/patent-ai/` 中所有文件，入口 `index.ts`。如使用官方 CLI：

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy patent-ai --no-verify-jwt
```

如果已在 SQL Editor 执行迁移，不要再次直接执行相同迁移；先按照 Supabase 的迁移历史流程对齐记录。`verify_jwt=false` 只关闭旧网关验证：函数内每次调用都会携带用户 Bearer token 请求 Auth `/user` 验证身份，并检查队伍资格。不得删除这两步。只验证 token 字符串或解析未验签 JWT 都不够。

## 4. 配置公开前端

在 `dist/ai-config.js` 设置项目 URL 和 **publishable key**（或 legacy `anon` key）。这两项本来就用于公开客户端；禁止使用 service-role key 或 OpenAI key。推送到 main 自动发布 Pages。

```js
window.PATENT_AI_CONFIG = Object.freeze({
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  publishableKey: 'sb_publishable_YOUR_PUBLIC_KEY',
});
```

当前空配置会明确显示“队伍 AI 正在接入”，不会出现模拟登录或伪造生成结果。原有本地编辑与 Word 导出正常可用。

## 验收

1. `node scripts/test-validation.cjs`，`node --test scripts/test-ai.mjs`（Node 22+）。验证原有专利规则、鉴权、文件限制、结构化返回、错误处理和逐项采纳。
2. 用两个队伍账号实际登录，确认不能看到对方的本地草稿；退出回到访客草稿，刷新后需重新登录。
3. 未登录请求函数返回 401；未加入队伍返回 403；超额返回 429，且均不调用 OpenAI。
4. 用无真实个人信息的技术交底 TXT/PDF 各生成一次，检查依据、缺失信息、采纳后 Word 导出；再试多份文件与图片。
5. 查看额度计数增长、停用队伍、网络错误和过期会话。不要把请求正文、token 或 secret 写到日志。

## 提示词与行为

`prompt.mjs` 提供系统提示词与严格 JSON Schema，`core.mjs` 执行文件与输出校验；正文、证据、待补问题都可在 UI 审阅。模型不生成行政人员字段、不自动更换专利类型、不自动将上传图片当作正式附图。建议初稿仍需技术负责人和专利专业人员核对。

支持 1–8 份 PDF / DOCX / PPTX / TXT / MD / PNG / JPG；单份 5 MB，总计 15 MB。格式签名做初步校验，服务商解析错误会反馈给用户。非 PDF 文档的内嵌图表不会进入模型视觉输入，请先转换 PDF。110 秒上游超时；复杂材料超时或输出不完整时减小材料范围重新生成。

官方依据：[OpenAI 文件输入](https://developers.openai.com/api/docs/guides/file-inputs)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)、[API Key 查找与重建](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key)、[Supabase 函数鉴权](https://supabase.com/docs/guides/functions/auth)、[Supabase API key 类型](https://supabase.com/docs/guides/api/api-keys)。

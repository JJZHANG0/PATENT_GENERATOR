import {createHandler, HttpError} from './core.mjs';

const url = Deno.env.get('SUPABASE_URL') || '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const serviceHeaders = {apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json'};

async function authenticate(bearer: string) {
  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: {apikey: service, Authorization: bearer}, signal: AbortSignal.timeout(10000),
  });
  if (!userResponse.ok) throw new HttpError(401, '登录已失效，请重新登录。');
  const user = await userResponse.json();
  if (!/^[a-f0-9-]{36}$/i.test(user.id)) throw new HttpError(401, '登录凭据无效。');
  const response = await fetch(`${url}/rest/v1/workshop_members?user_id=eq.${encodeURIComponent(user.id)}&select=team_id,workshop_teams(name,enabled,daily_limit)`, {
    headers: serviceHeaders, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new HttpError(503, '队伍权限配置尚未完成，请联系管理员。');
  const [membership] = await response.json();
  if (!membership?.workshop_teams?.enabled) throw new HttpError(403, '此账号尚未加入已启用的康莱德队伍，请联系管理员。');
  return {userId: user.id, teamId: membership.team_id, teamName: membership.workshop_teams.name, dailyLimit: membership.workshop_teams.daily_limit};
}

async function reserveQuota(userId: string) {
  const response = await fetch(`${url}/rest/v1/rpc/reserve_patent_ai`, {
    method: 'POST', headers: serviceHeaders, body: JSON.stringify({p_user_id: userId}), signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok) {
    if (body.message === 'DAILY_LIMIT') throw new HttpError(429, '队伍今日 AI 次数已用完，明天再来，或联系管理员调整额度。');
    if (body.message === 'COOLDOWN') throw new HttpError(429, '队伍刚刚发起过生成，请至少间隔 45 秒。');
    if (body.message === 'ACCOUNT_DISABLED') throw new HttpError(403, '队伍已停用，请联系管理员。');
    throw new HttpError(503, '使用额度检查暂不可用，请稍后重试。');
  }
  return body;
}

Deno.serve(createHandler({
  authenticate, reserveQuota,
  apiKey: Deno.env.get('OPENAI_API_KEY') || '',
  model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.4-mini',
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') || 'https://jjzhang0.github.io').split(',').map(s => s.trim()).filter(Boolean),
}));

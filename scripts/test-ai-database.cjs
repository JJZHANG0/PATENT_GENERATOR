// Optional PostgreSQL integration test using @electric-sql/pglite (no cloud account).
const {PGlite} = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async()=>{
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);`);
  await db.exec(fs.readFileSync('supabase/migrations/202611240001_workshop.sql','utf8'));
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
  await db.query('insert into auth.users(id) values($1),($2),($3)',[a,b,c]);
  const {rows:[team]}=await db.query("insert into public.workshop_teams(name,daily_limit) values('测试队',2) returning id");
  await db.query('insert into public.workshop_members(user_id,team_id) values($1,$3),($2,$3)',[a,b,team.id]);
  let r=await db.query('select public.reserve_patent_ai($1) as quota',[a]);assert.equal(r.rows[0].quota.remaining,1);
  await assert.rejects(()=>db.query('select public.reserve_patent_ai($1)',[b]),/COOLDOWN/);
  await db.exec("update public.workshop_ai_usage set last_request=now()-interval '1 minute'");
  r=await db.query('select public.reserve_patent_ai($1) as quota',[b]);assert.equal(r.rows[0].quota.remaining,0);
  await assert.rejects(()=>db.query('select public.reserve_patent_ai($1)',[a]),/DAILY_LIMIT/);
  assert.equal((await db.query('select attempts from public.workshop_ai_usage')).rows[0].attempts,2);
  await assert.rejects(()=>db.query('select public.reserve_patent_ai($1)',[c]),/ACCOUNT_DISABLED/);
  await db.exec("update public.workshop_ai_usage set day=day-1");
  r=await db.query('select public.reserve_patent_ai($1) as quota',[a]);assert.equal(r.rows[0].quota.remaining,1);
  await db.exec('update public.workshop_teams set enabled=false');
  await assert.rejects(()=>db.query('select public.reserve_patent_ai($1)',[a]),/ACCOUNT_DISABLED/);
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    await assert.rejects(()=>db.query('select * from public.workshop_members'),/permission denied/);
    await assert.rejects(()=>db.query('select public.reserve_patent_ai($1)',[a]),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await db.query('select count(*) from public.workshop_members')).rows[0].count,2);
  await db.close();console.log('PASS PostgreSQL migration, shared quota, cooldown, daily reset, disabled teams, RLS/grants');
})().catch(e=>{console.error(e);process.exit(1);});

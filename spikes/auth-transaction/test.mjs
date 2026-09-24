import {measureSessionValidity,negativeOwnerRegression} from './measurements.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHmac,createHash,createDecipheriv} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {makeApp} from './app.mjs';
const env={...process.env,SUPABASE_TELEMETRY_DISABLED:'1',DOCKER_HOST:process.env.DOCKER_HOST??`unix://${process.env.HOME}/.docker/run/docker.sock`};
const cfg=JSON.parse(execFileSync('./node_modules/.bin/supabase',['status','-o','json'],{env,stdio:['ignore','pipe','pipe']}).toString());
assert.equal(cfg.API_URL,'http://127.0.0.1:54321');assert.equal(new URL(cfg.DB_URL).hostname,'127.0.0.1');
const admin=new pg.Pool({connectionString:cfg.DB_URL});
const sbAdmin=createClient(cfg.API_URL,cfg.SECRET_KEY??cfg.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const publicKey=cfg.PUBLISHABLE_KEY??cfg.ANON_KEY;
const ids=[];let appDb,authDb,server;const faults={onError:e=>console.error('INTERNAL',e.code??e.name,'redacted internal failure')};const encryptionKey=randomBytes(32);let checks=0;
const pass=name=>{checks++;console.log(`PASS ${name}`);};
const totp=secret=>{let bits='';for(const ch of secret.toUpperCase().replace(/=+$/,''))bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5,'0');const raw=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));const time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',raw).update(time).digest();return ((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).toString().padStart(6,'0');};
let base;
async function launch(){server=makeApp({url:cfg.API_URL,key:publicKey,appDb,authDb,encryptionKey,faults});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
async function request(path,{cookie,body,origin=base}={}){const res=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0],cookieHeader:res.headers.get('set-cookie')};}
async function identity(){const email=`spike-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('hex');const {data,error}=await sbAdmin.auth.admin.createUser({email,password,email_confirm:true});if(error)throw Error('test_user_creation_failed');ids.push(data.user.id);await admin.query('insert into spike.allowed values($1)',[data.user.id]);return {email,password,id:data.user.id};}
async function login(user){const r=await request('/login',{body:{email:user.email,password:user.password}});assert.equal(r.status,200);assert.match(r.cookieHeader,/HttpOnly/);assert.match(r.cookieHeader,/SameSite=Strict/);return r.cookie;}
async function mfa(cookie){const enroll=await request('/mfa/enroll',{cookie,body:{}});assert.equal(enroll.status,200);const invalid=await request('/mfa/verify',{cookie,body:{id:enroll.body.id,code:'invalid'}});assert.equal(invalid.status,403);const verified=await request('/mfa/verify',{cookie,body:{id:enroll.body.id,code:totp(enroll.body.secret)}});assert.equal(verified.status,200);return verified.cookie;}
try{
  // This schema name is reserved for the disposable spike. Refuse to overwrite an existing run.
  assert.equal((await admin.query("select 1 from pg_namespace where nspname='spike'")).rowCount,0,'existing spike schema: clean up explicitly before rerunning');
  await admin.query(readFileSync('schema.sql','utf8'));
  const credentials={};for(const role of ['yourset_spike_app','yourset_spike_auth']){const password=randomBytes(32).toString('hex');await admin.query(`alter role ${role} password '${password}'`);const conn=new URL(cfg.DB_URL);conn.username=role;conn.password=password;credentials[role]=conn.toString();}
  appDb=new pg.Pool({connectionString:credentials.yourset_spike_app,max:4});authDb=new pg.Pool({connectionString:credentials.yourset_spike_auth,max:4});await launch();
  const a=await identity(),b=await identity();
  assert.equal((await request('/overview')).status,401);pass('anonymous HTTP read denied');
  let ca=await login(a);assert.equal((await request('/overview',{cookie:ca})).status,403);pass('real Supabase password sign-in remains AAL1 and cannot read');
  const old=ca;ca=await mfa(ca);assert.equal((await request('/overview',{cookie:old})).status,401);assert.equal((await request('/overview',{cookie:ca})).status,200);pass('real TOTP challenge reaches AAL2; old pre-MFA cookie rotated');
  const cb=await mfa(await login(b));
  assert.equal((await request('/command',{cookie:ca,body:{},origin:'http://evil.invalid'})).status,403);pass('cross-origin mutation denied');
  const cmd={key:randomUUID(),expectedVersion:0,target:2300,reason:'Synthetic plan review'};
  assert.equal((await request('/command',{cookie:ca,body:{...cmd,owner:b.id}})).status,400);pass('client-supplied owner rejected');
  faults.failAfterPlan=true;assert.equal((await request('/command',{cookie:ca,body:cmd})).status,503);let view=await request('/overview',{cookie:ca});assert.equal(view.body.plans.length,0);assert.equal(view.body.decisions.length,0);pass('failure between plan and decision rolls back both');
  faults.dropAfterCommit=true;await assert.rejects(request('/command',{cookie:ca,body:cmd}));const retry=await request('/command',{cookie:ca,body:cmd});assert.equal(retry.status,200);const twice=await request('/command',{cookie:ca,body:cmd});assert.deepEqual(twice.body,retry.body);view=await request('/overview',{cookie:ca});assert.equal(view.body.plans.length,1);assert.equal(view.body.decisions.length,1);pass('lost HTTP response after commit and retry produce one durable command');
  assert.equal((await request('/command',{cookie:ca,body:{...cmd,target:2400}})).status,409);pass('idempotency-key reuse with different payload denied');
  const race=await Promise.all([request('/command',{cookie:ca,body:{...cmd,key:randomUUID(),expectedVersion:1}}),request('/command',{cookie:ca,body:{...cmd,key:randomUUID(),expectedVersion:1}})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);pass('concurrent same-version edits yield one commit and one conflict');
  assert.equal((await request('/overview',{cookie:cb})).body.plans.length,0);pass('second MFA owner cannot see first owner records');
  assert.equal((await appDb.query('select * from spike.plans')).rowCount,0);pass('pooled transaction owner context resets; unscoped role sees no rows');
  const stored=(await admin.query('select sealed from spike.sessions where owner=$1 and not revoked',[b.id])).rows[0];
  const sealed=JSON.parse(stored.sealed),decipher=createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(sealed.iv,'hex'));decipher.setAuthTag(Buffer.from(sealed.tag,'hex'));const tokens=JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.body,'hex')),decipher.final()]).toString());
  assert.equal(JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url')).aal,'aal2');
  const bypass=await fetch(cfg.API_URL+'/rest/v1/plans?select=*',{headers:{apikey:publicKey,Authorization:`Bearer ${tokens.access_token}`,'Accept-Profile':'spike'}});assert.equal(bypass.status,406);pass('Data API refuses private spike schema even with genuine AAL2 JWT');
  await new Promise(r=>server.close(r));await launch();assert.equal((await request('/overview',{cookie:ca})).body.plans.length,2);pass('API restart retains database session and committed state');
  await measureSessionValidity({admin,authDb,request,cookie:ca});
  await negativeOwnerRegression({admin,connectionString:credentials.yourset_spike_app,owner:a.id});pass('unset and empty owner deny after pool reuse; mutation detected and restored');
  const cookieHash=createHash('sha256').update(ca.split('=')[1]).digest('hex');const start=performance.now();await authDb.query('update spike.sessions set revoked=true where hash=$1',[cookieHash]);assert.equal((await request('/overview',{cookie:ca})).status,401);assert.ok(performance.now()-start<60000);pass('operator revocation rejects old cookie within 60 seconds');
  console.log(JSON.stringify({measurement:'operator_revocation',seconds:(performance.now()-start)/1000,method:'start before durable revocation write through old-cookie private-read denial; includes existing assertion and pass reporting',observations:1}));
  const upstream=(await admin.query('select upstream from spike.sessions where owner=$1 and not revoked',[b.id])).rows[0].upstream;
  // Real admin Auth sign-out rather than a fake JWT expiry.
  const encryptedRow=(await admin.query('select count(*) from auth.sessions where id=$1',[upstream])).rows[0];assert.equal(Number(encryptedRow.count),1);
  const external=await sbAdmin.auth.admin.signOut(tokens.access_token,'global');assert.equal(external.error,null);assert.equal((await request('/overview',{cookie:cb})).status,401);pass('upstream-only session revocation denies still-active application cookie');
  const expired=await login(a);await authDb.query("update spike.sessions set expires=now()-interval '1 second' where hash=$1",[createHash('sha256').update(expired.split('=')[1]).digest('hex')]);assert.equal((await request('/overview',{cookie:expired})).status,401);pass('expired application session denied');
  const fresh=await login(a);
  const freshUpstream=(await authDb.query('select upstream from spike.sessions where hash=$1',[createHash('sha256').update(fresh.split('=')[1]).digest('hex')])).rows[0].upstream;
  const logout=await request('/logout',{cookie:fresh,body:{}});assert.equal(logout.status,200);assert.equal(logout.body.status,'signed_out');assert.equal((await admin.query('select 1 from auth.sessions where id=$1',[freshUpstream])).rowCount,0);assert.equal((await request('/overview',{cookie:fresh})).status,401);pass('logout removes upstream auth session and denies old application cookie');
  console.log(`RESULT ${checks} checks passed against real local Auth/Postgres/HTTP; no hosted resources or health accounts used.`);
}catch(e){console.error('SPIKE FAILED',e.code??e.name,e.message?.replace(/(?:sb_secret_|eyJ)[^\s]+/g,'[redacted]'));process.exitCode=1;}
finally{
  if(server)await new Promise(r=>server.close(r));if(appDb)await appDb.end();if(authDb)await authDb.end();
  for(const id of ids)await sbAdmin.auth.admin.deleteUser(id);
  if(ids.length){await admin.query('drop schema spike cascade');await admin.query('grant yourset_spike_app,yourset_spike_auth to postgres; drop owned by yourset_spike_app; drop owned by yourset_spike_auth; drop role yourset_spike_app; drop role yourset_spike_auth;');}
  await admin.end();
}

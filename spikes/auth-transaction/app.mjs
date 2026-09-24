import http from 'node:http';
import {randomBytes,randomUUID,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const failure=(status,code)=>Object.assign(new Error(code),{status,code});
export function makeApp({url,key,appDb,authDb,encryptionKey,faults={}}){
  if(new URL(url).hostname!=='127.0.0.1') throw Error('local_spike_only');
  const client=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  function seal(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',encryptionKey,iv);return JSON.stringify({iv:iv.toString('hex'),body:Buffer.concat([c.update(JSON.stringify(value)),c.final()]).toString('hex'),tag:c.getAuthTag().toString('hex')});}
  function unseal(value){const s=JSON.parse(value),d=createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(s.iv,'hex'));d.setAuthTag(Buffer.from(s.tag,'hex'));return JSON.parse(Buffer.concat([d.update(Buffer.from(s.body,'hex')),d.final()]).toString());}
  async function store(session,oldHash){
    const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url'));
    if(!(await authDb.query('select 1 from spike.allowed where owner=$1',[session.user.id])).rowCount)throw failure(403,'not_enrolled');
    const cookie=randomBytes(32).toString('hex');
    const c=await authDb.connect();try{await c.query('begin');if(oldHash)await c.query('update spike.sessions set revoked=true where hash=$1',[oldHash]);await c.query("insert into spike.sessions(hash,owner,upstream,sealed,expires) values($1,$2,$3,$4,least(to_timestamp($5),now()+interval '30 minutes'))",[hash(cookie),session.user.id,claims.session_id,seal(session),claims.exp]);await c.query('commit');}catch(e){await c.query('rollback');throw e;}finally{c.release();}
    return cookie;
  }
  async function session(req,aal2=true){
    const cookie=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ys_spike='))?.slice(9);
    if(!cookie||!/^[0-9a-f]{64}$/.test(cookie))throw failure(401,'unauthenticated');
    const r=await authDb.query('select s.* from spike.sessions s join spike.allowed a on a.owner=s.owner where spike.session_valid(s.upstream,s.owner) and s.hash=$1 and not s.revoked and s.expires>now()',[hash(cookie)]);
    if(!r.rowCount)throw failure(401,'revoked_or_expired');
    const row=r.rows[0],tokens=unseal(row.sealed),sb=client();
    const {error}=await sb.auth.getUser(tokens.access_token);if(error)throw failure(401,'invalid_session');
    const claims=JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url'));
    if(aal2&&claims.aal!=='aal2')throw failure(403,'mfa_required');
    return {row,tokens,sb};
  }
  async function ownerTransaction(owner,fn){const c=await appDb.connect();try{await c.query('begin');await c.query("select set_config('spike.owner',$1,true)",[owner]);const result=await fn(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const origin=`http://127.0.0.1:${server.address().port}`;
      if(req.headers.host!==new URL(origin).host)throw failure(403,'invalid_host');
      if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['content-type']!=='application/json'))throw failure(403,'invalid_origin');
      let body={};if(req.method==='POST'){let chunks='',size=0;for await(const b of req){size+=b.length;if(size>4096)throw failure(413,'body_too_large');chunks+=b;}try{body=JSON.parse(chunks);}catch{throw failure(400,'invalid_json');}}
      let result;const path=new URL(req.url,origin).pathname;
      const setCookie=c=>res.setHeader('Set-Cookie',`ys_spike=${c}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`); // HTTP loopback exception; no deployment entry point.
      if(req.method==='POST'&&path==='/login'){
        if(typeof body.email!=='string'||typeof body.password!=='string')throw failure(400,'invalid_login');
        const {data,error}=await client().auth.signInWithPassword(body);if(error)throw failure(401,'invalid_login');setCookie(await store(data.session));result={status:'mfa_required'};
      }else if(req.method==='POST'&&path==='/mfa/enroll'){
        const s=await session(req,false);await s.sb.auth.setSession(s.tokens);const {data,error}=await s.sb.auth.mfa.enroll({factorType:'totp'});if(error)throw failure(400,'mfa_enroll_failed');result={id:data.id,secret:data.totp.secret};
      }else if(req.method==='POST'&&path==='/mfa/verify'){
        const s=await session(req,false);await s.sb.auth.setSession(s.tokens);const {data,error}=await s.sb.auth.mfa.challengeAndVerify({factorId:body.id,code:body.code});if(error)throw failure(403,'mfa_failed');const {data:current}=await s.sb.auth.getSession();setCookie(await store(current.session,s.row.hash));result={status:'authenticated'};
      }else if(req.method==='GET'&&path==='/overview'){
        const s=await session(req);result=await ownerTransaction(s.row.owner,async c=>({plans:(await c.query('select version,target from spike.plans order by version')).rows,decisions:(await c.query('select id,plan_version,reason from spike.decisions order by plan_version')).rows}));
      }else if(req.method==='POST'&&path==='/command'){
        const s=await session(req);
        if(Object.keys(body).sort().join(',')!=='expectedVersion,key,reason,target'||!Number.isInteger(body.expectedVersion)||body.expectedVersion<0||!Number.isInteger(body.target)||body.target<1||body.target>10000||typeof body.reason!=='string'||body.reason.trim().length<1||body.reason.length>500||!/^[0-9a-f-]{36}$/.test(body.key))throw failure(400,'invalid_command');
        const digest=hash(JSON.stringify([body.expectedVersion,body.target,body.reason]));
        result=await ownerTransaction(s.row.owner,async c=>{
          await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[s.row.owner]);
          const old=await c.query('select digest,result from spike.receipts where key=$1',[body.key]);
          if(old.rowCount){if(old.rows[0].digest!==digest)throw failure(409,'idempotency_mismatch');return old.rows[0].result;}
          const version=Number((await c.query('select coalesce(max(version),0) as v from spike.plans')).rows[0].v);
          if(version!==body.expectedVersion)throw failure(409,'version_conflict');
          const next=version+1,id=randomUUID();
          await c.query('insert into spike.plans values($1,$2,$3)',[s.row.owner,next,body.target]);
          if(faults.failAfterPlan){faults.failAfterPlan=false;throw failure(503,'injected_storage_failure');}
          await c.query('insert into spike.decisions values($1,$2,$3,$4)',[s.row.owner,id,next,body.reason]);
          const saved={id,version:next};await c.query('insert into spike.receipts values($1,$2,$3,$4)',[s.row.owner,body.key,digest,saved]);return saved;
        });
        if(faults.dropAfterCommit){faults.dropAfterCommit=false;res.destroy();return;}
      }else if(req.method==='POST'&&path==='/logout'){
        const s=await session(req,false);await authDb.query('update spike.sessions set revoked=true where hash=$1',[s.row.hash]);await s.sb.auth.setSession(s.tokens);const {error}=await s.sb.auth.signOut();res.setHeader('Set-Cookie','ys_spike=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');result={status:error?'locally_revoked_upstream_failed':'signed_out'};
      }else throw failure(404,'not_found');
      res.end(JSON.stringify(result));
    }catch(e){if(!e.status) faults.onError?.(e);res.statusCode=e.status??503;res.end(JSON.stringify({error:e.code??'service_unavailable'}));}
  });
  return server;
}

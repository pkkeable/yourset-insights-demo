import assert from 'node:assert/strict';
import pg from 'pg';
const percentiles=values=>{const a=[...values].sort((x,y)=>x-y),at=p=>a[Math.ceil(a.length*p)-1];return {n:a.length,p50_ms:at(.5),p90_ms:at(.9),p95_ms:at(.95),max_ms:a.at(-1)};};
export async function measureSessionValidity({admin,authDb,request,cookie}){
  // Same live validation predicate, instrumented on the database server. No denial is bypassed.
  await admin.query(`create table spike.validity_timings(ms double precision not null);
    grant insert on spike.validity_timings to yourset_spike_auth;
    create function spike.session_valid_measured(sid uuid, uid uuid) returns boolean
    language plpgsql security invoker set search_path='' as $$
    declare started timestamptz; accepted boolean; elapsed_ms double precision;
    begin
      started := clock_timestamp();
      accepted := spike.session_valid(sid,uid);
      elapsed_ms := extract(epoch from (clock_timestamp()-started))*1000;
      insert into spike.validity_timings values(elapsed_ms);
      return accepted;
    end $$;
    revoke all on function spike.session_valid_measured(uuid,uuid) from public,anon,authenticated;
    grant execute on function spike.session_valid_measured(uuid,uuid) to yourset_spike_auth;`);
  const original=authDb.query;
  authDb.query=function(sql,...args){return original.call(this,typeof sql==='string'?sql.replace('spike.session_valid(s.upstream,s.owner)','spike.session_valid_measured(s.upstream,s.owner)'):sql,...args);};
  const wholeRead=[];
  try{
    for(let i=0;i<20;i++)assert.equal((await request('/overview',{cookie})).status,200);
    await admin.query('truncate spike.validity_timings');
    for(let i=0;i<500;i++){const t=performance.now();const response=await request('/overview',{cookie});wholeRead.push(performance.now()-t);assert.equal(response.status,200);}
    const timings=(await admin.query('select ms from spike.validity_timings')).rows.map(r=>Number(r.ms));
    assert.equal(timings.length,500,'one measured validity evaluation for each authenticated private read');
    console.log(JSON.stringify({measurement:'session_validity_function',...percentiles(timings),unit:'milliseconds',method:'server clock around original session_valid call; includes clock/assignment overhead, excludes timing-row insert and network',warmup_reads:20,concurrency:1}));
    console.log(JSON.stringify({measurement:'authenticated_private_read_instrumented',...percentiles(wholeRead),unit:'milliseconds',method:'HTTP read including Auth lookup, database queries and timing instrumentation',http_errors:0}));
  }finally{authDb.query=original;await admin.query('drop function spike.session_valid_measured(uuid,uuid); drop table spike.validity_timings');}
}
export async function negativeOwnerRegression({admin,connectionString,owner}){
  async function denied(){
    const pool=new pg.Pool({connectionString,max:1});
    try{
      const first=await pool.connect();let pid;
      try{
        pid=(await first.query('select pg_backend_pid() as pid')).rows[0].pid;
        assert.equal((await first.query("select current_setting('spike.owner',true) as owner")).rows[0].owner,null);
        assert.equal((await first.query('select * from spike.plans')).rowCount,0,'unset owner must return no private rows');
        await first.query('begin');await first.query("select set_config('spike.owner',$1,true)",[owner]);
        assert.ok((await first.query('select * from spike.plans')).rowCount>0,'control: populated authorized owner has records');
        await first.query('commit');
      }finally{first.release();}
      const reused=await pool.connect();try{
        assert.equal((await reused.query('select pg_backend_pid() as pid')).rows[0].pid,pid,'test must reuse the same database connection');
        assert.equal((await reused.query("select current_setting('spike.owner',true) as owner")).rows[0].owner,'');
        assert.equal((await reused.query('select * from spike.plans')).rowCount,0,'empty owner after reuse must deny cleanly without returning rows');
      }finally{reused.release();}
    }finally{await pool.end();}
  }
  await denied();
  const definitions=(await admin.query("select tablename,qual,with_check from pg_policies where schemaname='spike' and policyname='owner_only' order by tablename")).rows;
  assert.equal(definitions.length,3);
  const quoted=x=>'"'+x.replaceAll('"','""')+'"';
  let observed;
  try{
    for(const row of definitions){
      const broken="owner = current_setting('spike.owner',true)::uuid";
      await admin.query(`alter policy owner_only on spike.${quoted(row.tablename)} using (${broken}) with check (${broken})`);
    }
    try{await denied();}catch(e){observed=e;}
    assert.ok(observed,'mutation must fail the permanent negative test');
    assert.equal(observed.code,'22P02','expected empty UUID cast failure, not unrelated failure');
    console.log(JSON.stringify({measurement:'negative_test_mutation',result:'expected_failure_observed',sqlstate:'22P02',meaning:'without null normalization, empty-owner denial errors instead of returning zero rows; no data exposure claimed'}));
  }finally{
    for(const row of definitions)await admin.query(`alter policy owner_only on spike.${quoted(row.tablename)} using (${row.qual}) with check (${row.with_check})`);
  }
  await denied();
  const restored=(await admin.query("select tablename,qual,with_check from pg_policies where schemaname='spike' and policyname='owner_only' order by tablename")).rows;
  assert.deepEqual(restored,definitions,'original policy definitions restored exactly');
}

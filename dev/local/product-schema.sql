-- Disposable local product integration schema, independently authored for slice 1.
-- Not a hosted migration or install procedure; runner requires a fresh local database.
create schema yourset;
revoke all on schema yourset from public,anon,authenticated;
create role yourset_app login noinherit;
create role yourset_auth login noinherit;
grant usage on schema yourset to yourset_app,yourset_auth;
create table yourset.allowed(owner uuid primary key);
create table yourset.sessions(hash text primary key,owner uuid not null references yourset.allowed,upstream uuid not null,sealed jsonb not null,expires timestamptz not null,revoked boolean not null default false);
alter table yourset.sessions add column created timestamptz not null default now(), add column last_seen timestamptz not null default now(), add column stage text not null default 'active' check(stage in ('pending','active')), add column factor uuid, add column attempts integer not null default 0, add column upstream_pending boolean not null default false, add column revoke_attempts integer not null default 0, add column retry_at timestamptz not null default now();
create table yourset.auth_throttle(bucket text primary key,attempts integer not null,reset_at timestamptz not null);
create table yourset.evidence(owner uuid primary key references yourset.allowed,revision text not null,data jsonb not null);
create table yourset.plans(owner uuid not null references yourset.allowed,version integer not null check(version>0),effective date not null,content jsonb not null,snapshot jsonb not null,primary key(owner,version),unique(owner,effective));
create table yourset.decisions(owner uuid not null,id uuid not null,plan_version integer,content jsonb not null,snapshot jsonb not null,primary key(owner,id),foreign key(owner,plan_version) references yourset.plans(owner,version));
create table yourset.receipts(owner uuid not null,key uuid not null,digest text not null,version integer not null check(version>=0),ordinal bigint generated always as identity,result jsonb not null,primary key(owner,key));
create table yourset.reviews(owner uuid not null,id uuid not null,decision_id uuid not null,content jsonb not null,snapshot jsonb not null,primary key(owner,id),unique(owner,decision_id),foreign key(owner,decision_id) references yourset.decisions(owner,id));
grant select on yourset.evidence to yourset_app;
grant select,insert on yourset.plans,yourset.decisions,yourset.reviews,yourset.receipts to yourset_app;
grant update(content) on yourset.decisions to yourset_app;
grant select on yourset.allowed,yourset.sessions to yourset_auth;
grant insert,update on yourset.sessions to yourset_auth;
grant select,insert,update,delete on yourset.auth_throttle to yourset_auth;
create function yourset.session_valid(sid uuid,uid uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.sessions where id=sid and user_id=uid)$$;
revoke all on function yourset.session_valid(uuid,uuid) from public,anon,authenticated;
grant execute on function yourset.session_valid(uuid,uuid) to yourset_auth;
alter table yourset.evidence enable row level security;
alter table yourset.plans enable row level security;
alter table yourset.decisions enable row level security;
alter table yourset.receipts enable row level security;
create policy owner_only on yourset.evidence to yourset_app using(owner=nullif(current_setting('yourset.owner',true),'')::uuid);
create policy owner_only on yourset.plans to yourset_app using(owner=nullif(current_setting('yourset.owner',true),'')::uuid) with check(owner=nullif(current_setting('yourset.owner',true),'')::uuid);
create policy owner_only on yourset.decisions to yourset_app using(owner=nullif(current_setting('yourset.owner',true),'')::uuid) with check(owner=nullif(current_setting('yourset.owner',true),'')::uuid);
create policy owner_only on yourset.receipts to yourset_app using(owner=nullif(current_setting('yourset.owner',true),'')::uuid) with check(owner=nullif(current_setting('yourset.owner',true),'')::uuid);

alter table yourset.reviews enable row level security;
create policy owner_only on yourset.reviews to yourset_app using(owner=nullif(current_setting('yourset.owner',true),'')::uuid) with check(owner=nullif(current_setting('yourset.owner',true),'')::uuid);

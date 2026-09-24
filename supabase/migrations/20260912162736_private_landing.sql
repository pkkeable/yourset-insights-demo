-- Dedicated deployment only. No identities, secrets or observations seeded.
create schema if not exists fitness;
revoke all on schema fitness from public, anon;
grant usage on schema fitness to authenticated, service_role;
create table fitness.garmin_record_versions (
  owner_id uuid not null,
  collector_id uuid not null,
  source_key text not null,
  revision integer not null check (revision > 0),
  normalized_hash text not null check (normalized_hash ~ '^[0-9a-f]{64}$'),
  record_kind text not null check (record_kind in ('daily_metric','sleep_session','activity','activity_series')),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  observed_at timestamptz,
  provider_date date,
  fetched_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (owner_id,collector_id,source_key,revision)
);
create table fitness.garmin_sync_runs (
  run_id uuid primary key default gen_random_uuid(),owner_id uuid not null,collector_id uuid not null,
  family text not null,status text not null,request_count integer not null check(request_count>=0),
  window_start date,window_end date,last_success timestamptz,received_at timestamptz not null default now()
);
create table fitness.garmin_ingest_batches (
  owner_id uuid not null,collector_id uuid not null,batch_id uuid not null,
  digest text not null check(digest ~ '^[0-9a-f]{64}$'),receipt jsonb not null,
  received_at timestamptz not null default now(),primary key(owner_id,collector_id,batch_id)
);
create table fitness.garmin_ingest_nonces (
  key_id text not null,nonce text not null,received_at timestamptz not null default now(),
  primary key(key_id,nonce)
);
create table fitness.plan_versions (
  owner_id uuid not null,version_id uuid not null default gen_random_uuid(),
  effective_date date not null,settings jsonb not null,reason text not null,
  created_at timestamptz not null default now(),primary key(owner_id,version_id),unique(owner_id,effective_date)
);
create table fitness.decisions (
  owner_id uuid not null,decision_id uuid not null default gen_random_uuid(),
  choice text not null check(choice in ('accept','edit','defer','reject','continue_unchanged')),
  snapshot jsonb not null,effective_date date not null,review_date date not null,
  created_at timestamptz not null default now(),primary key(owner_id,decision_id),check(review_date>=effective_date)
);
alter table fitness.garmin_record_versions enable row level security;
alter table fitness.garmin_sync_runs enable row level security;
alter table fitness.garmin_ingest_batches enable row level security;
alter table fitness.garmin_ingest_nonces enable row level security;
alter table fitness.plan_versions enable row level security;
alter table fitness.decisions enable row level security;
revoke all on all tables in schema fitness from public,anon,authenticated;
grant all on all tables in schema fitness to service_role;
grant select on fitness.garmin_record_versions,fitness.garmin_sync_runs,fitness.plan_versions,fitness.decisions to authenticated;
create policy owner_mfa_read on fitness.garmin_record_versions for select to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create policy owner_mfa_read on fitness.garmin_sync_runs for select to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create policy owner_mfa_read on fitness.plan_versions for select to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create policy owner_mfa_read on fitness.decisions for select to authenticated using ((select auth.uid())=owner_id and (select auth.jwt()->>'aal')='aal2');
create view fitness.garmin_current with (security_invoker=true) as
select distinct on (owner_id,collector_id,source_key) owner_id,collector_id,source_key,revision,normalized_hash,record_kind,payload,observed_at,provider_date,fetched_at,received_at
from fitness.garmin_record_versions order by owner_id,collector_id,source_key,revision desc;
revoke all on fitness.garmin_current from public,anon;
grant select on fitness.garmin_current to authenticated,service_role;
-- Explicit read columns for physiological observations; never operational secrets.
create view fitness.recovery with (security_invoker=true) as
select owner_id,provider_date,source_key,revision,normalized_hash,
payload->>'metric_key' as metric_key,payload->>'value_number' as value_number,
payload->>'unit' as unit,fetched_at,received_at
from fitness.garmin_current where record_kind='daily_metric';
revoke all on fitness.recovery from public,anon;
grant select on fitness.recovery to authenticated,service_role;

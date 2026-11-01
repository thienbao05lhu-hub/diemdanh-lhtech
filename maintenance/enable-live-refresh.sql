-- Realtime chỉ truyền tín hiệu thay đổi, không truyền bản ghi nghiệp vụ/khóa thiết bị.
-- Chạy sau 120 bằng SQL Editor của chủ project; không đổi UI/quyền ghi các bảng cũ.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
declare t text;
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
  if pg_catalog.to_regprocedure('public.admin_adjust_attendance(uuid,date,text,text,uuid,integer,text)') is null then raise exception 'Cần hoàn tất restore-safe-attendance-admin.sql trước.'; end if;
  foreach t in array array['profiles','attendance','devices','weekly_schedules','audit_logs','leave_requests'] loop
    if pg_catalog.to_regclass('public.'||t) is null then raise exception 'Thiếu bảng public.%',t; end if;
    if pg_catalog.has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE')
      or not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('public.'||t) and relrowsecurity)
      or exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename=t and (cmd<>'SELECT' or policyname<>'contained_read')) then
      raise exception 'Quyền public.% chưa an toàn; dừng cập nhật.',t;
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and not puballtables and pubinsert) then
    raise exception 'Publication supabase_realtime chưa sẵn sàng hoặc đang FOR ALL TABLES; kiểm tra cấu hình Realtime trước.';
  end if;
end;
$preflight$;

create table if not exists public.app_change_events (
  id bigint generated always as identity primary key,
  topic text not null check(topic in ('attendance','leaves','schedules','profiles','devices','audit')),
  profile_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists app_change_events_profile_idx on public.app_change_events(profile_id,id desc);
create index if not exists app_change_events_created_idx on public.app_change_events(created_at);
alter table public.app_change_events enable row level security;
revoke all on table public.app_change_events from public,anon,authenticated;
revoke all on sequence public.app_change_events_id_seq from public,anon,authenticated;
grant select on table public.app_change_events to authenticated;
do $policies$
declare p record;
begin
  for p in select policyname from pg_catalog.pg_policies where schemaname='public' and tablename='app_change_events' loop
    execute format('drop policy %I on public.app_change_events',p.policyname);
  end loop;
end;
$policies$;
create policy app_change_read on public.app_change_events for select to authenticated using (
  (select private.current_app_role()) in ('admin','super_admin')
  or (profile_id=(select auth.uid()) and (select private.current_app_role()) is not null)
);

create or replace function private.emit_app_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare topic_name text; owner_id uuid; data jsonb; event_id bigint;
begin
  -- Trigger nội bộ, không cấp EXECUTE cho client; cho phép các job server hợp lệ không có Auth UID.
  if tg_table_schema<>'public' or tg_table_name not in ('profiles','attendance','devices','weekly_schedules','audit_logs','leave_requests') then
    raise exception 'APP_INVALID_CHANGE_SOURCE';
  end if;
  data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  topic_name:=case tg_table_name when 'weekly_schedules' then 'schedules' when 'leave_requests' then 'leaves'
    when 'audit_logs' then 'audit' else tg_table_name end;
  owner_id:=case when tg_table_name='profiles' then (data->>'id')::uuid
    when tg_table_name='audit_logs' then null else (data->>'profile_id')::uuid end;
  insert into public.app_change_events(topic,profile_id) values(topic_name,owner_id) returning id into event_id;
  -- Đây là tín hiệu tạm, không phải nhật ký nghiệp vụ. Không xóa attendance/đơn/audit.
  if event_id % 100=0 then
    with expired as (
      select id from public.app_change_events where created_at<clock_timestamp()-interval '24 hours' or id<event_id-10000
      order by id limit 1000 for update skip locked
    ) delete from public.app_change_events e using expired x where e.id=x.id;
  end if;
  return null;
end;
$$;
revoke all on function private.emit_app_change() from public,anon,authenticated;
do $triggers$
declare t text;
begin
  foreach t in array array['profiles','attendance','devices','weekly_schedules','audit_logs','leave_requests'] loop
    execute format('drop trigger if exists app_change_notice on public.%I',t);
    execute format('create trigger app_change_notice after insert or update or delete on public.%I for each row execute function private.emit_app_change()',t);
  end loop;
  if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_change_events') then
    alter publication supabase_realtime add table public.app_change_events;
  end if;
end;
$triggers$;

create or replace function private.get_live_refresh_capabilities() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r text; enabled boolean;
begin
  select role into r from public.profiles where id=actor and active;
  if actor is null or r is null then raise exception 'APP_FORBIDDEN'; end if;
  enabled:=pg_catalog.has_table_privilege('authenticated','public.app_change_events','SELECT')
    and exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime' and not puballtables and pubinsert)
    and exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_change_events')
    and (select count(*) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where t.tgname='app_change_notice' and t.tgenabled in ('O','A') and n.nspname='public'
      and c.relname in ('profiles','attendance','devices','weekly_schedules','audit_logs','leave_requests'))=6
    and pg_catalog.has_function_privilege('authenticated','public.admin_adjust_attendance(uuid,date,text,text,uuid,integer,text)','EXECUTE');
  return jsonb_build_object('version',1,'profileId',actor,'role',r,'enabled',enabled);
end;
$$;
create or replace function public.get_live_refresh_capabilities() returns jsonb
language sql security invoker set search_path='' as $$ select private.get_live_refresh_capabilities(); $$;
revoke all on function private.get_live_refresh_capabilities(),public.get_live_refresh_capabilities() from public,anon,authenticated;
grant execute on function private.get_live_refresh_capabilities(),public.get_live_refresh_capabilities() to authenticated;
notify pgrst,'reload schema';
commit;
select 'Đã bật tín hiệu Realtime an toàn; giao diện giữ nguyên, dữ liệu vẫn kiểm tra Auth/RLS khi tải lại.' as result;

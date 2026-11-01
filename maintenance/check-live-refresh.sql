-- Chỉ đọc metadata. Chạy từng SELECT sau enable-live-refresh.sql.
-- Một dòng: rls_enabled=true, anon_access=false, authenticated_read=true,
-- authenticated_raw_write=false, published=true, publication_safe=true.
select c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read,
  pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as authenticated_raw_write,
  exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='app_change_events') as published,
  exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime'
    and not puballtables and pubinsert) as publication_safe
from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('public.app_change_events');

-- Sáu trigger, mỗi bảng một dòng, tgenabled='O'.
select c.relname as table_name,t.tgname,t.tgenabled
from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and t.tgname='app_change_notice'
order by c.relname;

-- anon_execute luôn false; authenticated_execute=true chỉ cho capability,
-- false cho helper emit_app_change. Không đọc event hoặc dữ liệu sinh viên.
select n.nspname as schema_name,p.proname as function_name,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in ('get_live_refresh_capabilities','emit_app_change')
order by p.proname,n.nspname;

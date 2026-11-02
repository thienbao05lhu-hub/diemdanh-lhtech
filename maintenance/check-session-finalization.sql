-- Chỉ đọc metadata, sau restore-safe-session-finalization.sql.
-- Một dòng: rls_enabled=true; ba cột quyền đều false.
select c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access,
  exists(select 1 from pg_catalog.pg_policies where schemaname='private' and tablename='attendance_automation') as client_policy_exists
from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('private.attendance_automation');

-- anon_execute luôn false. authenticated_execute=true chỉ cho admin_close_attendance_session.
select n.nspname as schema_name,p.proname as function_name,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in
  ('run_attendance_automation','finalize_attendance_session','admin_close_attendance_session')
order by p.proname,n.nspname;

-- Sau 140: enabled=false. Sau bật 141: enabled=true, starts_on ngày kích hoạt VN.
-- last_run_at có giá trị sau lần job chạy thành công đầu tiên, không chứng minh các job tương lai.
select enabled,starts_on,enabled_at,last_run_at,last_closed_count from private.attendance_automation;

-- Chỉ đọc metadata; một dòng sau enable-qr-test-mode.sql.
-- test_active=true, automation_enabled=false; giờ hết hạn do server quyết định.
select s.enabled and s.expires_at>private.qr_server_now() as test_active,
  s.started_at,s.expires_at,a.enabled as automation_enabled,
  not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in ('qr_test_settings','qr_test_sessions','qr_test_challenges','qr_test_attendance')
      and (not c.relrowsecurity or pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        or pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) as trial_tables_locked
from private.qr_test_settings s cross join private.attendance_automation a where s.id and a.id;

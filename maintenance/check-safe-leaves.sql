-- Chỉ kiểm tra metadata sau restore-safe-leaves.sql; không đọc đơn/lý do/điểm danh.
-- rls_enabled=true; anon_access=false; authenticated_raw_write=false.
-- authenticated_read chỉ true cho bảng public, false cho private.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read,
  pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as authenticated_raw_write
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname in ('profiles','attendance','leave_requests','audit_logs'))
  or (n.nspname='private' and c.relname in ('qr_sessions','qr_expected_members','qr_challenges','qr_device_bindings','leave_attendance_effects'))
order by n.nspname,c.relname;

-- anon_execute luôn false. authenticated_execute=true chỉ các RPC mới/QR,
-- false cho RPC legacy và helper lock_attendance_slot.
select n.nspname as schema_name,p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f' and p.proname in (
  'student_create_leave_request','admin_decide_leave_request','get_leave_capabilities','lock_attendance_slot',
  'submit_attendance','admin_get_active_qr','admin_close_attendance_session',
  'student_submit_leave_request','admin_review_leave_request','admin_update_attendance',
  'admin_set_attendance_status','student_submit_attendance','admin_set_user_role_and_password','admin_verify_password')
order by p.proname,n.nspname;

-- Chỉ metadata. Chạy sau restore-safe-qr.sql bằng SQL Editor của chủ project.
-- Tất cả anon_access/authenticated_raw_write phải false; rls_enabled phải true.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read,
  pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as authenticated_raw_write
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname in ('profiles','devices','attendance','weekly_schedules',
  'weekly_schedule_revisions','audit_logs','leave_requests'))
  or (n.nspname='private' and c.relname in ('qr_sessions','qr_challenges','qr_expected_members','qr_device_bindings','active_qr_tokens'))
order by n.nspname,c.relname;

-- anon_execute luôn false. authenticated_execute=true chỉ cho đúng RPC QR mới.
-- Các RPC cũ mật khẩu/duyệt nghỉ/sửa điểm danh phải false ở cả hai schema.
select n.nspname as schema_name,p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f' and p.proname in (
  'register_my_device','get_attendance_capabilities','submit_attendance','get_my_attendance',
  'admin_get_active_qr','admin_get_shift_attendance','admin_close_attendance_session','admin_reset_device',
  'student_submit_attendance','admin_set_attendance_status','admin_set_user_role_and_password',
  'admin_verify_password','student_submit_leave_request','admin_review_leave_request','admin_update_attendance')
order by p.proname,n.nspname;

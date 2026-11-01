-- Chỉ metadata; chạy riêng từng SELECT sau restore-safe-attendance-admin.sql.
-- rls_enabled=true, anon_access=false, authenticated_raw_write=false.
-- authenticated_read chỉ true ở public; false ở private.
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
  pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read,
  pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as authenticated_raw_write
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where (n.nspname='public' and c.relname in ('profiles','attendance','leave_requests','audit_logs'))
  or (n.nspname='private' and c.relname in ('manual_excuse_effects','attendance_deleted_versions','leave_attendance_effects','qr_sessions'))
order by n.nspname,c.relname;

-- anon_execute luôn false. authenticated_execute=true cho RPC mới,
-- false cho helper trigger và mọi RPC legacy trong danh sách.
select n.nspname as schema_name,p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f' and p.proname in (
  'admin_adjust_attendance','get_admin_attendance_capabilities','bump_attendance_edit_revision','track_attendance_delete',
  'admin_update_attendance','admin_set_attendance_status','admin_verify_password','admin_set_user_role_and_password',
  'student_submit_attendance','student_submit_leave_request','admin_review_leave_request')
order by p.proname,n.nspname;

-- Hai trigger version phải hiện tgenabled='O' (đang hoạt động).
select t.tgname,t.tgenabled from pg_catalog.pg_trigger t
where t.tgrelid='public.attendance'::regclass and t.tgname in ('attendance_edit_revision','attendance_delete_revision')
order by t.tgname;

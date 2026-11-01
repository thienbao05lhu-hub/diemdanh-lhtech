-- Chỉ đọc; chạy trong SQL Editor sau 90_security_containment.sql.
-- Tất cả cột anon_* và authenticated_raw_write phải false.
select t.table_name,
  pg_catalog.has_table_privilege('anon', 'public.' || t.table_name, 'SELECT') as anon_read,
  pg_catalog.has_table_privilege('anon', 'public.' || t.table_name, 'INSERT,UPDATE,DELETE') as anon_write,
  pg_catalog.has_table_privilege('authenticated', 'public.' || t.table_name, 'INSERT,UPDATE,DELETE') as authenticated_raw_write
from (values ('profiles'),('devices'),('attendance'),('weekly_schedules'),
  ('weekly_schedule_revisions'),('audit_logs'),('leave_requests')) t(table_name);

-- Các RPC tạm dừng phải có anon_execute=false và authenticated_execute=false.
select n.nspname as schema_name, p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f'
  and p.proname in ('submit_attendance','student_submit_attendance',
    'admin_set_attendance_status','admin_set_user_role_and_password',
    'admin_verify_password','student_submit_leave_request',
    'admin_review_leave_request','admin_update_attendance',
    'register_my_device','admin_close_attendance_session','admin_get_active_qr','admin_reset_device')
order by n.nspname,p.proname;

-- Chỉ metadata policy, không đọc dữ liệu nghiệp vụ.
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_catalog.pg_policies
where schemaname='public' and tablename in ('profiles','devices','attendance',
  'weekly_schedules','weekly_schedule_revisions','audit_logs','leave_requests')
order by tablename,policyname;

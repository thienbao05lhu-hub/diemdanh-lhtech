-- Chỉ metadata. anon_execute=false, authenticated_execute=true ở cả hai dòng.
-- public là INVOKER; private là DEFINER, tự kiểm tra Admin đang hoạt động.
select n.nspname,p.proname,p.prosecdef,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname='admin_preview_zalo_report';

-- Xác nhận riêng trạng thái thử; không đọc thông tin sinh viên hoặc nội dung báo cáo.
select enabled as test_mode_configured,enabled and expires_at>clock_timestamp() as test_mode_active,
  (select enabled from private.attendance_automation where id) as real_automation_enabled
from private.qr_test_settings where id;

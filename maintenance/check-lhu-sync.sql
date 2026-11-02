-- Chỉ đọc trạng thái và quyền, không xuất secret, token hoặc dữ liệu lịch cá nhân.
select enabled,worker_seen_at,worker_seen_at>clock_timestamp()-interval '10 minutes' as worker_recent
from private.lhu_sync_settings;
select status,count(*) as jobs from private.lhu_sync_jobs group by status;
select n.nspname,p.proname,
 pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in ('admin_get_lhu_sync','admin_start_lhu_sync','admin_apply_lhu_sync','lhu_claim_item','lhu_finish_item','dispatch_lhu_worker')
order by p.proname,n.nspname;
select jobname,schedule,active from cron.job where jobname='lhtech-lhu-preview-worker';
-- Cron succeeded chỉ có nghĩa đã gửi HTTP. worker_recent mới xác nhận worker đã kết nối DB.

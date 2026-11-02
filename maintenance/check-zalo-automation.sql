-- Chỉ đọc. Không gọi tick, worker hoặc xuất token/người nhận/nội dung báo cáo.
select a.enabled as reports_enabled,d.enabled as delivery_enabled,
 a.starts_at,a.last_run_at,a.last_created,a.last_blocked,
 exists(select 1 from public.profiles p where p.id=a.actor_id and p.active and p.role in ('admin','super_admin')) as actor_ready,
 (select enabled from private.qr_test_settings where id) as trial_enabled,
 (select enabled from private.attendance_automation where id) as attendance_enabled
from private.zalo_report_automation a cross join private.zalo_delivery_settings d where a.id and d.id;

select jobname,schedule,active,command='SELECT private.tick_zalo_reports();' as correct_command
from cron.job where jobname='lhtech-zalo-delivery-worker';
select r.status,r.start_time,r.end_time from cron.job_run_details r join cron.job j on j.jobid=r.jobid
where j.jobname='lhtech-zalo-delivery-worker' order by r.runid desc limit 5;
select status,count(*) as jobs from private.zalo_outbox group by status;

-- Tất cả quyền bên dưới phải false; helper chỉ dành cho owner/hàm server.
select p.proname,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname in ('build_shift_attendance','build_zalo_report','run_zalo_report_automation','tick_zalo_reports');
select c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
from pg_class c where c.oid='private.zalo_report_automation'::regclass;

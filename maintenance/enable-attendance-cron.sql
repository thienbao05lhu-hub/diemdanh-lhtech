-- Chủ project chạy sau 140; cần bật pg_cron tại Integrations > Cron trước.
-- Bật từ ngày Việt Nam hiện tại, không quét lùi lịch sử trước ngày này.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $enable$
declare job_owner text;
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
  if pg_catalog.to_regprocedure('private.run_attendance_automation()') is null then raise exception 'Chạy restore-safe-session-finalization.sql trước.'; end if;
  if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') then raise exception 'Bật pg_cron tại Integrations > Cron, rồi chạy lại file này.'; end if;
  if not pg_catalog.has_function_privilege('authenticated','public.admin_adjust_attendance(uuid,date,text,text,uuid,integer,text)','EXECUTE') then raise exception 'Hệ thống đang containment; không bật Cron.'; end if;
  select username into job_owner from cron.job where jobname='lhtech-attendance-lifecycle';
  if found and job_owner<>current_user then raise exception 'Job cùng tên thuộc người khác; đối chiếu trước khi bật.'; end if;
  update private.attendance_automation set enabled=true,
    starts_on=coalesce(starts_on,(private.qr_server_now() at time zone 'Asia/Ho_Chi_Minh')::date),
    enabled_at=coalesce(enabled_at,private.qr_server_now()) where id=true;
  perform cron.schedule('lhtech-attendance-lifecycle','* * * * *',
    'SET lock_timeout=''2s''; SET statement_timeout=''25s''; SELECT private.run_attendance_automation();');
  -- Chạy lại sau khi chủ đã tắt job thì bật lại đúng job này, không tác động job khác.
  update cron.job set active=true where jobname='lhtech-attendance-lifecycle' and username=current_user;
  insert into public.audit_logs(action,details) values('attendance.automation.enabled',
    jsonb_build_object('job','lhtech-attendance-lifecycle','interval','1 minute'));
end;
$enable$;
commit;
select 'Đã bật Cron mở/chốt ca mỗi phút theo giờ Việt Nam. Không cần mở web để chạy.' as result;

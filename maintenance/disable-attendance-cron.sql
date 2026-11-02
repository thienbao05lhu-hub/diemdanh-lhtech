-- Chủ project chạy khi cần dừng riêng tự động mở/chốt ca; không xóa dữ liệu, không mở quyền.
begin;
set local lock_timeout='5s';
do $stop$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
  update private.attendance_automation set enabled=false where id=true;
  if pg_catalog.to_regclass('cron.job') is not null then
    update cron.job set active=false where jobname='lhtech-attendance-lifecycle' and username=current_user;
  end if;
  insert into public.audit_logs(action,details) values('attendance.automation.disabled','{}');
end;
$stop$;
commit;
select 'Đã dừng tự động mở/chốt ca, giữ nguyên dữ liệu.' as result;

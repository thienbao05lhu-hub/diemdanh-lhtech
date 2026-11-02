-- Chỉ chủ project; không xóa dữ liệu thử, không tự bật lại đánh vắng thật.
begin;
set local lock_timeout='5s';
do $stop$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
  update private.qr_test_settings set enabled=false where id=true;
  insert into public.audit_logs(action,details) values('attendance.test.disabled','{}');
end;
$stop$;
commit;
select 'Đã tắt thử QR. Automation thật vẫn dừng; chỉ bật lại enable-attendance-cron.sql khi sẵn sàng.' as result;

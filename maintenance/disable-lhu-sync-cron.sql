-- Chỉ dừng worker của ứng dụng này, không xóa lịch sử, không tác động Cron điểm danh.
begin;
update private.lhu_sync_settings set enabled=false where id;
do $disable$ declare j record;begin
 for j in select jobid from cron.job where jobname='lhtech-lhu-preview-worker' and username=current_user loop
  perform cron.alter_job(j.jobid,active:=false);
 end loop;
end; $disable$;
commit;

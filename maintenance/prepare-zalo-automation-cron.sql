-- Cron gọi scheduler + dispatcher. Không bật automation hoặc delivery.
begin;
do $setup$ declare jid bigint; owner_name text;begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng chủ project.';end if;
 if to_regprocedure('private.tick_zalo_reports()') is null then raise exception 'Cần SQL 187 trước.';end if;
 select jobid,username into jid,owner_name from cron.job where jobname='lhtech-zalo-delivery-worker';
 if found and owner_name<>current_user then raise exception 'Job thuộc người khác; dừng đối chiếu.';end if;
 perform cron.schedule('lhtech-zalo-delivery-worker','* * * * *','SELECT private.tick_zalo_reports();');
 select jobid into jid from cron.job where jobname='lhtech-zalo-delivery-worker' and username=current_user;
 perform cron.alter_job(jid,active:=true);
end;$setup$;
commit;

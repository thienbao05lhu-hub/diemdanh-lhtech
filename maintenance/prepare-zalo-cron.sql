-- Lập lịch xử lý queue; KHÔNG bật private.zalo_delivery_settings.enabled.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $setup$ declare jid bigint; owner_name text;begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng chủ project.';end if;
 if to_regprocedure('private.dispatch_zalo_worker()') is null or not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'Cần SQL 186 và pg_cron.';end if;
 select jobid,username into jid,owner_name from cron.job where jobname='lhtech-zalo-delivery-worker';
 if found and owner_name<>current_user then raise exception 'Job thuộc người khác; dừng đối chiếu.';end if;
 perform cron.schedule('lhtech-zalo-delivery-worker','* * * * *','SELECT private.dispatch_zalo_worker();');
 select jobid into jid from cron.job where jobname='lhtech-zalo-delivery-worker' and username=current_user;
 perform cron.alter_job(jid,active:=true);
end;$setup$;
commit;

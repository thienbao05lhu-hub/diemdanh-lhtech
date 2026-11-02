-- Chạy sau 170 và sau khi deploy lhu-sync-worker, đặt cùng LHU_WORKER_SECRET ở Edge Secrets.
-- Thay placeholder trong bản riêng; không commit/publish bản có secret.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $enable$
declare worker_secret text:='__LHU_WORKER_SECRET__'; secret_id uuid; job_id bigint; owner_name text;
begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
 if worker_secret='__LHU_WORKER_SECRET__' or length(worker_secret)<32 then raise exception 'Đặt cùng secret ngẫu nhiên với Edge Function trong bản SQL riêng.'; end if;
 if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') or not exists(select 1 from pg_catalog.pg_extension where extname='pg_net') or pg_catalog.to_regclass('vault.secrets') is null then raise exception 'Cần bật pg_cron, pg_net và Vault trước.'; end if;
 if not pg_catalog.has_function_privilege('authenticated','public.admin_apply_lhu_sync(uuid)','EXECUTE') then raise exception 'Cần SQL 170; không bật khi containment.'; end if;
 select username,jobid into owner_name,job_id from cron.job where jobname='lhtech-lhu-preview-worker';
 if found and owner_name<>current_user then raise exception 'Job cùng tên thuộc người khác; dừng đối chiếu.'; end if;
 select id into secret_id from vault.secrets where name='lhtech_lhu_worker_secret';
 if secret_id is null then perform vault.create_secret(worker_secret,'lhtech_lhu_worker_secret','Secret riêng của Edge worker LHU');
 else perform vault.update_secret(secret_id,worker_secret,'lhtech_lhu_worker_secret','Secret riêng của Edge worker LHU');end if;
 update private.lhu_sync_settings set enabled=true where id;
 perform cron.schedule('lhtech-lhu-preview-worker','* * * * *','SELECT private.dispatch_lhu_worker();');
 select jobid into job_id from cron.job where jobname='lhtech-lhu-preview-worker' and username=current_user;
 perform cron.alter_job(job_id,active:=true);
 insert into public.audit_logs(action,details) values('schedule.lhu.worker.enabled',jsonb_build_object('job','lhtech-lhu-preview-worker'));
end; $enable$;
-- Không đưa secret vào cron.job.command hoặc kết quả query.
create or replace function private.dispatch_lhu_worker() returns bigint
language plpgsql security invoker set search_path='' as $$
declare secret text; request_id bigint;
begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'APP_FORBIDDEN';end if;
 if not private.lhu_sync_available() then return null;end if;
 if not exists(select 1 from private.lhu_sync_jobs where status='running')
 and exists(select 1 from private.lhu_sync_settings where worker_seen_at>clock_timestamp()-interval '5 minutes') then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='lhtech_lhu_worker_secret';
 if secret is null then raise exception 'Thiếu secret worker trong Vault.';end if;
 select net.http_post(url:='https://oalnswbnjhkkovxjxtlz.supabase.co/functions/v1/lhu-sync-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-lhu-worker-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=55000) into request_id;
 return request_id;
end; $$;
revoke all on function private.dispatch_lhu_worker() from public,anon,authenticated;
commit;
select 'Đã bật worker LHU. Chỉ lấy bản xem trước khi Admin bấm nút, chưa tự thay lịch.' as result;

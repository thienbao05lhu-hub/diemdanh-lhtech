-- Dispatcher chỉ xử lý hàng đợi Admin đã tạo. Không tự bật gửi hoặc tạo báo cáo.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
 if pg_catalog.to_regprocedure('private.zalo_claim_delivery()') is null then raise exception 'Cần SQL 185 trước.';end if;
 if not exists(select 1 from pg_extension where extname='pg_net') then raise exception 'Cần pg_net.';end if;
end;$preflight$;
create or replace function private.dispatch_zalo_worker() returns bigint
language plpgsql security invoker set search_path='' as $$
declare secret text; request_id bigint;
begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'APP_FORBIDDEN';end if;
 if not private.zalo_delivery_available() then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('lhtech.zalo.dispatch',0)) then return null;end if;
 -- Một lần dispatch xử lý một tin. Claim dùng SKIP LOCKED và job không tự retry.
 if not exists(select 1 from private.zalo_outbox where status='pending' or (status='sending' and lease_until<=clock_timestamp())) then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='lhtech_zalo_worker_secret';
 if secret is null or secret !~ '^[0-9a-f]{64}$' then raise exception 'Thiếu worker secret Zalo.';end if;
 select net.http_post(url:='https://oalnswbnjhkkovxjxtlz.supabase.co/functions/v1/zalo-report-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-zalo-worker-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=20000) into request_id;
 return request_id;
end;$$;
revoke all on function private.dispatch_zalo_worker() from public,anon,authenticated;
commit;

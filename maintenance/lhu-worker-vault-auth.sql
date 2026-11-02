-- Backend xác thực Cron bằng Vault; không cần nhập/copy Edge Secret.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.';end if;
 if pg_catalog.to_regprocedure('private.lhu_claim_item()') is null then raise exception 'Cần hoàn tất SQL 170 trước.';end if;
end;$preflight$;
create or replace function private.lhu_authorize_worker(p_secret text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or not private.lhu_sync_available() then return false;end if;
 -- Không trả plaintext/hash hoặc metadata Vault cho caller.
 return exists(select 1 from vault.decrypted_secrets where name='lhtech_lhu_worker_secret'
  and sha256(convert_to(decrypted_secret,'UTF8'))=sha256(convert_to(p_secret,'UTF8')));
end;$$;
create or replace function public.lhu_authorize_worker(p_secret text) returns boolean
language sql security invoker set search_path='' as $$select private.lhu_authorize_worker(p_secret);$$;
revoke all on function public.lhu_authorize_worker(text),private.lhu_authorize_worker(text) from public,anon,authenticated;
grant execute on function public.lhu_authorize_worker(text),private.lhu_authorize_worker(text) to service_role;
notify pgrst,'reload schema';
commit;

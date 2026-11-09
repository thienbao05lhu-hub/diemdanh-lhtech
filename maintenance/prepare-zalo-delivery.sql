-- Hàng đợi Zalo: mặc định tắt. Không tạo Cron, không gửi HTTP trong migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng chủ project.';end if;
 if pg_catalog.to_regprocedure('private.admin_preview_zalo_report(date,text,text)') is null then raise exception 'Cần SQL 180 trước.';end if;
 if pg_catalog.to_regclass('vault.decrypted_secrets') is null then raise exception 'Cần Vault trước.';end if;
end;$preflight$;
create table if not exists private.zalo_delivery_settings (
 id boolean primary key default true check(id),enabled boolean not null default false,
 recipient_id text check(length(recipient_id) between 1 and 200 and recipient_id !~ '[[:cntrl:]]'),
 recipient_confirmed_at timestamptz,
 check(not enabled or (recipient_id is not null and recipient_confirmed_at is not null))
);
insert into private.zalo_delivery_settings(id) values(true) on conflict(id) do nothing;
create table if not exists private.zalo_outbox (
 id uuid primary key default gen_random_uuid(),session_id uuid references private.qr_sessions(id),
 leave_id uuid references public.leave_requests(id) on delete cascade,
 report_type text not null check(report_type in ('early','closing','leave')),
 actor_id uuid not null references public.profiles(id),recipient_id text not null,
 body text not null check(length(body) between 1 and 2000),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','unknown','cancelled')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 lease_id uuid,lease_until timestamptz,finished_at timestamptz,message_id text,error_code text,
 unique(session_id,report_type)
);
alter table private.zalo_outbox alter column session_id drop not null;
alter table private.zalo_outbox add column if not exists leave_id uuid references public.leave_requests(id) on delete cascade;
alter table private.zalo_outbox drop constraint if exists zalo_outbox_report_type_check;
alter table private.zalo_outbox add constraint zalo_outbox_report_type_check check(report_type in ('early','closing','leave'));
alter table private.zalo_outbox drop constraint if exists zalo_outbox_target_check;
alter table private.zalo_outbox add constraint zalo_outbox_target_check check(
 (report_type in ('early','closing') and session_id is not null and leave_id is null)
 or (report_type='leave' and session_id is null and leave_id is not null)
);
create unique index if not exists zalo_outbox_leave_unique on private.zalo_outbox(leave_id) where leave_id is not null;
create index if not exists zalo_outbox_pending on private.zalo_outbox(created_at,id) where status='pending';
create index if not exists zalo_outbox_sending on private.zalo_outbox(lease_until) where status='sending';
alter table private.zalo_delivery_settings enable row level security;
alter table private.zalo_outbox enable row level security;
revoke all on table private.zalo_delivery_settings,private.zalo_outbox from public,anon,authenticated;

create or replace function private.zalo_delivery_available() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select enabled and recipient_confirmed_at is not null from private.zalo_delivery_settings where id),false)
 and not exists(select 1 from private.qr_test_settings where id and enabled)
 and pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE')
 and pg_catalog.has_function_privilege('authenticated','private.submit_attendance(text,text)','EXECUTE')
 and exists(select 1 from vault.decrypted_secrets where name='lhtech_zalo_bot_token' and length(decrypted_secret)>10);
$$;
create or replace function private.zalo_delivery_dto(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'status',case when status='sending' and lease_until<clock_timestamp() then 'unknown' else status end,
 'createdAt',created_at,'finishedAt',finished_at,'errorCode',error_code,'sent',status='sent')
 from private.zalo_outbox where id=p_id;
$$;
create or replace function private.admin_enqueue_zalo_report(p_date date,p_shift text,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); report jsonb; cfg private.zalo_delivery_settings%rowtype; job uuid;
begin
 perform 1 from public.profiles where id=actor and active and role in ('admin','super_admin') for no key update;
 if not found then raise exception 'APP_FORBIDDEN';end if;
 select * into cfg from private.zalo_delivery_settings where id for share;
 if not private.zalo_delivery_available() then raise exception 'APP_ZALO_DISABLED';end if;
 if p_date is null or not isfinite(p_date) or p_shift is null or p_shift not in ('Sáng','Chiều','Tối')
   or p_type is null or p_type not in ('early','closing') then raise exception 'APP_INVALID_INPUT';end if;
 select o.id into job from private.zalo_outbox o join private.qr_sessions s on s.id=o.session_id
   where s.business_date=p_date and s.shift=p_shift and o.report_type=p_type;
 if found then return private.zalo_delivery_dto(job);end if;
 report:=private.admin_preview_zalo_report(p_date,p_shift,p_type);
 if not coalesce((report->>'ready')::boolean,false) then raise exception 'APP_ZALO_REPORT_NOT_READY';end if;
 if length(report->>'text') not between 1 and 2000 then raise exception 'APP_ZALO_REPORT_TOO_LONG';end if;
 insert into private.zalo_outbox(session_id,report_type,actor_id,recipient_id,body,expires_at)
 values((report->>'sessionId')::uuid,p_type,actor,cfg.recipient_id,report->>'text',clock_timestamp()+interval '10 minutes')
 on conflict(session_id,report_type) do nothing returning id into job;
 if job is null then select id into job from private.zalo_outbox where session_id=(report->>'sessionId')::uuid and report_type=p_type;
 else insert into public.audit_logs(actor_id,action,details) values(actor,'zalo.report.queued',jsonb_build_object('jobId',job,'type',p_type));end if;
 return private.zalo_delivery_dto(job);
end;$$;
create or replace function private.admin_get_zalo_delivery(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN';end if;
 return private.zalo_delivery_dto(p_id);
end;$$;

-- Chỉ service_role có quyền gọi; secret/recipient không trả cho trình duyệt.
create or replace function private.zalo_authorize_worker(p_secret text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_secret is null or p_secret !~ '^[0-9a-f]{64}$' or not private.zalo_delivery_available() then return false;end if;
 return exists(select 1 from vault.decrypted_secrets where name='lhtech_zalo_worker_secret'
   and sha256(convert_to(decrypted_secret,'UTF8'))=sha256(convert_to(p_secret,'UTF8')));
end;$$;
create or replace function private.zalo_claim_delivery() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.zalo_delivery_settings%rowtype; j private.zalo_outbox%rowtype; token text; n timestamptz:=clock_timestamp();
begin
 select * into cfg from private.zalo_delivery_settings where id for share;
 if not private.zalo_delivery_available() then return null;end if;
 -- Worker chết sau HTTP có thể đã gửi. Không trả lại pending hoặc tự thử lại.
 update private.zalo_outbox set status='unknown',error_code='WORKER_EXPIRED',finished_at=n where status='sending' and lease_until<=n;
 update private.zalo_outbox o set status='cancelled',error_code='STALE_JOB',finished_at=n where status='pending'
   and (expires_at<=n or recipient_id<>cfg.recipient_id
     or not exists(select 1 from public.profiles p where p.id=o.actor_id and p.active and (o.report_type='leave' or p.role in ('admin','super_admin')))
     or (report_type='early' and exists(select 1 from private.qr_sessions s where s.id=o.session_id and (s.closed_at is not null or s.ends_at<=n)))
     or (report_type='leave' and not exists(select 1 from public.leave_requests l where l.id=o.leave_id and l.status='pending')));
 select * into j from private.zalo_outbox where status='pending' order by created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='lhtech_zalo_bot_token';
 update private.zalo_outbox set status='sending',lease_id=gen_random_uuid(),lease_until=n+interval '2 minutes' where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'leaseId',j.lease_id,'token',token,'chatId',j.recipient_id,'text',j.body);
end;$$;
create or replace function private.zalo_finish_delivery(p_id uuid,p_lease_id uuid,p_outcome text,p_message_id text,p_error_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare j private.zalo_outbox%rowtype; next_status text;
begin
 if p_outcome is null or p_outcome not in ('sent','rejected','unknown') then raise exception 'APP_INVALID_INPUT';end if;
 if p_outcome='sent' and (p_message_id is null or length(p_message_id) not between 1 and 200 or p_message_id ~ '[[:cntrl:]]') then raise exception 'APP_INVALID_INPUT';end if;
 if p_outcome<>'sent' and (p_error_code is null or p_error_code not in ('ZALO_REJECTED','ZALO_UNKNOWN','INVALID_CONFIG')) then raise exception 'APP_INVALID_INPUT';end if;
 next_status:=case p_outcome when 'rejected' then 'failed' else p_outcome end;
 select * into j from private.zalo_outbox where id=p_id for update;
 if not found or p_lease_id is null or j.lease_id is distinct from p_lease_id then return false;end if;
 if j.status=next_status then return true;end if;
 if j.status not in ('sending','unknown') then return false;end if;
 -- Kết quả đến muộn với cùng lease có thể giải quyết unknown, không tạo lần gửi khác.
 update private.zalo_outbox set status=next_status,finished_at=clock_timestamp(),
   message_id=case when p_outcome='sent' then p_message_id else null end,
   error_code=case when p_outcome='sent' then null else p_error_code end where id=j.id;
 insert into public.audit_logs(action,details) values('zalo.report.result',jsonb_build_object('jobId',j.id,'status',next_status));
 return true;
end;$$;
create or replace function public.admin_enqueue_zalo_report(p_date date,p_shift text,p_type text) returns jsonb
language sql security invoker set search_path='' as $$select private.admin_enqueue_zalo_report(p_date,p_shift,p_type);$$;
create or replace function public.admin_get_zalo_delivery(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.admin_get_zalo_delivery(p_id);$$;
create or replace function public.zalo_authorize_worker(p_secret text) returns boolean
language sql security invoker set search_path='' as $$select private.zalo_authorize_worker(p_secret);$$;
create or replace function public.zalo_claim_delivery() returns jsonb
language sql security invoker set search_path='' as $$select private.zalo_claim_delivery();$$;
create or replace function public.zalo_finish_delivery(p_id uuid,p_lease_id uuid,p_outcome text,p_message_id text,p_error_code text) returns boolean
language sql security invoker set search_path='' as $$select private.zalo_finish_delivery(p_id,p_lease_id,p_outcome,p_message_id,p_error_code);$$;
do $grants$ declare signature text;begin
 revoke all on function private.zalo_delivery_available(),private.zalo_delivery_dto(uuid) from public,anon,authenticated;
 foreach signature in array array['admin_enqueue_zalo_report(date,text,text)','admin_get_zalo_delivery(uuid)',
   'zalo_authorize_worker(text)','zalo_claim_delivery()','zalo_finish_delivery(uuid,uuid,text,text,text)'] loop
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
  execute 'grant execute on function public.'||signature||' to '||case when signature like 'admin_%' then 'authenticated' else 'service_role' end;
  execute 'grant execute on function private.'||signature||' to '||case when signature like 'admin_%' then 'authenticated' else 'service_role' end;
 end loop;
 grant usage on schema private to service_role;
end;$grants$;
notify pgrst,'reload schema';
commit;

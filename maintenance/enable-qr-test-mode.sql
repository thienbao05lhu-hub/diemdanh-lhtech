-- Chế độ thử QR ngoài giờ 24h: dữ liệu thử private, không ghi public.attendance.
-- Chủ project chạy sau 140. Tạm dừng automation thật; không thay UI/Auth/RLS cũ.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
  if pg_catalog.to_regclass('private.attendance_automation') is null or pg_catalog.to_regclass('public.app_change_events') is null then raise exception 'Cần hoàn tất SQL 130/140 trước.'; end if;
  if not pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE') then raise exception 'Đang containment; không mở thử QR.'; end if;
end;
$preflight$;
create table if not exists private.qr_test_settings (
  id boolean primary key default true check(id),enabled boolean not null default false,
  context_id uuid not null default gen_random_uuid(),started_at timestamptz,expires_at timestamptz,
  check(not enabled or (started_at is not null and expires_at>started_at))
);
insert into private.qr_test_settings(id) values(true) on conflict(id) do nothing;
create table if not exists private.qr_test_sessions (
  id uuid primary key default gen_random_uuid(),context_id uuid not null,business_date date not null,
  shift text not null check(shift in ('Sáng','Chiều','Tối')),closed_at timestamptz,
  unique(context_id,business_date,shift)
);
create table if not exists private.qr_test_challenges (
  token_hash text primary key,token text not null,session_id uuid not null references private.qr_test_sessions(id),
  issued_at timestamptz not null,expires_at timestamptz not null
);
create index if not exists qr_test_challenge_expiry_idx on private.qr_test_challenges(session_id,expires_at desc);
create table if not exists private.qr_test_attendance (
  id uuid primary key default gen_random_uuid(),session_id uuid not null references private.qr_test_sessions(id),
  profile_id uuid not null references public.profiles(id),status text not null check(status in ('Có mặt','Đi trễ')),
  scanned_at timestamptz not null,unique(session_id,profile_id)
);
create index if not exists qr_test_attendance_profile_idx on private.qr_test_attendance(profile_id,scanned_at desc);
alter table private.qr_test_settings enable row level security;
alter table private.qr_test_sessions enable row level security;
alter table private.qr_test_challenges enable row level security;
alter table private.qr_test_attendance enable row level security;
revoke all on table private.qr_test_settings,private.qr_test_sessions,private.qr_test_challenges,private.qr_test_attendance from public,anon,authenticated;

create or replace function private.qr_test_context(p_admin boolean default false) returns private.qr_test_settings
language plpgsql security invoker set search_path='' as $$
declare cfg private.qr_test_settings%rowtype;
begin
  perform 1 from public.profiles where id=auth.uid() and active and (not p_admin or role in ('admin','super_admin')) for no key update;
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  select * into cfg from private.qr_test_settings where id=true for share;
  if cfg.id is null or not cfg.enabled or cfg.expires_at<=private.qr_server_now()
    or not pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE') then raise exception 'APP_TEST_MODE_EXPIRED'; end if;
  return cfg;
end;
$$;
create or replace function private.qr_test_shift(p_now timestamptz) returns text
language sql stable security invoker set search_path='' as $$
  select case when (p_now at time zone 'Asia/Ho_Chi_Minh')::time<time '12:00' then 'Sáng'
    when (p_now at time zone 'Asia/Ho_Chi_Minh')::time<time '18:00' then 'Chiều' else 'Tối' end;
$$;
create or replace function private.get_qr_test_mode() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; n timestamptz:=private.qr_server_now();
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'APP_FORBIDDEN'; end if;
  select * into cfg from private.qr_test_settings where id=true;
  return jsonb_build_object('version',1,'profileId',auth.uid(),'testMode',coalesce(cfg.enabled and cfg.expires_at>n,false)
    and pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE'),
    'serverTime',n,'expiresAt',cfg.expires_at);
end;
$$;
create or replace function private.qr_test_get_capabilities() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; s private.qr_test_sessions%rowtype; n timestamptz; label text; day date;
begin
  cfg:=private.qr_test_context();n:=private.qr_server_now();label:=private.qr_test_shift(n);day:=(n at time zone 'Asia/Ho_Chi_Minh')::date;
  select * into s from private.qr_test_sessions where context_id=cfg.context_id and business_date=day and shift=label;
  return jsonb_build_object('version',1,'testMode',true,'profileId',auth.uid(),'qrEnabled',true,'serverTime',n,
    'window',jsonb_build_object('date',day,'shift',label,'endsAt',cfg.expires_at),'sessionId',s.id,
    'sessionClosed',s.closed_at is not null,'canScan',s.id is not null and s.closed_at is null,
    'deviceBound',exists(select 1 from private.qr_device_bindings where profile_id=auth.uid()));
end;
$$;
create or replace function private.qr_test_admin_get_qr() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; s private.qr_test_sessions%rowtype; c private.qr_test_challenges%rowtype; n timestamptz; label text;
begin
  cfg:=private.qr_test_context(true);n:=private.qr_server_now();label:=private.qr_test_shift(n);
  insert into private.qr_test_sessions(context_id,business_date,shift) values(cfg.context_id,(n at time zone 'Asia/Ho_Chi_Minh')::date,label)
    on conflict(context_id,business_date,shift) do nothing;
  select * into s from private.qr_test_sessions where context_id=cfg.context_id and business_date=(n at time zone 'Asia/Ho_Chi_Minh')::date and shift=label for update;
  n:=private.qr_server_now();if n>=cfg.expires_at then raise exception 'APP_TEST_MODE_EXPIRED'; end if;
  if s.closed_at is not null then raise exception 'APP_SESSION_CLOSED'; end if;
  select * into c from private.qr_test_challenges where session_id=s.id and expires_at>n order by expires_at desc limit 1;
  if not found then
    c.token:=substr(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),1,32);
    c.token_hash:=encode(sha256(convert_to(c.token,'UTF8')),'hex');c.session_id:=s.id;c.issued_at:=n;c.expires_at:=least(n+interval '30 seconds',cfg.expires_at);
    insert into private.qr_test_challenges values(c.*);
    delete from private.qr_test_challenges where expires_at<n-interval '5 minutes';
  end if;
  return jsonb_build_object('version',1,'testMode',true,'token',c.token,'serverTime',n,'expiresAt',c.expires_at,
    'expiresIn',extract(epoch from c.expires_at-n),'sessionId',s.id,'date',s.business_date,'shift',s.shift);
end;
$$;
create or replace function private.qr_test_submit(p_qr_token text,p_device_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; s private.qr_test_sessions%rowtype; c private.qr_test_challenges%rowtype;
  a private.qr_test_attendance%rowtype; n timestamptz; duplicate boolean:=false; cutoff time;
begin
  cfg:=private.qr_test_context();
  if p_qr_token is null or p_qr_token !~ '^[0-9a-f]{32}$' or p_device_fingerprint is null or length(p_device_fingerprint) not between 10 and 255 then raise exception 'APP_INVALID_INPUT'; end if;
  if not exists(select 1 from private.qr_device_bindings where profile_id=auth.uid() and token_hash=encode(sha256(convert_to(p_device_fingerprint,'UTF8')),'hex')) then raise exception 'APP_DEVICE_MISMATCH'; end if;
  select * into c from private.qr_test_challenges where token_hash=encode(sha256(convert_to(p_qr_token,'UTF8')),'hex');
  if not found then raise exception 'APP_INVALID_QR'; end if;
  select * into s from private.qr_test_sessions where id=c.session_id for update;n:=private.qr_server_now();
  if n>=cfg.expires_at then raise exception 'APP_TEST_MODE_EXPIRED'; end if;
  if s.context_id<>cfg.context_id or c.expires_at<=n or c.issued_at>n or s.business_date<>(n at time zone 'Asia/Ho_Chi_Minh')::date or s.shift<>private.qr_test_shift(n) then raise exception 'APP_INVALID_QR'; end if;
  if s.closed_at is not null then raise exception 'APP_SESSION_CLOSED'; end if;
  select * into a from private.qr_test_attendance where session_id=s.id and profile_id=auth.uid();duplicate:=found;
  if not duplicate then
    cutoff:=case s.shift when 'Sáng' then time '08:31' when 'Chiều' then time '13:31' else time '18:31' end;
    insert into private.qr_test_attendance(session_id,profile_id,status,scanned_at)
      values(s.id,auth.uid(),case when (n at time zone 'Asia/Ho_Chi_Minh')::time<cutoff then 'Có mặt' else 'Đi trễ' end,n) returning * into a;
    insert into public.audit_logs(actor_id,action,target_id,details) values(auth.uid(),'attendance.test.scan',auth.uid(),jsonb_build_object('testMode',true,'sessionId',s.id));
    insert into public.app_change_events(topic,profile_id) values('attendance',auth.uid());
  end if;
  return jsonb_build_object('success',true,'testMode',true,'alreadyScanned',duplicate,'data',jsonb_build_object('id',a.id,
    'profileId',auth.uid(),'studentId',(select student_id from public.profiles where id=auth.uid()),'shift',s.shift,'date',s.business_date,
    'status',a.status,'scannedAt',a.scanned_at,'inSchedule',false));
end;
$$;
create or replace function private.qr_test_admin_get_shift(p_date date,p_shift text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; s private.qr_test_sessions%rowtype; result jsonb;
begin
  cfg:=private.qr_test_context(true);
  if p_date is null or not isfinite(p_date) or p_shift is null or p_shift not in ('Sáng','Chiều','Tối') then raise exception 'APP_INVALID_INPUT'; end if;
  select * into s from private.qr_test_sessions where context_id=cfg.context_id and business_date=p_date and shift=p_shift;
  select coalesce(jsonb_agg(jsonb_build_object('profileId',p.id,'userId',p.student_id,'userName',p.display_name,'department',coalesce(to_jsonb(p)->>'department',''),
    'shift',p_shift,'recordId',a.id,'recordRevision',case when a.id is null then 0 else 1 end,'status',coalesce(a.status,'Chưa điểm danh'),
    'timestamp',a.scanned_at,'inSchedule',false,'isLocked',s.closed_at is not null,'note','Thử nghiệm QR','reason','Thử nghiệm QR') order by p.student_id),'[]') into result
    from public.profiles p left join private.qr_test_attendance a on a.profile_id=p.id and a.session_id=s.id where p.active;
  return jsonb_build_object('testMode',true,'date',p_date,'shift',p_shift,'sessionId',s.id,'records',result,
    'isClosed',s.closed_at is not null,'isPastCutoff',false,'cutoffTimeStr','THỬ','closingTimeStr','THỬ',
    'stats',jsonb_build_object('total',jsonb_array_length(result),'present',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Có mặt'),
      'late',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Đi trễ'),'absentWithLeave',0,'absentWithoutLeave',0,
      'waiting',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Chưa điểm danh')));
end;
$$;
create or replace function private.qr_test_get_mine(p_limit integer default 30) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; result jsonb;
begin
  cfg:=private.qr_test_context();
  select coalesce(jsonb_agg(to_jsonb(r) order by r."scannedAt" desc),'[]') into result from
    (select a.id,s.business_date as date,s.shift,a.status,a.scanned_at as "scannedAt",false as "inSchedule",true as "testMode"
     from private.qr_test_attendance a join private.qr_test_sessions s on s.id=a.session_id
     where a.profile_id=auth.uid() and s.context_id=cfg.context_id order by a.scanned_at desc limit least(greatest(coalesce(p_limit,30),1),100)) r;
  return result;
end;
$$;
create or replace function private.qr_test_admin_close(p_date date,p_shift text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; s private.qr_test_sessions%rowtype;
begin
  cfg:=private.qr_test_context(true);
  if p_date is null or p_shift is null or p_shift not in ('Sáng','Chiều','Tối') or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'APP_INVALID_INPUT'; end if;
  select * into s from private.qr_test_sessions where context_id=cfg.context_id and business_date=p_date and shift=p_shift for update;
  if not found then raise exception 'APP_SESSION_NOT_FOUND'; end if;
  if s.closed_at is null then
    update private.qr_test_sessions set closed_at=private.qr_server_now() where id=s.id;
    insert into public.audit_logs(actor_id,action,details) values(auth.uid(),'attendance.test.close',jsonb_build_object('testMode',true,'sessionId',s.id));
    insert into public.app_change_events(topic,profile_id) values('attendance',null);
  end if;
  return jsonb_build_object('sessionId',s.id,'closed',true,'testMode',true);
end;
$$;
create or replace function private.qr_test_admin_edit_capabilities() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.qr_test_context(true);
  return jsonb_build_object('version',1,'profileId',auth.uid(),'editingEnabled',false,'serverTime',private.qr_server_now(),
    'businessDate',(private.qr_server_now() at time zone 'Asia/Ho_Chi_Minh')::date,'testMode',true);
end;
$$;
create or replace function private.qr_test_admin_get_stats() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.qr_test_settings%rowtype; result jsonb;
begin
  cfg:=private.qr_test_context(true);
  select coalesce(jsonb_agg(to_jsonb(r) order by r."userId"),'[]') into result from
    (select p.student_id as "userId",p.display_name as name,coalesce(to_jsonb(p)->>'department','') as department,
      count(a.id) as total,count(a.id) filter(where a.status='Có mặt') as present,count(a.id) filter(where a.status='Đi trễ') as late,0 as excused,0 as unexcused
     from public.profiles p left join (private.qr_test_attendance a join private.qr_test_sessions s on s.id=a.session_id and s.context_id=cfg.context_id)
       on a.profile_id=p.id where p.active group by p.id) r;
  return result;
end;
$$;
-- Wrapper INVOKER và grant có chủ đích, không cấp quyền bảng private.
create or replace function public.get_qr_test_mode() returns jsonb language sql security invoker set search_path='' as $$select private.get_qr_test_mode();$$;
create or replace function public.qr_test_get_capabilities() returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_get_capabilities();$$;
create or replace function public.qr_test_admin_get_qr() returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_admin_get_qr();$$;
create or replace function public.qr_test_submit(p_qr_token text,p_device_fingerprint text) returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_submit(p_qr_token,p_device_fingerprint);$$;
create or replace function public.qr_test_admin_get_shift(p_date date,p_shift text) returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_admin_get_shift(p_date,p_shift);$$;
create or replace function public.qr_test_get_mine(p_limit integer default 30) returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_get_mine(p_limit);$$;
create or replace function public.qr_test_admin_close(p_date date,p_shift text,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_admin_close(p_date,p_shift,p_reason);$$;
create or replace function public.qr_test_admin_edit_capabilities() returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_admin_edit_capabilities();$$;
create or replace function public.qr_test_admin_get_stats() returns jsonb language sql security invoker set search_path='' as $$select private.qr_test_admin_get_stats();$$;
do $grants$
declare signature text;
begin
  revoke all on function private.qr_test_context(boolean),private.qr_test_shift(timestamptz) from public,anon,authenticated;
  foreach signature in array array['get_qr_test_mode()','qr_test_get_capabilities()','qr_test_admin_get_qr()',
    'qr_test_submit(text,text)','qr_test_admin_get_shift(date,text)','qr_test_get_mine(integer)',
    'qr_test_admin_close(date,text,text)','qr_test_admin_edit_capabilities()','qr_test_admin_get_stats()'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
    execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
    execute 'grant execute on function public.'||signature||' to authenticated';
    execute 'grant execute on function private.'||signature||' to authenticated';
  end loop;
end;
$grants$;
-- Khóa config automation trước profile, cùng thứ tự với worker đang chạy.
update private.attendance_automation set enabled=false where id=true;
do $activate$
declare n timestamptz:=private.qr_server_now();
begin
  perform 1 from public.profiles order by id for no key update;
  update private.qr_test_settings set context_id=case when enabled and expires_at>n then context_id else gen_random_uuid() end,
    started_at=case when enabled and expires_at>n then started_at else n end,enabled=true,expires_at=n+interval '24 hours' where id=true;
  insert into public.audit_logs(action,details) values('attendance.test.enabled',jsonb_build_object('expiresAt',n+interval '24 hours','automationPaused',true));
end;
$activate$;
notify pgrst,'reload schema';
commit;
select 'Đã mở thử QR ngoài giờ 24h. Lượt thử tách riêng; tự động đánh vắng thật đang dừng.' as result;

-- Khôi phục riêng điểm danh QR sau 90_security_containment.sql.
-- Chạy toàn bộ bằng SQL Editor của chủ project; không chạy lại installer cũ sau file này.
-- Không cấp quyền ghi bảng trực tiếp; không mở lại RPC mật khẩu/duyệt nghỉ/sửa điểm danh.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare t text;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Chạy bằng SQL Editor của chủ project.';
  end if;
  foreach t in array array['profiles','devices','attendance','weekly_schedules','weekly_schedule_revisions','audit_logs','leave_requests'] loop
    if pg_catalog.to_regclass('public.'||t) is null then raise exception 'Thiếu bảng public.%',t; end if;
    if pg_catalog.has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE')
       or pg_catalog.has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') then
      raise exception 'Chưa khóa quyền cũ. Chạy 90_security_containment.sql trước.';
    end if;
    if not exists (select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('public.'||t) and relrowsecurity)
      or exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename=t
        and (cmd<>'SELECT' or policyname<>'contained_read')) then
      raise exception 'Policy public.% chưa ở trạng thái containment. Dừng cập nhật.',t;
    end if;
  end loop;
  if not exists (select 1 from public.profiles where active and role='super_admin') then
    raise exception 'Thiếu hồ sơ chủ đang hoạt động.';
  end if;
end;
$preflight$;

create table if not exists private.qr_sessions (
  id uuid primary key default gen_random_uuid(),
  business_date date not null check (isfinite(business_date)),
  shift text not null check (shift in ('Sáng','Chiều','Tối')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  close_reason text,
  unique(business_date,shift)
);
create table if not exists private.qr_expected_members (
  session_id uuid not null references private.qr_sessions(id),
  profile_id uuid not null references public.profiles(id),
  student_id text not null,
  display_name text not null,
  schedule_revision bigint not null,
  primary key(session_id,profile_id)
);
create table if not exists private.qr_challenges (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  token text not null check (token ~ '^[0-9a-f]{32}$'),
  session_id uuid not null references private.qr_sessions(id),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at>issued_at)
);
create index if not exists qr_challenges_session_expiry on private.qr_challenges(session_id,expires_at desc);
create table if not exists private.qr_device_bindings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  bound_at timestamptz not null default clock_timestamp()
);
alter table private.qr_sessions enable row level security;
alter table private.qr_expected_members enable row level security;
alter table private.qr_challenges enable row level security;
alter table private.qr_device_bindings enable row level security;
revoke all on table private.qr_sessions,private.qr_expected_members,private.qr_challenges,private.qr_device_bindings from public,anon,authenticated;
-- Token singleton của bản cũ không còn dùng, giữ dòng nhưng thu hồi quyền đọc.
alter table private.active_qr_tokens enable row level security;
revoke all on table private.active_qr_tokens from public,anon,authenticated;
alter table public.attendance add column if not exists qr_session_id uuid references private.qr_sessions(id);
create index if not exists attendance_qr_session_idx on public.attendance(qr_session_id) where qr_session_id is not null;

-- Đồng hồ chỉ thuộc server. Không đọc GUC do client đặt, không nhận giờ từ trình duyệt.
create or replace function private.qr_server_now() returns timestamptz
language sql volatile security invoker set search_path='' as $$ select clock_timestamp(); $$;

create or replace function private.attendance_window(p_now timestamptz)
returns table(business_date date,shift text,starts_at timestamptz,ends_at timestamptz,late_at timestamptz)
language sql stable security invoker set search_path='' as $$
  select d.day,s.label,(d.day+s.start_time) at time zone 'Asia/Ho_Chi_Minh',
    (d.day+s.end_time) at time zone 'Asia/Ho_Chi_Minh',
    (d.day+s.late_time) at time zone 'Asia/Ho_Chi_Minh'
  from (select (p_now at time zone 'Asia/Ho_Chi_Minh')::date as day) d
  cross join (values ('Sáng',time '07:00',time '11:00',time '08:31'),
    ('Chiều',time '13:00',time '17:00',time '13:31'),
    ('Tối',time '18:00',time '22:00',time '18:31')) s(label,start_time,end_time,late_time)
  where isfinite(p_now) and (p_now at time zone 'Asia/Ho_Chi_Minh')::time>=s.start_time
    and (p_now at time zone 'Asia/Ho_Chi_Minh')::time<s.end_time;
$$;

create or replace function private.register_my_device(p_device_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h text; old_hash text; legacy text;
begin
  -- Thứ tự khóa: profile -> session -> attendance. Reset khóa profile theo UUID.
  perform 1 from public.profiles where id=actor and active for no key update;
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  if p_device_token is null or length(p_device_token) not between 10 and 255 then raise exception 'APP_INVALID_INPUT'; end if;
  h:=encode(sha256(convert_to(p_device_token,'UTF8')),'hex');
  select token_hash into old_hash from private.qr_device_bindings where profile_id=actor;
  if found then
    if old_hash<>h then raise exception 'APP_DEVICE_MISMATCH'; end if;
    return jsonb_build_object('profileId',actor,'deviceVerified',true);
  end if;
  select device_fingerprint into legacy from public.devices where profile_id=actor;
  if found and legacy<>p_device_token then raise exception 'APP_DEVICE_MISMATCH'; end if;
  begin
    insert into private.qr_device_bindings(profile_id,token_hash) values(actor,h);
  exception when unique_violation then raise exception 'APP_DEVICE_IN_USE'; end;
  -- Bảng public chỉ giữ dấu đã đăng ký, không chứa bí mật dùng để điểm danh.
  insert into public.devices(profile_id,device_fingerprint) values(actor,'bound-v2:active')
  on conflict(profile_id) do update set device_fingerprint='bound-v2:active',updated_at=clock_timestamp();
  insert into public.audit_logs(actor_id,action,target_id,details)
    values(actor,'device.bind',actor,jsonb_build_object('version',2));
  return jsonb_build_object('profileId',actor,'deviceVerified',true);
end;
$$;

create or replace function private.admin_get_active_qr()
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); w record; s private.qr_sessions%rowtype;
  c private.qr_challenges%rowtype; n timestamptz; new_id uuid;
begin
  perform 1 from public.profiles where id=actor and active and role in ('admin','super_admin') for no key update;
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  n:=private.qr_server_now();
  select * into w from private.attendance_window(n);
  if not found then raise exception 'APP_OUTSIDE_WINDOW'; end if;
  insert into private.qr_sessions(business_date,shift,starts_at,ends_at)
    values(w.business_date,w.shift,w.starts_at,w.ends_at) on conflict(business_date,shift) do nothing returning id into new_id;
  select * into s from private.qr_sessions where business_date=w.business_date and shift=w.shift for update;
  n:=private.qr_server_now();
  if n>=s.ends_at or n<s.starts_at then raise exception 'APP_OUTSIDE_WINDOW'; end if;
  if s.closed_at is not null then raise exception 'APP_SESSION_CLOSED'; end if;
  if new_id is not null then
    insert into private.qr_expected_members(session_id,profile_id,student_id,display_name,schedule_revision)
      select s.id,p.id,p.student_id,p.display_name,ws.revision from public.profiles p
      join public.weekly_schedules ws on ws.profile_id=p.id
      where p.active and ws.week_start=s.business_date-((extract(isodow from s.business_date)::int)-1)
        and (ws.schedule->(array['t2','t3','t4','t5','t6','t7','cn'])[extract(isodow from s.business_date)::int]) ? s.shift;
    insert into public.audit_logs(actor_id,action,details)
      values(actor,'attendance.session.open',jsonb_build_object('sessionId',s.id,'date',s.business_date,'shift',s.shift));
  end if;
  select * into c from private.qr_challenges where session_id=s.id and expires_at>n order by expires_at desc limit 1;
  if not found then
    c.token:=substr(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),1,32);
    c.token_hash:=encode(sha256(convert_to(c.token,'UTF8')),'hex');
    c.session_id:=s.id; c.issued_at:=n; c.expires_at:=least(n+interval '30 seconds',s.ends_at);
    insert into private.qr_challenges values(c.*);
    -- Chỉ dọn mã ngắn hạn đã hết hạn, không xóa lịch sử điểm danh.
    delete from private.qr_challenges where expires_at<n-interval '5 minutes';
  end if;
  return jsonb_build_object('version',1,'token',c.token,'expiresAt',c.expires_at,'serverTime',n,
    'expiresIn',greatest(0,extract(epoch from c.expires_at-n)),'sessionId',s.id,'shift',s.shift,'date',s.business_date);
end;
$$;

create or replace function private.submit_attendance(p_qr_token text,p_device_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.profiles%rowtype; c private.qr_challenges%rowtype;
  s private.qr_sessions%rowtype; w record; n timestamptz; a public.attendance%rowtype;
  duplicate boolean:=false; expected boolean;
begin
  select * into p from public.profiles where id=actor and active for no key update;
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  if p_qr_token is null or p_qr_token !~ '^[0-9a-f]{32}$' or p_device_fingerprint is null
    or length(p_device_fingerprint) not between 10 and 255 then raise exception 'APP_INVALID_INPUT'; end if;
  if not exists(select 1 from private.qr_device_bindings where profile_id=actor
    and token_hash=encode(sha256(convert_to(p_device_fingerprint,'UTF8')),'hex')) then raise exception 'APP_DEVICE_MISMATCH'; end if;
  select * into c from private.qr_challenges where token_hash=encode(sha256(convert_to(p_qr_token,'UTF8')),'hex');
  if not found then raise exception 'APP_INVALID_QR'; end if;
  select * into s from private.qr_sessions where id=c.session_id for update;
  n:=private.qr_server_now();
  select * into w from private.attendance_window(n);
  if not found then raise exception 'APP_OUTSIDE_WINDOW'; end if;
  if c.expires_at<=n or c.issued_at>n or s.business_date<>w.business_date or s.shift<>w.shift then raise exception 'APP_INVALID_QR'; end if;
  if s.closed_at is not null then raise exception 'APP_SESSION_CLOSED'; end if;
  select * into a from public.attendance where profile_id=actor and business_date=w.business_date and shift=w.shift for update;
  if found then
    if a.is_locked then raise exception 'APP_SHIFT_LOCKED'; end if;
    duplicate:=a.status in ('Có mặt','Đi trễ');
  end if;
  if not duplicate then
    expected:=exists(select 1 from private.qr_expected_members where session_id=s.id and profile_id=actor);
    insert into public.attendance(profile_id,student_id,business_date,shift,status,scanned_at,device_fingerprint,in_schedule,qr_session_id)
      values(actor,p.student_id,w.business_date,w.shift,case when n<w.late_at then 'Có mặt' else 'Đi trễ' end,n,null,expected,s.id)
      on conflict(profile_id,business_date,shift) do update set status=excluded.status,scanned_at=excluded.scanned_at,
        device_fingerprint=null,note=null,in_schedule=excluded.in_schedule,qr_session_id=excluded.qr_session_id,updated_at=n
      returning * into a;
    insert into public.audit_logs(actor_id,action,target_id,details) values(actor,'attendance.scan',actor,
      jsonb_build_object('sessionId',s.id,'date',w.business_date,'shift',w.shift,'status',a.status));
  end if;
  return jsonb_build_object('success',true,'alreadyScanned',duplicate,'data',jsonb_build_object(
    'id',a.id,'profileId',actor,'studentId',p.student_id,'displayName',p.display_name,
    'date',a.business_date,'shift',a.shift,'status',a.status,'scannedAt',a.scanned_at,'inSchedule',a.in_schedule));
end;
$$;

create or replace function private.admin_close_attendance_session(p_date date,p_shift text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s private.qr_sessions%rowtype;
begin
  perform 1 from public.profiles where id=actor and active and role in ('admin','super_admin') for no key update;
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  if p_date is null or not isfinite(p_date) or p_shift is null or p_shift not in ('Sáng','Chiều','Tối')
    or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'APP_INVALID_INPUT'; end if;
  select * into s from private.qr_sessions where business_date=p_date and shift=p_shift for update;
  if not found then raise exception 'APP_SESSION_NOT_FOUND'; end if;
  if s.closed_at is null then
    update private.qr_sessions set closed_at=private.qr_server_now(),closed_by=actor,close_reason=btrim(p_reason) where id=s.id;
    update public.attendance set is_locked=true,updated_at=clock_timestamp() where business_date=p_date and shift=p_shift;
    insert into public.audit_logs(actor_id,action,details) values(actor,'attendance.session.close',
      jsonb_build_object('sessionId',s.id,'date',p_date,'shift',p_shift,'reason',btrim(p_reason)));
  end if;
  return jsonb_build_object('sessionId',s.id,'closed',true);
end;
$$;

create or replace function private.admin_reset_device(p_profile_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r text; target_role text;
begin
  if actor is null then raise exception 'APP_FORBIDDEN'; end if;
  perform 1 from public.profiles where id in (actor,p_profile_id) order by id for no key update;
  select role into r from public.profiles where id=actor and active;
  if r is null or r not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
  select role into target_role from public.profiles where id=p_profile_id;
  if target_role is null then raise exception 'APP_PROFILE_NOT_FOUND'; end if;
  if r='admin' and target_role<>'student' then raise exception 'APP_FORBIDDEN'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'APP_INVALID_INPUT'; end if;
  delete from private.qr_device_bindings where profile_id=p_profile_id;
  delete from public.devices where profile_id=p_profile_id;
  insert into public.audit_logs(actor_id,action,target_id,details)
    values(actor,'device.reset',p_profile_id,jsonb_build_object('reason',btrim(p_reason)));
  return jsonb_build_object('success',true,'profileId',p_profile_id);
end;
$$;

create or replace function private.get_my_attendance(p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'APP_FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'date',a.business_date,'shift',a.shift,
    'status',a.status,'scannedAt',a.scanned_at,'inSchedule',a.in_schedule) order by a.business_date desc,a.scanned_at desc,a.id),'[]')
    into result from (select * from public.attendance where profile_id=auth.uid()
      order by business_date desc,scanned_at desc,id limit least(greatest(coalesce(p_limit,30),1),100)) a;
  return result;
end;
$$;

-- Đọc danh sách theo ảnh chụp khi mở phiên; sửa lịch tuần không viết lại phiên cũ.
create or replace function private.admin_get_shift_attendance(p_date date,p_shift text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.qr_sessions%rowtype; result jsonb; n timestamptz:=private.qr_server_now();
  closing time; cutoff time;
begin
  if private.current_app_role() is null or private.current_app_role() not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
  if p_date is null or not isfinite(p_date) or p_shift is null or p_shift not in ('Sáng','Chiều','Tối') then raise exception 'APP_INVALID_INPUT'; end if;
  select * into s from private.qr_sessions where business_date=p_date and shift=p_shift;
  closing:=case p_shift when 'Sáng' then time '11:00' when 'Chiều' then time '17:00' else time '22:00' end;
  cutoff:=case p_shift when 'Sáng' then time '08:31' when 'Chiều' then time '13:31' else time '18:31' end;
  with expected as (
    select m.profile_id,m.student_id,m.display_name from private.qr_expected_members m where m.session_id=s.id
    union all
    select p.id,p.student_id,p.display_name from public.profiles p join public.weekly_schedules ws on ws.profile_id=p.id
      where s.id is null and p.active and ws.week_start=p_date-(extract(isodow from p_date)::int-1)
      and (ws.schedule->(array['t2','t3','t4','t5','t6','t7','cn'])[extract(isodow from p_date)::int]) ? p_shift
  ), actual as (select * from public.attendance where business_date=p_date and shift=p_shift),
  rows as (
    select coalesce(e.profile_id,a.profile_id) as profile_id,coalesce(e.student_id,a.student_id) as student_id,
      coalesce(e.display_name,p.display_name) as display_name,e.profile_id is not null as expected,a.status,a.scanned_at,a.is_locked,a.note
    from expected e full join actual a on a.profile_id=e.profile_id
    left join public.profiles p on p.id=a.profile_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('profileId',r.profile_id,'userId',r.student_id,'userName',r.display_name,
    'department','','shift',p_shift,'status',coalesce(r.status,'Chưa điểm danh'),'timestamp',r.scanned_at,
    'inSchedule',r.expected,'isLocked',coalesce(r.is_locked,false),'note',coalesce(r.note,''),'reason',coalesce(r.note,''))
    order by r.student_id),'[]') into result from rows r;
  return jsonb_build_object('date',p_date,'shift',p_shift,'sessionId',s.id,'records',result,
    'isClosed',s.closed_at is not null or n>=(p_date+closing) at time zone 'Asia/Ho_Chi_Minh',
    'isPastCutoff',n>=(p_date+cutoff) at time zone 'Asia/Ho_Chi_Minh',
    'cutoffTimeStr',to_char(cutoff,'HH24:MI'),'closingTimeStr',to_char(closing,'HH24:MI'),
    'stats',jsonb_build_object('total',jsonb_array_length(result),
      'present',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Có mặt'),
      'late',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Đi trễ'),
      'absentWithLeave',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Vắng có phép'),
      'absentWithoutLeave',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Vắng không phép'),
      'waiting',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Chưa điểm danh')));
end;
$$;

create or replace function private.get_attendance_capabilities()
returns jsonb language plpgsql security definer set search_path='' as $$
declare n timestamptz:=private.qr_server_now(); w record; s private.qr_sessions%rowtype; enabled boolean;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'APP_FORBIDDEN'; end if;
  enabled:=pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','private.submit_attendance(text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','public.register_my_device(text)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','private.register_my_device(text)','EXECUTE');
  select * into w from private.attendance_window(n);
  if found then select * into s from private.qr_sessions where business_date=w.business_date and shift=w.shift; end if;
  return jsonb_build_object('version',1,'qrEnabled',enabled,'profileId',auth.uid(),'serverTime',n,
    'window',case when w.shift is null then null else jsonb_build_object('date',w.business_date,'shift',w.shift,'endsAt',w.ends_at) end,
    'sessionId',s.id,'sessionClosed',s.closed_at is not null,
    'canScan',enabled and s.id is not null and s.closed_at is null,
    'deviceBound',exists(select 1 from private.qr_device_bindings where profile_id=auth.uid()));
end;
$$;

-- Wrapper public dùng SECURITY INVOKER; kiểm tra quyền nằm trong hàm private.
create or replace function public.submit_attendance(p_qr_token text,p_device_fingerprint text) returns jsonb
language sql security invoker set search_path='' as $$ select private.submit_attendance(p_qr_token,p_device_fingerprint); $$;
create or replace function public.admin_get_active_qr() returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_get_active_qr(); $$;
create or replace function public.admin_get_shift_attendance(p_date date,p_shift text) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_get_shift_attendance(p_date,p_shift); $$;
create or replace function public.admin_reset_device(p_profile_id uuid,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_reset_device(p_profile_id,p_reason); $$;
create or replace function public.get_my_attendance(p_limit integer default 30) returns jsonb
language sql security invoker set search_path='' as $$ select private.get_my_attendance(p_limit); $$;
create or replace function public.register_my_device(p_device_token text) returns jsonb
language sql security invoker set search_path='' as $$ select private.register_my_device(p_device_token); $$;
create or replace function public.get_attendance_capabilities() returns jsonb
language sql security invoker set search_path='' as $$ select private.get_attendance_capabilities(); $$;
create or replace function public.admin_close_attendance_session(p_date date,p_shift text,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_close_attendance_session(p_date,p_shift,p_reason); $$;

-- Chỉ mở đúng các chữ ký đã kiểm tra. Mọi overload RPC cũ nguy hiểm tiếp tục khóa.
do $grants$
declare f record; signature text;
begin
  for f in select p.oid,n.nspname,p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' and p.proname in (
      'qr_server_now','attendance_window','register_my_device','get_attendance_capabilities','admin_close_attendance_session',
      'submit_attendance','admin_get_active_qr','admin_get_shift_attendance','admin_reset_device','get_my_attendance',
      'student_submit_attendance','admin_set_attendance_status','admin_set_user_role_and_password',
      'admin_verify_password','student_submit_leave_request','admin_review_leave_request','admin_update_attendance',
      'admin_force_new_qr','admin_update_week_schedule','get_or_create_qr_token') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
  end loop;
  foreach signature in array array['register_my_device(text)','get_attendance_capabilities()',
    'admin_close_attendance_session(date,text,text)','submit_attendance(text,text)',
    'admin_get_active_qr()','admin_get_shift_attendance(date,text)','admin_reset_device(uuid,text)','get_my_attendance(integer)'] loop
    execute 'grant execute on function public.'||signature||' to authenticated';
    execute 'grant execute on function private.'||signature||' to authenticated';
  end loop;
end;
$grants$;
notify pgrst,'reload schema';
commit;
select 'Đã bật QR an toàn. Duyệt nghỉ, sửa điểm danh, LHU và Zalo vẫn tạm khóa.' as result;

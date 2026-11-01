-- Khôi phục xin nghỉ/duyệt nghỉ sau 90 và 100. Chủ project chạy toàn bộ trong SQL Editor.
-- Giữ dữ liệu cũ; không mở RPC legacy nhận MSSV/reviewer từ client.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
declare t text; c text;
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Chạy bằng SQL Editor của chủ project.';
  end if;
  foreach t in array array['profiles','devices','attendance','weekly_schedules','weekly_schedule_revisions','audit_logs','leave_requests'] loop
    if pg_catalog.to_regclass('public.'||t) is null then raise exception 'Thiếu bảng public.%',t; end if;
    if pg_catalog.has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE')
      or not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('public.'||t) and relrowsecurity)
      or exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename=t and (cmd<>'SELECT' or policyname<>'contained_read')) then
      raise exception 'Quyền/policy public.% chưa được khóa đúng; dừng cập nhật.',t;
    end if;
  end loop;
  foreach c in array array['id','profile_id','student_id','user_name','department','date','shift','reason','status',
    'reviewed_by','reviewed_by_name','reviewed_at','review_reason','created_at','updated_at'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='leave_requests' and column_name=c) then
      raise exception 'Thiếu cột leave_requests.%; cần đối chiếu schema cũ trước.',c;
    end if;
  end loop;
  if pg_catalog.to_regclass('private.qr_sessions') is null
    or pg_catalog.to_regprocedure('private.qr_server_now()') is null
    or not pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE') then
    raise exception 'Cần hoàn tất restore-safe-qr.sql trước.';
  end if;
  if not exists(select 1 from public.profiles where active and role='super_admin') then raise exception 'Thiếu chủ project đang hoạt động.'; end if;
end;
$preflight$;

alter table public.leave_requests add column if not exists revision integer not null default 1 check(revision>0);
-- Nếu dữ liệu cũ bị trùng thì dừng, không tự xóa/gộp đơn.
create unique index if not exists leave_requests_profile_slot_unique on public.leave_requests(profile_id,date,shift) where profile_id is not null;
create index if not exists leave_requests_profile_created_idx on public.leave_requests(profile_id,created_at desc,id desc);
create index if not exists leave_requests_status_created_idx on public.leave_requests(status,created_at desc,id desc);

create table if not exists private.leave_attendance_effects (
  leave_id uuid primary key references public.leave_requests(id) on delete restrict,
  attendance_id uuid not null,
  before_row jsonb,
  applied_row jsonb not null,
  applied_at timestamptz not null,
  revoked_at timestamptz
);
alter table private.leave_attendance_effects enable row level security;
revoke all on table private.leave_attendance_effects from public,anon,authenticated;

-- Khóa chung cho ca ngay cả khi chưa có qr_sessions; cùng thứ tự profile -> slot -> session -> attendance.
create or replace function private.lock_attendance_slot(p_date date,p_shift text) returns void
language sql volatile security invoker set search_path='' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lhtech.attendance:'||(p_date-date '2000-01-01')::text||':'||p_shift,0));
$$;
revoke all on function private.lock_attendance_slot(date,text) from public,anon,authenticated;

-- QR_SLOT_FUNCTIONS_BEGIN (đồng bộ từ nguồn 100_safe_qr.sql khi đóng gói)
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
  perform private.lock_attendance_slot(w.business_date,w.shift);
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
  perform private.lock_attendance_slot((select business_date from private.qr_sessions where id=c.session_id),
    (select shift from private.qr_sessions where id=c.session_id));
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
  perform private.lock_attendance_slot(p_date,p_shift);
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
      coalesce(e.display_name,p.display_name) as display_name,e.profile_id is not null as expected,a.id as record_id,coalesce((to_jsonb(a)->>'edit_revision')::integer,1) as record_revision,a.status,a.scanned_at,a.is_locked,a.note
    from expected e full join actual a on a.profile_id=e.profile_id
    left join public.profiles p on p.id=a.profile_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('profileId',r.profile_id,'userId',r.student_id,'userName',r.display_name,
    'department','','shift',p_shift,'recordId',r.record_id,'recordRevision',case when r.record_id is null then 0 else r.record_revision end,'status',coalesce(r.status,'Chưa điểm danh'),'timestamp',case when r.status in ('Có mặt','Đi trễ') then r.scanned_at else null end,
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
-- QR_SLOT_FUNCTIONS_END

create or replace function private.student_create_leave_request(p_date date,p_shift text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.profiles%rowtype; l public.leave_requests%rowtype;
  a public.attendance%rowtype; s private.qr_sessions%rowtype; n timestamptz; today date; finish time;
begin
  select * into p from public.profiles where id=actor and active for no key update;
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  if p_date is null or not isfinite(p_date) or p_shift is null or p_shift not in ('Sáng','Chiều','Tối')
    or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'APP_INVALID_INPUT'; end if;
  perform private.lock_attendance_slot(p_date,p_shift);
  -- Gửi lại không sửa nội dung/trạng thái đơn đã có, kể cả đã hết giờ.
  select * into l from public.leave_requests where student_id=p.student_id and date=p_date and shift=p_shift for update;
  if found then
    if l.profile_id is distinct from actor then raise exception 'APP_LEAVE_OWNERSHIP'; end if;
    return jsonb_build_object('success',true,'alreadySubmitted',true,'data',to_jsonb(l));
  end if;
  n:=private.qr_server_now(); today:=(n at time zone 'Asia/Ho_Chi_Minh')::date;
  if p_date<today or p_date>today+30 then raise exception 'APP_LEAVE_DATE_RANGE'; end if;
  finish:=case p_shift when 'Sáng' then time '11:00' when 'Chiều' then time '17:00' else time '22:00' end;
  select * into s from private.qr_sessions where business_date=p_date and shift=p_shift for update;
  n:=private.qr_server_now();
  if s.closed_at is not null or n>=(p_date+finish) at time zone 'Asia/Ho_Chi_Minh' then raise exception 'APP_SHIFT_LOCKED'; end if;
  select * into a from public.attendance where profile_id=actor and business_date=p_date and shift=p_shift for update;
  if found and (a.is_locked or a.status in ('Có mặt','Đi trễ')) then raise exception 'APP_LEAVE_ATTENDANCE_CONFLICT'; end if;
  insert into public.leave_requests(profile_id,student_id,user_name,department,date,shift,reason,status,created_at,updated_at)
    values(actor,p.student_id,p.display_name,coalesce(to_jsonb(p)->>'department',''),p_date,p_shift,btrim(p_reason),'pending',n,n)
    returning * into l;
  insert into public.audit_logs(actor_id,action,target_id,details) values(actor,'leave.submitted',actor,
    jsonb_build_object('leaveId',l.id,'date',p_date,'shift',p_shift,'revision',l.revision));
  return jsonb_build_object('success',true,'alreadySubmitted',false,'data',to_jsonb(l));
end;
$$;

create or replace function private.admin_decide_leave_request(p_leave_id uuid,p_decision text,p_reason text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; admin public.profiles%rowtype; p public.profiles%rowtype;
  l public.leave_requests%rowtype; a public.attendance%rowtype; previous jsonb;
  effect private.leave_attendance_effects%rowtype; s private.qr_sessions%rowtype;
  n timestamptz; finish time; expected boolean; attendance_change text:='none';
begin
  -- Kiểm tra vai trò trước khi tìm hồ sơ chủ đơn.
  if actor is null or coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
  select profile_id into target from public.leave_requests where id=p_leave_id;
  if not found then raise exception 'APP_LEAVE_NOT_FOUND'; end if;
  if target is null then raise exception 'APP_LEAVE_OWNERSHIP'; end if;
  -- Khóa cả actor/target theo UUID, tránh reset/scan/duyệt chéo tạo chu kỳ khóa.
  perform 1 from public.profiles where id in (actor,target) order by id for no key update;
  select * into admin from public.profiles where id=actor and active and role in ('admin','super_admin');
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  if actor=target then raise exception 'APP_LEAVE_SELF_REVIEW'; end if;
  select * into p from public.profiles where id=target and active;
  if not found then raise exception 'APP_PROFILE_NOT_FOUND'; end if;
  select * into l from public.leave_requests where id=p_leave_id;
  if l.profile_id is distinct from p.id or l.student_id<>p.student_id then raise exception 'APP_LEAVE_OWNERSHIP'; end if;
  if p_decision is null or p_decision not in ('approved','rejected','pending') or p_expected_revision is null or p_expected_revision<1
    or length(coalesce(p_reason,''))>500 then raise exception 'APP_INVALID_INPUT'; end if;
  if l.date is null or not isfinite(l.date) or l.shift is null or l.shift not in ('Sáng','Chiều','Tối') then raise exception 'APP_INVALID_INPUT'; end if;
  perform private.lock_attendance_slot(l.date,l.shift);
  select * into s from private.qr_sessions where business_date=l.date and shift=l.shift for update;
  -- Chốt ca và quét dùng cùng khóa ca. Chỉ khóa đơn sau khi có khóa ca.
  select * into l from public.leave_requests where id=p_leave_id for update;
  if l.revision<>p_expected_revision then raise exception 'APP_LEAVE_STALE'; end if;
  if l.status='reviewing' then raise exception 'APP_LEAVE_RECOVERY_REQUIRED'; end if;
  if l.date is null or not isfinite(l.date) or l.shift not in ('Sáng','Chiều','Tối') then raise exception 'APP_INVALID_INPUT'; end if;
  if not ((l.status='pending' and p_decision in ('approved','rejected'))
    or (l.status='approved' and p_decision='pending') or (l.status='rejected' and p_decision='approved')) then raise exception 'APP_LEAVE_TRANSITION'; end if;
  if p_decision in ('rejected','pending') and length(btrim(coalesce(p_reason,'')))=0 then raise exception 'APP_LEAVE_REASON_REQUIRED'; end if;
  n:=private.qr_server_now();
  finish:=case l.shift when 'Sáng' then time '11:00' when 'Chiều' then time '17:00' else time '22:00' end;
  if s.closed_at is not null or n>=(l.date+finish) at time zone 'Asia/Ho_Chi_Minh' then raise exception 'APP_SHIFT_LOCKED'; end if;
  select * into a from public.attendance where profile_id=target and business_date=l.date and shift=l.shift for update;
  if found and a.is_locked then raise exception 'APP_SHIFT_LOCKED'; end if;
  if p_decision='approved' then
    if a.id is not null and a.status<>'Vắng không phép' then raise exception 'APP_LEAVE_ATTENDANCE_CONFLICT'; end if;
    previous:=case when a.id is null then null else to_jsonb(a) end;
    if s.id is not null then
      expected:=exists(select 1 from private.qr_expected_members where session_id=s.id and profile_id=target);
    else
      expected:=exists(select 1 from public.weekly_schedules ws where ws.profile_id=target
        and ws.week_start=l.date-(extract(isodow from l.date)::int-1)
        and (ws.schedule->(array['t2','t3','t4','t5','t6','t7','cn'])[extract(isodow from l.date)::int]) ? l.shift);
    end if;
    insert into public.attendance(profile_id,student_id,business_date,shift,status,note,in_schedule,scanned_at,updated_at,qr_session_id)
      values(target,p.student_id,l.date,l.shift,'Vắng có phép',l.reason,expected,n,n,s.id)
      on conflict(profile_id,business_date,shift) do update set status=excluded.status,note=excluded.note,
        in_schedule=excluded.in_schedule,updated_at=n,qr_session_id=excluded.qr_session_id
      returning * into a;
    insert into private.leave_attendance_effects(leave_id,attendance_id,before_row,applied_row,applied_at,revoked_at)
      values(l.id,a.id,previous,to_jsonb(a),n,null)
      on conflict(leave_id) do update set attendance_id=excluded.attendance_id,before_row=excluded.before_row,
        applied_row=excluded.applied_row,applied_at=n,revoked_at=null;
    attendance_change:='excused';
  elsif p_decision='pending' then
    select * into effect from private.leave_attendance_effects where leave_id=l.id and revoked_at is null for update;
    if not found then raise exception 'APP_LEAVE_RECOVERY_REQUIRED'; end if;
    if a.id=effect.attendance_id and (to_jsonb(a)-'edit_revision')=(effect.applied_row-'edit_revision')
      and coalesce((to_jsonb(a)->>'edit_revision')::integer,1)=coalesce((effect.applied_row->>'edit_revision')::integer,1) then
      if effect.before_row is null then
        delete from public.attendance where id=a.id;
        attendance_change:='removed_approval_record';
      else
        update public.attendance set status=effect.before_row->>'status',note=effect.before_row->>'note',
          in_schedule=(effect.before_row->>'in_schedule')::boolean,
          scanned_at=(effect.before_row->>'scanned_at')::timestamptz,
          device_fingerprint=effect.before_row->>'device_fingerprint',
          qr_session_id=(effect.before_row->>'qr_session_id')::uuid,updated_at=n where id=a.id;
        attendance_change:='restored_previous';
      end if;
    elsif a.id=effect.attendance_id and a.status in ('Có mặt','Đi trễ') then
      -- QR đã thay vắng bằng có mặt: giữ nguyên điểm danh, chỉ thu hồi quyết định nghỉ.
      attendance_change:='preserved_scan';
    else raise exception 'APP_LEAVE_ATTENDANCE_CONFLICT'; end if;
    update private.leave_attendance_effects set revoked_at=n where leave_id=l.id;
  end if;
  update public.leave_requests set status=p_decision,reviewed_by=admin.student_id,reviewed_by_name=admin.display_name,
    reviewed_at=n,review_reason=btrim(coalesce(p_reason,'')),updated_at=n,revision=revision+1 where id=l.id returning * into l;
  insert into public.audit_logs(actor_id,action,target_id,details) values(actor,'leave.reviewed',target,
    jsonb_build_object('leaveId',l.id,'decision',p_decision,'revision',l.revision,'attendanceChange',attendance_change,'reason',btrim(coalesce(p_reason,''))));
  return jsonb_build_object('success',true,'attendanceChange',attendance_change,'data',to_jsonb(l));
end;
$$;

create or replace function private.get_leave_capabilities() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; n timestamptz:=private.qr_server_now(); enabled boolean;
begin
  select * into p from public.profiles where id=auth.uid() and active;
  if not found then raise exception 'APP_FORBIDDEN'; end if;
  enabled:=pg_catalog.has_function_privilege('authenticated','public.student_create_leave_request(date,text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','private.student_create_leave_request(date,text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','public.admin_decide_leave_request(uuid,text,text,integer)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','private.admin_decide_leave_request(uuid,text,text,integer)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE')
    and pg_catalog.has_function_privilege('authenticated','private.submit_attendance(text,text)','EXECUTE');
  return jsonb_build_object('version',1,'profileId',p.id,'leaveEnabled',enabled,
    'canReview',enabled and p.role in ('admin','super_admin'),'serverTime',n,
    'minDate',(n at time zone 'Asia/Ho_Chi_Minh')::date,'maxDate',(n at time zone 'Asia/Ho_Chi_Minh')::date+30);
end;
$$;

create or replace function public.student_create_leave_request(p_date date,p_shift text,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select private.student_create_leave_request(p_date,p_shift,p_reason); $$;
create or replace function public.admin_decide_leave_request(p_leave_id uuid,p_decision text,p_reason text,p_expected_revision integer) returns jsonb
language sql security invoker set search_path='' as $$ select private.admin_decide_leave_request(p_leave_id,p_decision,p_reason,p_expected_revision); $$;
create or replace function public.get_leave_capabilities() returns jsonb
language sql security invoker set search_path='' as $$ select private.get_leave_capabilities(); $$;

do $grants$
declare f record; signature text;
begin
  for f in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' and p.proname in (
      'student_create_leave_request','admin_decide_leave_request','get_leave_capabilities',
      'student_submit_leave_request','admin_review_leave_request','admin_update_attendance','admin_set_attendance_status',
      'student_submit_attendance','admin_verify_password','admin_set_user_role_and_password') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.oid::regprocedure);
  end loop;
  foreach signature in array array['student_create_leave_request(date,text,text)',
    'admin_decide_leave_request(uuid,text,text,integer)','get_leave_capabilities()'] loop
    execute 'grant execute on function public.'||signature||' to authenticated';
    execute 'grant execute on function private.'||signature||' to authenticated';
  end loop;
end;
$grants$;
notify pgrst,'reload schema';
commit;
select 'Đã bật xin nghỉ và duyệt nghỉ an toàn. Sửa điểm danh thủ công, LHU và Zalo vẫn tạm khóa.' as result;

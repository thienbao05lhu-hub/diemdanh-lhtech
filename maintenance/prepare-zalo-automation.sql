-- Tự tạo báo cáo theo giờ Việt Nam; mặc định tắt, không bật gửi hoặc đổi UI.
-- Helper chỉ owner gọi; wrappers Admin giữ kiểm tra Auth như trước.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng chủ project.';end if;
 if to_regprocedure('private.dispatch_zalo_worker()') is null then raise exception 'Cần SQL 186 trước.';end if;
end;$preflight$;
-- Nguồn nội dung dùng chung từ 120/180, không đổi quy tắc snapshot/điểm danh.
-- Helpers không cấp EXECUTE cho client hoặc service_role.
create or replace function private.build_shift_attendance(p_date date,p_shift text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s private.qr_sessions%rowtype; result jsonb; n timestamptz:=private.qr_server_now();
  closing time; cutoff time;
begin
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
    'department','','shift',p_shift,'recordId',r.record_id,'recordRevision',case when r.record_id is null then coalesce((select revision from private.attendance_deleted_versions d where d.profile_id=r.profile_id and d.business_date=p_date and d.shift=p_shift),0) else r.record_revision end,'status',coalesce(r.status,'Chưa điểm danh'),'timestamp',case when r.status in ('Có mặt','Đi trễ') then r.scanned_at else null end,
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
create or replace function private.build_zalo_report(p_date date,p_shift text,p_type text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n timestamptz:=private.qr_server_now(); s private.qr_sessions%rowtype;
  report jsonb; rows jsonb; stats jsonb; base jsonb; reason text; cutoff time; message text; section text; label text;
begin
  if p_date is null or not isfinite(p_date) or p_shift is null or p_shift not in ('Sáng','Chiều','Tối')
    or p_type is null or p_type not in ('early','closing') then raise exception 'APP_INVALID_INPUT'; end if;
  base:=jsonb_build_object('version',1,'previewOnly',true,'deliveryEnabled',false,'date',p_date,'shift',p_shift,'type',p_type,'generatedAt',n);
  -- Cả khi trial hết hạn, chờ chủ tắt rõ ràng trước khi chuẩn bị báo cáo thật.
  if exists(select 1 from private.qr_test_settings where id and enabled) then
    return base||jsonb_build_object('ready',false,'reason','TEST_MODE','text',null);
  end if;
  if not pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','private.submit_attendance(text,text)','EXECUTE') then
    return base||jsonb_build_object('ready',false,'reason','MAINTENANCE','text',null);
  end if;
  select * into s from private.qr_sessions where business_date=p_date and shift=p_shift;
  cutoff:=case p_shift when 'Sáng' then time '08:31' when 'Chiều' then time '13:31' else time '18:31' end;
  reason:=case when s.id is null then 'SESSION_NOT_OPENED'
    when p_type='closing' and (s.closed_at is null or s.finalized_at is null) then 'SESSION_NOT_FINALIZED'
    when p_type='early' and (n<(p_date+cutoff) at time zone 'Asia/Ho_Chi_Minh' or n>=s.ends_at or s.closed_at is not null) then 'OUTSIDE_EARLY_WINDOW' end;
  if reason is not null then return base||jsonb_build_object('ready',false,'reason',reason,'text',null); end if;
  -- Gọi trực tiếp RPC thật, không đi qua router trial của trình duyệt.
  report:=private.build_shift_attendance(p_date,p_shift);
  select coalesce(jsonb_agg(jsonb_build_object('studentId',r->>'userId',
    'name',regexp_replace(r->>'userName','[[:cntrl:]]',' ','g'),
    'status',r->>'status','inSchedule',(r->>'inSchedule')::boolean) order by r->>'userId'),'[]') into rows
  from jsonb_array_elements(report->'records') r join public.profiles p on p.id=(r->>'profileId')::uuid
  where p.role='student';
  select jsonb_build_object('total',count(*),'expected',count(*) filter(where (r->>'inSchedule')::boolean),
    'present',count(*) filter(where r->>'status'='Có mặt'),'late',count(*) filter(where r->>'status'='Đi trễ'),
    'excused',count(*) filter(where r->>'status'='Vắng có phép'),'unexcused',count(*) filter(where r->>'status'='Vắng không phép'),
    'waiting',count(*) filter(where r->>'status'='Chưa điểm danh')) into stats from jsonb_array_elements(rows) r;
  if exists(select 1 from jsonb_array_elements(rows) r where r->>'status' not in ('Có mặt','Đi trễ','Vắng có phép','Vắng không phép','Chưa điểm danh'))
    or (p_type='closing' and (stats->>'waiting')::integer>0) then
    return base||jsonb_build_object('ready',false,'reason','ATTENDANCE_INCOMPLETE','text',null);
  end if;
  message:=case when p_type='closing' then 'BÁO CÁO CHỐT CA ' else 'BÁO CÁO ĐẦU CA ' end||upper(p_shift)||' ('||to_char(p_date,'DD/MM/YYYY')||')'
    ||E'\nCó mặt đúng giờ: '||(stats->>'present')||E'\nĐi trễ: '||(stats->>'late')
    ||E'\nVắng có phép: '||(stats->>'excused')||E'\nVắng không phép: '||(stats->>'unexcused')
    ||E'\nChưa điểm danh: '||(stats->>'waiting');
  foreach label in array array['Đi trễ','Vắng có phép','Vắng không phép','Chưa điểm danh'] loop
    select string_agg((r->>'studentId')||' - '||(r->>'name'),E'\n' order by r->>'studentId') into section
      from jsonb_array_elements(rows) r where r->>'status'=label;
    if section is not null then message:=message||E'\n\n'||label||E':\n'||section; end if;
  end loop;
  return base||jsonb_build_object('ready',true,'reason',null,'sessionId',s.id,'stats',stats,'text',message);
end;
$$;

revoke all on function private.build_shift_attendance(date,text),private.build_zalo_report(date,text,text) from public,anon,authenticated,service_role;
create or replace function private.admin_get_shift_attendance(p_date date,p_shift text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN';end if;
 return private.build_shift_attendance(p_date,p_shift);
end;$$;
create or replace function private.admin_preview_zalo_report(p_date date,p_shift text,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN';end if;
 return private.build_zalo_report(p_date,p_shift,p_type);
end;$$;
-- CREATE OR REPLACE giữ ACL hiện tại, không tự mở lại quyền containment.
create table if not exists private.zalo_report_automation (
 id boolean primary key default true check(id),enabled boolean not null default false,
 starts_at timestamptz,actor_id uuid references public.profiles(id),last_run_at timestamptz,
 last_created integer not null default 0,last_blocked integer not null default 0,
 check(not enabled or (starts_at is not null and actor_id is not null))
);
insert into private.zalo_report_automation(id) values(true) on conflict(id) do nothing;
alter table private.zalo_report_automation enable row level security;
revoke all on table private.zalo_report_automation from public,anon,authenticated;
create or replace function private.run_zalo_report_automation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cfg private.zalo_report_automation%rowtype; recipient text; n timestamptz; day date;
 candidate record; report jsonb; job uuid; made integer:=0; blocked integer:=0;
begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'APP_FORBIDDEN';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('lhtech.zalo.report.automation',0)) then return jsonb_build_object('status','busy');end if;
 select * into cfg from private.zalo_report_automation where id;
 if not coalesce(cfg.enabled,false) or not private.zalo_delivery_available() then return jsonb_build_object('status','disabled');end if;
 -- Profiles trước settings, cùng thứ tự với enqueue Admin.
 perform 1 from public.profiles where id=cfg.actor_id and active and role in ('admin','super_admin') for no key update;
 if not found then return jsonb_build_object('status','actor_unavailable');end if;
 select * into cfg from private.zalo_report_automation where id for share;
 if not cfg.enabled or not exists(select 1 from public.profiles where id=cfg.actor_id and active and role in ('admin','super_admin')) then return jsonb_build_object('status','disabled');end if;
 select recipient_id into recipient from private.zalo_delivery_settings where id for share;
 if not private.zalo_delivery_available() then return jsonb_build_object('status','disabled');end if;
 n:=private.qr_server_now();day:=(n at time zone 'Asia/Ho_Chi_Minh')::date;
 if n<cfg.starts_at then return jsonb_build_object('status','not_started');end if;
 -- Chỉ đúng ngày hiện tại. Đầu ca trong 10 phút từ cutoff; chốt trong 10 phút sau finalized_at.
 -- Không gửi bù lịch sử trước thời điểm bật automation; không tự mở/chốt ca.
 for candidate in
  select s.id,s.business_date,s.shift,t.kind,t.due_at
  from private.qr_sessions s cross join lateral (values
   ('early',(s.business_date+case s.shift when 'Sáng' then time '08:31' when 'Chiều' then time '13:31' else time '18:31' end) at time zone 'Asia/Ho_Chi_Minh'),
   ('closing',s.finalized_at)) t(kind,due_at)
  where s.business_date=day and t.due_at>=cfg.starts_at and t.due_at<=n and n<t.due_at+interval '10 minutes'
   and ((t.kind='early' and s.closed_at is null and n<s.ends_at) or (t.kind='closing' and s.closed_at is not null))
   and not exists(select 1 from private.zalo_outbox o where o.session_id=s.id and o.report_type=t.kind)
  order by t.due_at,s.id,t.kind
 loop
  report:=private.build_zalo_report(candidate.business_date,candidate.shift,candidate.kind);
  if not coalesce((report->>'ready')::boolean,false) or length(report->>'text') not between 1 and 2000 then blocked:=blocked+1;continue;end if;
  job:=null;
  insert into private.zalo_outbox(session_id,report_type,actor_id,recipient_id,body,expires_at)
  values(candidate.id,candidate.kind,cfg.actor_id,recipient,report->>'text',least(n+interval '10 minutes',candidate.due_at+interval '10 minutes'))
  on conflict(session_id,report_type) do nothing returning id into job;
  if job is not null then
   made:=made+1;
   insert into public.audit_logs(actor_id,action,details) values(cfg.actor_id,'zalo.report.queued',
    jsonb_build_object('jobId',job,'type',candidate.kind,'source','cron'));
  end if;
 end loop;
 update private.zalo_report_automation set last_run_at=n,last_created=made,last_blocked=blocked where id;
 return jsonb_build_object('status','ok','created',made,'blocked',blocked);
end;$$;
revoke all on function private.run_zalo_report_automation() from public,anon,authenticated,service_role;
-- Cron chỉ owner; tạo queue rồi dispatcher xử lý. Không sửa settings enabled.
create or replace function private.tick_zalo_reports() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; request_id bigint;
begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'APP_FORBIDDEN';end if;
 result:=private.run_zalo_report_automation();
 request_id:=private.dispatch_zalo_worker();
 return result||jsonb_build_object('dispatched',request_id is not null);
end;$$;
revoke all on function private.tick_zalo_reports() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;

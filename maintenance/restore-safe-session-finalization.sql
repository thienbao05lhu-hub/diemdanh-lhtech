-- Mở/chốt ca ở database; giữ nguyên UI, Auth UID và lịch sử cũ.
-- Chạy sau 120/130. Tác vụ tự động mặc định tắt cho tới khi bật Cron riêng.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$
declare t text;
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
  if pg_catalog.to_regclass('public.app_change_events') is null
    or pg_catalog.to_regclass('private.manual_excuse_effects') is null
    or not pg_catalog.has_function_privilege('authenticated','public.admin_adjust_attendance(uuid,date,text,text,uuid,integer,text)','EXECUTE') then
    raise exception 'Cần hoàn tất SQL 120 và 130 trước.';
  end if;
  foreach t in array array['profiles','attendance','devices','weekly_schedules','weekly_schedule_revisions','audit_logs','leave_requests'] loop
    if pg_catalog.to_regclass('public.'||t) is null then raise exception 'Thiếu bảng public.%',t; end if;
    if pg_catalog.has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE')
      or not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('public.'||t) and relrowsecurity)
      or exists(select 1 from pg_catalog.pg_policies where schemaname='public' and tablename=t and (cmd<>'SELECT' or policyname<>'contained_read')) then
      raise exception 'Quyền public.% chưa an toàn; dừng cập nhật.',t;
    end if;
  end loop;
end;
$preflight$;

alter table private.qr_sessions add column if not exists finalized_at timestamptz;
alter table private.qr_sessions add column if not exists finalization_source text check(finalization_source in ('admin','cron'));
create index if not exists qr_sessions_unclosed_end_idx on private.qr_sessions(ends_at,business_date) where closed_at is null;
create table if not exists private.attendance_automation (
  id boolean primary key default true check(id),
  enabled boolean not null default false,
  starts_on date check(isfinite(starts_on)),
  enabled_at timestamptz,
  last_run_at timestamptz,
  last_opened_session uuid,
  last_closed_count integer not null default 0,
  check(not enabled or starts_on is not null)
);
insert into private.attendance_automation(id) values(true) on conflict(id) do nothing;
alter table private.attendance_automation enable row level security;
revoke all on table private.attendance_automation from public,anon,authenticated;

-- Nội bộ: caller đã khóa profile theo UUID. Sau đó khóa slot -> session -> attendance.
-- SECURITY INVOKER, không cấp EXECUTE cho client/anon.
create or replace function private.finalize_attendance_session(p_session_id uuid,p_actor uuid,p_source text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s private.qr_sessions%rowtype; n timestamptz; missing_count integer:=0;
begin
  if p_source is null or p_source not in ('admin','cron')
    or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'APP_INVALID_INPUT'; end if;
  select * into s from private.qr_sessions where id=p_session_id;
  if not found then raise exception 'APP_SESSION_NOT_FOUND'; end if;
  perform private.lock_attendance_slot(s.business_date,s.shift);
  select * into s from private.qr_sessions where id=p_session_id for update;
  n:=private.qr_server_now();
  if s.closed_at is not null then
    return jsonb_build_object('sessionId',s.id,'closed',true,'alreadyClosed',true,'absentCreated',0);
  end if;
  if n<s.starts_at or (p_source='cron' and n<s.ends_at) then raise exception 'APP_OUTSIDE_WINDOW'; end if;
  -- Đơn approved bị thiếu điểm danh là dữ liệu cần đối chiếu, không tự biến thành KP.
  if exists(select 1 from private.qr_expected_members m join public.leave_requests l
    on l.profile_id=m.profile_id and l.date=s.business_date and l.shift=s.shift and l.status='approved'
    where m.session_id=s.id and not exists(select 1 from public.attendance a
      where a.profile_id=m.profile_id and a.business_date=s.business_date and a.shift=s.shift)) then
    raise exception 'APP_LEAVE_RECOVERY_REQUIRED';
  end if;
  insert into public.attendance(profile_id,student_id,business_date,shift,status,scanned_at,is_locked,in_schedule,qr_session_id,note,updated_at)
    select m.profile_id,m.student_id,s.business_date,s.shift,'Vắng không phép',n,true,true,s.id,'Chốt ca: chưa ghi nhận điểm danh',n
    from private.qr_expected_members m where m.session_id=s.id
    on conflict(profile_id,business_date,shift) do nothing;
  get diagnostics missing_count=row_count;
  -- Giữ nguyên trạng thái, giờ quét, ghi chú và provenance của mọi bản ghi đã có.
  update public.attendance set is_locked=true,updated_at=n
    where business_date=s.business_date and shift=s.shift and not is_locked;
  update private.qr_sessions set closed_at=n,closed_by=p_actor,close_reason=btrim(p_reason),
    finalized_at=n,finalization_source=p_source where id=s.id;
  insert into public.audit_logs(actor_id,action,details) values(p_actor,'attendance.session.close',
    jsonb_build_object('sessionId',s.id,'date',s.business_date,'shift',s.shift,'source',p_source,
      'absentCreated',missing_count,'reason',btrim(p_reason)));
  return jsonb_build_object('sessionId',s.id,'closed',true,'alreadyClosed',false,'absentCreated',missing_count);
end;
$$;
revoke all on function private.finalize_attendance_session(uuid,uuid,text,text) from public,anon,authenticated;

create or replace function private.admin_close_attendance_session(p_date date,p_shift text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); session_id uuid;
begin
  if actor is null or coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
  if p_date is null or not isfinite(p_date) or p_shift is null or p_shift not in ('Sáng','Chiều','Tối')
    or length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'APP_INVALID_INPUT'; end if;
  -- Một tập profile khóa theo thứ tự cố định, tương thích scan/duyệt/sửa và job.
  perform 1 from public.profiles order by id for no key update;
  if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
  select id into session_id from private.qr_sessions where business_date=p_date and shift=p_shift;
  if not found then raise exception 'APP_SESSION_NOT_FOUND'; end if;
  return private.finalize_attendance_session(session_id,actor,'admin',p_reason);
end;
$$;
revoke all on function private.admin_close_attendance_session(date,text,text) from public,anon,authenticated;
grant execute on function private.admin_close_attendance_session(date,text,text) to authenticated;

-- Chỉ chủ database/Cron được gọi, không có wrapper public hoặc service key trong web.
create or replace function private.run_attendance_automation()
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare cfg private.attendance_automation%rowtype; n timestamptz; w record; candidate record;
  opened uuid; closed_count integer:=0; absences integer:=0; outcome jsonb;
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'APP_FORBIDDEN'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('lhtech.attendance.automation',0)) then
    return jsonb_build_object('status','busy');
  end if;
  select * into cfg from private.attendance_automation where id=true for update;
  if cfg.id is null or not cfg.enabled or not pg_catalog.has_function_privilege('authenticated','public.submit_attendance(text,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','private.submit_attendance(text,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','public.register_my_device(text)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','private.register_my_device(text)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','public.admin_get_active_qr()','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','private.admin_get_active_qr()','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated','public.admin_adjust_attendance(uuid,date,text,text,uuid,integer,text)','EXECUTE') then
    return jsonb_build_object('status','disabled');
  end if;
  n:=private.qr_server_now();
  if (n at time zone 'Asia/Ho_Chi_Minh')::date<cfg.starts_on then return jsonb_build_object('status','not_started'); end if;
  select * into w from private.attendance_window(n);
  -- Lượt kiểm tra bình thường không khóa cả danh sách nếu phiên đã có và chưa đến hạn chốt.
  if (w.shift is not null and not exists(select 1 from private.qr_sessions where business_date=w.business_date and shift=w.shift))
    or exists(select 1 from private.qr_sessions where closed_at is null and ends_at<=n and business_date>=cfg.starts_on) then
    perform 1 from public.profiles order by id for no key update;
    -- Đọc lại giờ sau khóa; không mở bù phiên đã hết giờ từ lịch hiện tại.
    n:=private.qr_server_now();
    select * into w from private.attendance_window(n);
    if w.shift is not null then
      perform private.lock_attendance_slot(w.business_date,w.shift);
      insert into private.qr_sessions(business_date,shift,starts_at,ends_at)
        values(w.business_date,w.shift,w.starts_at,w.ends_at) on conflict(business_date,shift) do nothing returning id into opened;
      if opened is not null then
        insert into private.qr_expected_members(session_id,profile_id,student_id,display_name,schedule_revision)
          select opened,p.id,p.student_id,p.display_name,ws.revision from public.profiles p
          join public.weekly_schedules ws on ws.profile_id=p.id
          where p.active and ws.week_start=w.business_date-(extract(isodow from w.business_date)::int-1)
            and (ws.schedule->(array['t2','t3','t4','t5','t6','t7','cn'])[extract(isodow from w.business_date)::int]) ? w.shift;
        insert into public.audit_logs(action,details) values('attendance.session.open',
          jsonb_build_object('sessionId',opened,'date',w.business_date,'shift',w.shift,'source','cron',
            'snapshotAt',n,'snapshotDelaySeconds',greatest(0,extract(epoch from n-w.starts_at))));
      end if;
    end if;
    for candidate in select id from private.qr_sessions where closed_at is null and ends_at<=n and business_date>=cfg.starts_on
      order by business_date,starts_at limit 12 loop
      outcome:=private.finalize_attendance_session(candidate.id,null,'cron','Tự động chốt khi hết giờ ca');
      if not (outcome->>'alreadyClosed')::boolean then
        closed_count:=closed_count+1; absences:=absences+(outcome->>'absentCreated')::integer;
      end if;
    end loop;
  end if;
  update private.attendance_automation set last_run_at=n,last_opened_session=coalesce(opened,last_opened_session),last_closed_count=closed_count where id=true;
  return jsonb_build_object('status','ok','openedSession',opened,'closedCount',closed_count,'absentCreated',absences);
end;
$$;
revoke all on function private.run_attendance_automation() from public,anon,authenticated;

-- scanned_at cũ là NOT NULL; giờ tạo vắng không được hiển thị thành giờ quét.
create or replace function private.get_my_attendance(p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'APP_FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'date',a.business_date,'shift',a.shift,
    'status',a.status,'scannedAt',case when a.status in ('Có mặt','Đi trễ') then a.scanned_at else null end,
    'inSchedule',a.in_schedule) order by a.business_date desc,a.scanned_at desc,a.id),'[]')
    into result from (select * from public.attendance where profile_id=auth.uid()
      order by business_date desc,scanned_at desc,id limit least(greatest(coalesce(p_limit,30),1),100)) a;
  return result;
end;
$$;
notify pgrst,'reload schema';
commit;
select 'Đã chuẩn bị mở/chốt ca an toàn. Cron chưa bật; giao diện giữ nguyên.' as result;

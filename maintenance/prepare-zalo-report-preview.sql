-- Chỉ tạo bản xem trước cho Admin. Không gửi HTTP, không bật Cron Zalo.
-- Dùng cùng nguồn điểm danh thật với dashboard; không đọc các lượt QR thử.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
  if pg_catalog.to_regclass('private.qr_test_settings') is null
    or not exists(select 1 from information_schema.columns where table_schema='private' and table_name='qr_sessions' and column_name='finalized_at')
    or pg_catalog.to_regprocedure('private.admin_get_shift_attendance(date,text)') is null then
    raise exception 'Cần hoàn tất SQL 120/140/150 trước.';
  end if;
end; $preflight$;

create or replace function private.admin_preview_zalo_report(p_date date,p_shift text,p_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n timestamptz:=private.qr_server_now(); s private.qr_sessions%rowtype;
  report jsonb; rows jsonb; stats jsonb; base jsonb; reason text; cutoff time; message text; section text; label text;
begin
  if auth.uid() is null or coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
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
  report:=private.admin_get_shift_attendance(p_date,p_shift);
  select coalesce(jsonb_agg(jsonb_build_object('studentId',r->>'userId',
    'name',regexp_replace(r->>'userName','[[:cntrl:]]',' ','g'),
    'status',r->>'status','inSchedule',(r->>'inSchedule')::boolean) order by r->>'userId'),'[]') into rows
  from jsonb_array_elements(report->'records') r join public.profiles p on p.id=(r->>'profileId')::uuid
  where p.student_id<>'900000001';
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
create or replace function public.admin_preview_zalo_report(p_date date,p_shift text,p_type text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_preview_zalo_report(p_date,p_shift,p_type);
$$;
revoke all on function private.admin_preview_zalo_report(date,text,text),public.admin_preview_zalo_report(date,text,text) from public,anon,authenticated;
grant execute on function private.admin_preview_zalo_report(date,text,text),public.admin_preview_zalo_report(date,text,text) to authenticated;
notify pgrst,'reload schema';
commit;

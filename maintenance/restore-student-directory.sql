-- Bổ sung lớp và sửa danh sách thử; chạy sau 150. Không gia hạn chế độ thử.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
 if pg_catalog.to_regclass('private.qr_test_attendance') is null then raise exception 'Cần hoàn tất SQL 150 trước.'; end if;
 if pg_catalog.has_table_privilege('anon','public.profiles','SELECT,INSERT,UPDATE,DELETE') or pg_catalog.has_table_privilege('authenticated','public.profiles','INSERT,UPDATE,DELETE') then raise exception 'Quyền profiles chưa an toàn.'; end if;
end; $preflight$;
alter table public.profiles add column if not exists department text not null default '' check(length(department)<=100 and department !~ '[[:cntrl:]]');
create or replace function public.get_my_profile() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'studentId',p.student_id,'displayName',p.display_name,'role',p.role,'department',p.department)
 from public.profiles p where p.id=(select auth.uid()) and p.active;
$$;
revoke all on function public.get_my_profile() from public,anon,authenticated;
grant execute on function public.get_my_profile() to authenticated;
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
    from public.profiles p left join private.qr_test_attendance a on a.profile_id=p.id and a.session_id=s.id where p.active and p.student_id<>'900000001';
  return jsonb_build_object('testMode',true,'date',p_date,'shift',p_shift,'sessionId',s.id,'records',result,
    'isClosed',s.closed_at is not null,'isPastCutoff',false,'cutoffTimeStr','THỬ','closingTimeStr','THỬ',
    'stats',jsonb_build_object('total',jsonb_array_length(result),'present',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Có mặt'),
      'late',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Đi trễ'),'absentWithLeave',0,'absentWithoutLeave',0,
      'waiting',(select count(*) from jsonb_array_elements(result) x where x->>'status'='Chưa điểm danh')));
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
       on a.profile_id=p.id where p.active and p.student_id<>'900000001' group by p.id) r;
  return result;
end;
$$;
notify pgrst,'reload schema';
commit;
select 'Đã bổ sung lớp và tách Admin khỏi danh sách sinh viên thử.' as result;

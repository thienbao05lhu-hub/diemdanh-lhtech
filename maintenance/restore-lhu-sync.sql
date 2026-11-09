-- Xem trước lịch LHU qua Edge worker. Chạy sau 160; mặc định tắt tới khi cấu hình worker.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $preflight$ begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng SQL Editor của chủ project.'; end if;
 if pg_catalog.to_regclass('private.qr_test_settings') is null or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='department') then raise exception 'Cần hoàn tất SQL 150/160 trước.'; end if;
 if pg_catalog.has_table_privilege('anon','public.weekly_schedules','SELECT,INSERT,UPDATE,DELETE') or pg_catalog.has_table_privilege('authenticated','public.weekly_schedules','INSERT,UPDATE,DELETE') then raise exception 'Quyền lịch chưa an toàn.'; end if;
end; $preflight$;
create table if not exists private.lhu_sync_settings (
 id boolean primary key default true check(id),enabled boolean not null default false,
 worker_seen_at timestamptz
);
insert into private.lhu_sync_settings(id) values(true) on conflict(id) do nothing;
create table if not exists private.lhu_sync_jobs (
 id uuid primary key default gen_random_uuid(),week_start date not null check(isfinite(week_start) and extract(isodow from week_start)=1),
 actor_id uuid not null references public.profiles(id),status text not null default 'running' check(status in ('running','completed','failed')),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,applied_at timestamptz
);
create unique index if not exists lhu_one_running_job on private.lhu_sync_jobs((true)) where status='running';
create table if not exists private.lhu_sync_items (
 job_id uuid not null references private.lhu_sync_jobs(id),profile_id uuid not null references public.profiles(id),
 student_id text not null,profile_updated_at timestamptz not null,expected_revision integer not null,
 before_schedule jsonb,status text not null default 'pending' check(status in ('pending','ready','failed','applied','skipped')),
 attempts integer not null default 0,lease_id uuid,lease_until timestamptz,preview jsonb,lesson_count integer,
 message text not null default '',primary key(job_id,profile_id)
);
alter table private.lhu_sync_settings enable row level security;
alter table private.lhu_sync_jobs enable row level security;
alter table private.lhu_sync_items enable row level security;
revoke all on table private.lhu_sync_settings,private.lhu_sync_jobs,private.lhu_sync_items from public,anon,authenticated;

create or replace function private.lhu_sync_available() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select enabled from private.lhu_sync_settings where id),false)
 and pg_catalog.has_function_privilege('authenticated','public.admin_start_lhu_sync(date)','EXECUTE')
 and pg_catalog.has_function_privilege('authenticated','public.admin_apply_lhu_sync(uuid)','EXECUTE');
$$;

create or replace function private.lhu_job_dto(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'status',j.status,'mode',case when j.applied_at is null then 'preview' else 'apply' end,
 'week',jsonb_build_object('start',j.week_start,'end',j.week_start+6),'total',count(i.profile_id),
 'processed',count(*) filter(where i.status<>'pending'),'success',count(*) filter(where i.status in ('ready','applied')),
 'failed',count(*) filter(where i.status='failed'),'skipped',count(*) filter(where i.status='skipped'),
 'canApply',j.status='completed' and j.applied_at is null and clock_timestamp()<j.created_at+interval '2 hours' and count(*) filter(where i.status='ready')>0,
 'errors',coalesce(jsonb_agg(jsonb_build_object('userId',i.student_id,'message',i.message) order by i.student_id) filter(where i.status in ('failed','skipped')),'[]'::jsonb),
 'changes',coalesce(jsonb_agg(jsonb_build_object('userId',i.student_id,'before',i.before_schedule,'after',i.preview,'lessons',i.lesson_count) order by i.student_id) filter(where i.status='ready'),'[]'::jsonb))
 from private.lhu_sync_jobs j left join private.lhu_sync_items i on i.job_id=j.id where j.id=p_job_id group by j.id;
$$;
create or replace function private.admin_get_lhu_sync() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j uuid;
begin
 if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
 select id into j from private.lhu_sync_jobs order by created_at desc,id desc limit 1;
 return jsonb_build_object('configured',private.lhu_sync_available(),'workerSeenAt',(select worker_seen_at from private.lhu_sync_settings where id),'job',private.lhu_job_dto(j));
end; $$;
create or replace function private.admin_start_lhu_sync(p_week_start date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); j uuid; today date:=(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
 if not private.lhu_sync_available() then raise exception 'APP_LHU_NOT_CONFIGURED'; end if;
 if not exists(select 1 from private.lhu_sync_settings where worker_seen_at>clock_timestamp()-interval '10 minutes') then raise exception 'APP_LHU_WORKER_OFFLINE';end if;
 if p_week_start is null or not isfinite(p_week_start) or extract(isodow from p_week_start)<>1 or p_week_start<today-60 or p_week_start>today+60 then raise exception 'APP_INVALID_INPUT'; end if;
 -- Profiles -> job -> schedules; cùng thứ tự với ghi hồ sơ/lịch thủ công.
 lock table public.profiles in share row exclusive mode;
 perform 1 from public.profiles order by id for no key update;
 if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN'; end if;
 -- Lượt quá hạn không giữ khóa toàn hệ thống vĩnh viễn khi worker chưa được triển khai.
 update private.lhu_sync_jobs set status='failed',finished_at=clock_timestamp() where status='running' and created_at<clock_timestamp()-interval '2 hours';
 select id into j from private.lhu_sync_jobs where status='running';
 if found then return private.lhu_job_dto(j); end if;
 insert into private.lhu_sync_jobs(week_start,actor_id) values(p_week_start,actor) returning id into j;
 insert into private.lhu_sync_items(job_id,profile_id,student_id,profile_updated_at,expected_revision,before_schedule,status,message)
 select j,p.id,p.student_id,p.updated_at,coalesce(w.revision,0),w.schedule,
 case when w.source in ('manual','rollback') then 'skipped' else 'pending' end,
 case when w.source in ('manual','rollback') then 'Giữ lịch đã chỉnh thủ công/khôi phục.' else '' end
 from public.profiles p left join public.weekly_schedules w on w.profile_id=p.id and w.week_start=p_week_start
 where p.active and p.role='student';
 if not exists(select 1 from private.lhu_sync_items where job_id=j and status='pending') then
  update private.lhu_sync_jobs set status='completed',finished_at=clock_timestamp() where id=j;
 elsif pg_catalog.to_regprocedure('private.dispatch_lhu_worker()') is not null then
  perform private.dispatch_lhu_worker();
 end if;
 insert into public.audit_logs(actor_id,action,details) values(actor,'schedule.lhu.preview.started',jsonb_build_object('jobId',j,'weekStart',p_week_start));
 return private.lhu_job_dto(j);
end; $$;

-- Worker nhận từng sinh viên, lease có fencing; chỉ service_role gọi được.
create or replace function private.lhu_claim_item() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.lhu_sync_jobs%rowtype; i private.lhu_sync_items%rowtype; n timestamptz:=clock_timestamp();
begin
 if not private.lhu_sync_available() then return null; end if;
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('lhtech.lhu.worker',0)) then return null; end if;
 update private.lhu_sync_settings set worker_seen_at=n where id;
 select * into j from private.lhu_sync_jobs where status='running' for update;
 if not found then return null; end if;
 if j.created_at<n-interval '2 hours' then update private.lhu_sync_jobs set status='failed',finished_at=n where id=j.id;return null;end if;
 if exists(select 1 from private.lhu_sync_items where job_id=j.id and status='pending' and lease_until>n) then return null;end if;
 update private.lhu_sync_items set status='failed',message='Hết số lần thử kết nối LHU.',lease_id=null,lease_until=null
 where job_id=j.id and status='pending' and attempts>=3;
 select * into i from private.lhu_sync_items where job_id=j.id and status='pending' order by (lease_id is null),attempts,student_id limit 1 for update;
 if not found then update private.lhu_sync_jobs set status='completed',finished_at=n where id=j.id;return null;end if;
 update private.lhu_sync_items set attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=n+interval '60 seconds'
 where job_id=j.id and profile_id=i.profile_id returning * into i;
 return jsonb_build_object('jobId',j.id,'profileId',i.profile_id,'studentId',i.student_id,'weekStart',j.week_start,'leaseId',i.lease_id);
end; $$;
create or replace function private.lhu_finish_item(p_job_id uuid,p_profile_id uuid,p_lease_id uuid,p_preview jsonb,p_lesson_count integer,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare i private.lhu_sync_items%rowtype; canonical jsonb; n timestamptz:=clock_timestamp();
begin
 if not private.lhu_sync_available() then return false;end if;
 perform 1 from private.lhu_sync_jobs where id=p_job_id and status='running' for update;
 if not found then return false;end if;
 select * into i from private.lhu_sync_items where job_id=p_job_id and profile_id=p_profile_id for update;
 if not found or i.status<>'pending' or i.lease_id is distinct from p_lease_id or i.lease_until<=n then return false;end if;
 if p_error is null then
  canonical:=private.normalize_week_schedule(p_preview);
  if p_preview is distinct from canonical or p_lesson_count is null or p_lesson_count<0 or p_lesson_count>1000 then raise exception 'APP_INVALID_INPUT';end if;
  update private.lhu_sync_items set status='ready',preview=canonical,lesson_count=p_lesson_count,message='',lease_id=null,lease_until=null where job_id=p_job_id and profile_id=p_profile_id;
 else
  update private.lhu_sync_items set status=case when attempts>=3 then 'failed' else 'pending' end,
   message=left(p_error,200),lease_id=null,lease_until=null where job_id=p_job_id and profile_id=p_profile_id;
 end if;
 if not exists(select 1 from private.lhu_sync_items where job_id=p_job_id and status='pending') then update private.lhu_sync_jobs set status='completed',finished_at=n where id=p_job_id;end if;
 return true;
end; $$;

create or replace function private.admin_apply_lhu_sync(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); j private.lhu_sync_jobs%rowtype; i record; p public.profiles%rowtype; w public.weekly_schedules%rowtype; v integer; n timestamptz:=clock_timestamp();
begin
 if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN';end if;
 if not private.lhu_sync_available() then raise exception 'APP_LHU_NOT_CONFIGURED';end if;
 lock table public.profiles in share row exclusive mode;
 perform 1 from public.profiles order by id for no key update;
 if coalesce(private.current_app_role(),'') not in ('admin','super_admin') then raise exception 'APP_FORBIDDEN';end if;
 select * into j from private.lhu_sync_jobs where id=p_job_id for update;
 if not found or j.status<>'completed' then raise exception 'APP_LHU_NOT_READY';end if;
 if j.applied_at is not null then return private.lhu_job_dto(j.id);end if;
 if n>j.created_at+interval '2 hours' then raise exception 'APP_LHU_PREVIEW_EXPIRED';end if;
 for i in select * from private.lhu_sync_items where job_id=j.id and status='ready' order by profile_id for update loop
  select * into p from public.profiles where id=i.profile_id;
  select * into w from public.weekly_schedules where profile_id=i.profile_id and week_start=j.week_start for update;
  if not p.active or p.role<>'student' or p.updated_at is distinct from i.profile_updated_at or coalesce(w.revision,0)<>i.expected_revision or w.source in ('manual','rollback') then
   update private.lhu_sync_items set status='skipped',message='Hồ sơ/lịch đã thay đổi sau khi xem trước; giữ dữ liệu hiện tại.' where job_id=j.id and profile_id=i.profile_id;
   continue;
  end if;
  v:=coalesce(w.revision,0)+1;
  insert into public.weekly_schedules(profile_id,week_start,schedule,revision,source,updated_by,updated_at)
   values(p.id,j.week_start,i.preview,v,'lhu',actor,n)
   on conflict(profile_id,week_start) do update set schedule=excluded.schedule,revision=excluded.revision,source='lhu',updated_by=actor,updated_at=n;
  insert into public.weekly_schedule_revisions(profile_id,week_start,revision,schedule,source,actor_id,reason)
   values(p.id,j.week_start,v,i.preview,'lhu',actor,'Áp dụng bản xem trước lịch LHU đã xác nhận.');
  delete from public.weekly_schedule_revisions where profile_id=p.id and week_start=j.week_start and revision<=v-50;
  insert into public.audit_logs(actor_id,action,target_id,details) values(actor,'schedule.lhu.applied',p.id,jsonb_build_object('jobId',j.id,'weekStart',j.week_start,'revision',v,'before',i.before_schedule,'after',i.preview));
  update private.lhu_sync_items set status='applied' where job_id=j.id and profile_id=p.id;
 end loop;
 update private.lhu_sync_jobs set applied_at=n where id=j.id;
 return private.lhu_job_dto(j.id);
end; $$;

create or replace function public.admin_get_lhu_sync() returns jsonb language sql security invoker set search_path='' as $$select private.admin_get_lhu_sync();$$;
create or replace function public.admin_start_lhu_sync(p_week_start date) returns jsonb language sql security invoker set search_path='' as $$select private.admin_start_lhu_sync(p_week_start);$$;
create or replace function public.admin_apply_lhu_sync(p_job_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.admin_apply_lhu_sync(p_job_id);$$;
create or replace function public.lhu_claim_item() returns jsonb language sql security invoker set search_path='' as $$select private.lhu_claim_item();$$;
create or replace function public.lhu_finish_item(p_job_id uuid,p_profile_id uuid,p_lease_id uuid,p_preview jsonb,p_lesson_count integer,p_error text) returns boolean language sql security invoker set search_path='' as $$select private.lhu_finish_item(p_job_id,p_profile_id,p_lease_id,p_preview,p_lesson_count,p_error);$$;
revoke all on function private.lhu_sync_available(),private.lhu_job_dto(uuid) from public,anon,authenticated;
do $grants$ declare signature text;begin
 foreach signature in array array['admin_get_lhu_sync()','admin_start_lhu_sync(date)','admin_apply_lhu_sync(uuid)','lhu_claim_item()','lhu_finish_item(uuid,uuid,uuid,jsonb,integer,text)'] loop
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
  if signature like 'admin_%' then
   execute 'grant execute on function public.'||signature||' to authenticated';
   execute 'grant execute on function private.'||signature||' to authenticated';
  else
   execute 'grant execute on function public.'||signature||' to service_role';
   execute 'grant execute on function private.'||signature||' to service_role';
  end if;
 end loop;
end; $grants$;
grant usage on schema private to service_role;
notify pgrst,'reload schema';
commit;
select 'Đã chuẩn bị đồng bộ LHU có xem trước. Cần triển khai Edge worker và bật Cron riêng.' as result;

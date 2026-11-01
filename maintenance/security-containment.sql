-- Khóa quyền khẩn cấp sau các installer PWA/leave/audit mở quyền.
-- 01/11/2026. Chạy bằng SQL Editor của CHỦ project sau khi sao lưu.
-- Đây là chế độ giới hạn ghi: tạm dừng quét/duyệt/sửa điểm danh không an toàn.
-- Giữ Auth, dữ liệu, đọc theo RLS và RPC hồ sơ/lịch tuần đã có kiểm tra quyền.
-- Không xóa dòng dữ liệu, không thay mật khẩu/UID, không tự chạy rollback mở quyền.
-- Nguồn declarative cuối cùng: chạy sau 10/20/30/40 và các SQL cũ nếu đã áp dụng.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare v_table text;
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'Chạy bằng SQL Editor của chủ project, không chạy từ ứng dụng.';
  end if;
  foreach v_table in array array[
    'profiles','devices','attendance','weekly_schedules',
    'weekly_schedule_revisions','audit_logs','leave_requests'
  ] loop
    if pg_catalog.to_regclass('public.' || v_table) is null then
      raise exception 'Thiếu bảng public.%; dừng trước khi sửa quyền.', v_table;
    end if;
  end loop;
  if not exists (select 1 from public.profiles where active and role = 'super_admin') then
    raise exception 'Chưa tìm thấy hồ sơ chủ đang hoạt động; kiểm tra project trước.';
  end if;
end;
$preflight$;

-- Helper đọc role hiện hành bằng UID, không dựa trên localStorage/user_metadata.
create or replace function private.current_app_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.active;
$$;
revoke all on function private.current_app_role() from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant usage on schema public to authenticated;
revoke create on schema public from public, anon, authenticated;

-- Loại mọi policy cũ trên đúng các bảng của ứng dụng, gồm policy permissive khác tên.
-- Chỉ revoke SELECT là chưa đủ nếu policy using(true) vẫn còn trên authenticated.
do $tables$
declare v_table text; v_policy record;
begin
  foreach v_table in array array[
    'profiles','devices','attendance','weekly_schedules',
    'weekly_schedule_revisions','audit_logs','leave_requests'
  ] loop
    for v_policy in
      select policyname from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    if v_table = 'audit_logs' then
      execute format(
        'create policy contained_read on public.%I for select to authenticated '
        'using ((select private.current_app_role()) in (''admin'',''super_admin''))', v_table);
    elsif v_table = 'profiles' then
      execute format(
        'create policy contained_read on public.%I for select to authenticated '
        'using ((id = (select auth.uid()) and active) '
        'or (select private.current_app_role()) in (''admin'',''super_admin''))', v_table);
    else
      execute format(
        'create policy contained_read on public.%I for select to authenticated '
        'using ((profile_id = (select auth.uid()) '
        'and (select private.current_app_role()) is not null) '
        'or (select private.current_app_role()) in (''admin'',''super_admin''))', v_table);
    end if;
  end loop;
  if pg_catalog.to_regclass('public.audit_logs_id_seq') is not null then
    revoke all on sequence public.audit_logs_id_seq from public, anon, authenticated;
  end if;
end;
$tables$;

-- Bảng tín hiệu chỉ xuất hiện sau 130; bản 90 vẫn dùng được trên schema cũ.
do $live_containment$
begin
  if pg_catalog.to_regclass('public.app_change_events') is not null then
    revoke all on table public.app_change_events from public,anon,authenticated;
    revoke all on sequence public.app_change_events_id_seq from public,anon,authenticated;
  end if;
end;
$live_containment$;

-- Thu hồi mọi overload của các API đã xuất hiện trong mã dự án.
-- Hàm đặc quyền không kiểm tra người gọi bị chặn với cả authenticated.
do $functions$
declare v_function record;
begin
  for v_function in
    select n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind = 'f'
      and p.proname = any(array[
        'current_app_role','get_my_profile','normalize_week_schedule','persist_week_schedule',
        'admin_provision_profile','admin_update_profile','admin_save_week_schedule',
        'admin_rollback_week_schedule','get_or_create_qr_token','submit_attendance',
        'admin_get_active_qr','admin_get_shift_attendance','admin_update_attendance',
        'admin_reset_device','get_my_attendance','student_submit_attendance',
        'admin_set_attendance_status','admin_set_user_role_and_password',
        'admin_verify_password','student_submit_leave_request','admin_review_leave_request',
        'admin_force_new_qr','admin_update_week_schedule',
        'register_my_device','admin_close_attendance_session',
        'student_create_leave_request','admin_decide_leave_request','admin_adjust_attendance'
      ])
  loop
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated',
      v_function.nspname, v_function.proname, v_function.args);
  end loop;
end;
$functions$;

-- Chỉ mở lại đúng các chữ ký đã có kiểm tra danh tính/role trong nguồn 10/20/30/40.
-- submit/update-attendance và các RPC PWA/leave cũ chờ bản thay thế an toàn.
do $allowlist$
declare v_signature text; v_oid oid;
begin
  foreach v_signature in array array[
    'private.current_app_role()', 'public.get_my_profile()',
    'private.admin_provision_profile(text,text,text)',
    'public.admin_provision_profile(text,text,text)',
    'private.admin_update_profile(uuid,text,text,boolean,timestamptz)',
    'public.admin_update_profile(uuid,text,text,boolean,timestamptz)',
    'private.admin_save_week_schedule(uuid,date,jsonb,integer,text)',
    'public.admin_save_week_schedule(uuid,date,jsonb,integer,text)',
    'private.admin_rollback_week_schedule(uuid,date,integer,integer,text)',
    'public.admin_rollback_week_schedule(uuid,date,integer,integer,text)',
    'private.admin_get_shift_attendance(date,text)',
    'public.admin_get_shift_attendance(date,text)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is not null then
      execute format('grant execute on function %s to authenticated', v_oid::regprocedure);
    end if;
  end loop;
end;
$allowlist$;

-- Kiểm tra ngay trong transaction: nếu chưa khóa được thì toàn bộ thay đổi rollback.
do $verify$
declare v_table text; v_function record;
begin
  foreach v_table in array array[
    'profiles','devices','attendance','weekly_schedules',
    'weekly_schedule_revisions','audit_logs','leave_requests'
  ] loop
    if pg_catalog.has_table_privilege('anon','public.' || v_table,'SELECT')
      or pg_catalog.has_table_privilege('anon','public.' || v_table,'INSERT,UPDATE,DELETE')
      or pg_catalog.has_table_privilege('authenticated','public.' || v_table,'INSERT,UPDATE,DELETE') then
      raise exception 'Quyền bảng public.% vẫn mở; rollback.', v_table;
    end if;
  end loop;
  for v_function in
    select p.oid, p.proname from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind = 'f'
      and p.proname = any(array[
        'submit_attendance','student_submit_attendance','admin_set_attendance_status',
        'admin_set_user_role_and_password','admin_verify_password',
        'student_submit_leave_request','admin_review_leave_request','admin_update_attendance',
        'register_my_device','admin_close_attendance_session','admin_get_active_qr','admin_reset_device',
        'student_create_leave_request','admin_decide_leave_request','admin_adjust_attendance'
      ])
  loop
    if pg_catalog.has_function_privilege('anon',v_function.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',v_function.oid,'EXECUTE') then
      raise exception 'RPC % chưa bị chặn; rollback.', v_function.proname;
    end if;
  end loop;
end;
$verify$;

notify pgrst, 'reload schema';
commit;

-- Đầu ra không chứa dữ liệu sinh viên, token hoặc mật khẩu.
select 'Đã khóa quyền cũ. Đang giới hạn ghi; cần hoàn tất bản ứng dụng an toàn.' as result;

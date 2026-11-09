-- Trạm Kiosk phần cứng CYD ESP32-2432S028: Lấy trạng thái ca, mã QR 30s và phản hồi điểm danh.
-- Sử dụng Zero-Trust Vault Secret: Không lưu tài khoản Admin hay service_role trong Firmware.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $preflight$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Chạy bằng SQL Editor của chủ project.';
  end if;
  if pg_catalog.to_regclass('private.qr_sessions') is null
    or pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Cần cài đặt schema QR và Vault trước.';
  end if;
end;
$preflight$;

-- Khởi tạo secret cho thiết bị nếu chưa có trong Vault
do $secret_init$
declare
  secret_id uuid;
  crypto_schema text;
  kiosk_secret text;
begin
  if pg_catalog.to_regclass('vault.secrets') is not null then
    select id into secret_id from vault.secrets where name = 'lhtech_esp32_kiosk_secret';
    if secret_id is null then
      select n.nspname into crypto_schema
      from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pgcrypto';
      if crypto_schema is not null then
        execute format('select encode(%I.gen_random_bytes(32),''hex'')', crypto_schema) into kiosk_secret;
        perform vault.create_secret(kiosk_secret, 'lhtech_esp32_kiosk_secret', 'Khóa xác thực riêng cho phần cứng CYD ESP32-2432S028 Kiosk');
      end if;
    end if;
  end if;
end;
$secret_init$;

create or replace function private.esp32_get_kiosk_state(p_device_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  n timestamptz := private.qr_server_now();
  test_cfg private.qr_test_settings%rowtype;
  test_day date;
  test_label text;
  ts private.qr_test_sessions%rowtype;
  tc private.qr_test_challenges%rowtype;
  w record;
  s private.qr_sessions%rowtype;
  c private.qr_challenges%rowtype;
  new_id uuid;
  st_total bigint := 0;
  st_present bigint := 0;
  st_late bigint := 0;
  st_waiting bigint := 0;
  stats_obj jsonb;
  last_scan jsonb := null;
begin
  -- 1. Xác thực bảo mật thiết bị (Zero-Trust) qua Vault
  if p_device_secret is null or p_device_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'APP_FORBIDDEN';
  end if;

  if not exists(
    select 1 from vault.decrypted_secrets
    where name = 'lhtech_esp32_kiosk_secret'
      and sha256(convert_to(decrypted_secret, 'UTF8')) = sha256(convert_to(p_device_secret, 'UTF8'))
  ) then
    raise exception 'APP_FORBIDDEN';
  end if;

  -- 2. Kiểm tra chế độ bảo trì hệ thống (Containment Guard)
  if not pg_catalog.has_function_privilege('authenticated', 'public.submit_attendance(text,text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', 'private.submit_attendance(text,text)', 'EXECUTE') then
    return jsonb_build_object(
      'v', 1,
      'state', 'MAINTENANCE',
      'testMode', false,
      'serverTime', to_char(n at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
      'date', to_char((n at time zone 'Asia/Ho_Chi_Minh')::date, 'DD/MM/YYYY'),
      'shift', null,
      'isPaused', false,
      'token', null,
      'expiresIn', 0,
      'stats', null,
      'lastScan', null
    );
  end if;

  -- 3. Xử lý Chế độ Thử nghiệm (Test Mode) nếu đang bật
  if pg_catalog.to_regclass('private.qr_test_settings') is not null then
    select * into test_cfg from private.qr_test_settings where id and enabled;
    if test_cfg.id is not null and test_cfg.expires_at > n then
      test_day := (n at time zone 'Asia/Ho_Chi_Minh')::date;
      test_label := private.qr_test_shift(n);

      insert into private.qr_test_sessions(context_id, business_date, shift)
        values(test_cfg.context_id, test_day, test_label)
        on conflict(context_id, business_date, shift) do nothing;

      select * into ts from private.qr_test_sessions
        where context_id = test_cfg.context_id and business_date = test_day and shift = test_label;

      select
        count(*) filter (where status = 'Có mặt'),
        count(*) filter (where status = 'Đi trễ')
      into st_present, st_late
      from private.qr_test_attendance where session_id = ts.id;

      select jsonb_build_object(
        'id', ta.id,
        'studentId', p.student_id,
        'name', p.display_name,
        'status', ta.status,
        'time', to_char(ta.scanned_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS')
      ) into last_scan
      from private.qr_test_attendance ta
      join public.profiles p on p.id = ta.profile_id
      where ta.session_id = ts.id
        and ta.scanned_at >= n - interval '15 seconds'
      order by ta.scanned_at desc, ta.id desc
      limit 1;

      stats_obj := jsonb_build_object(
        'present', coalesce(st_present, 0),
        'late', coalesce(st_late, 0),
        'waiting', 0,
        'total', coalesce(st_present, 0) + coalesce(st_late, 0)
      );

      if ts.closed_at is not null then
        return jsonb_build_object(
          'v', 1,
          'state', 'CLOSED',
          'testMode', true,
          'serverTime', to_char(n at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
          'date', to_char(test_day, 'DD/MM/YYYY'),
          'shift', test_label,
          'isPaused', false,
          'token', null,
          'expiresIn', 0,
          'stats', stats_obj,
          'lastScan', null
        );
      end if;

      select * into tc from private.qr_test_challenges
        where session_id = ts.id and expires_at > n
        order by expires_at desc limit 1;

      if not found then
        tc.token := substr(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text, 'UTF8')), 'hex'), 1, 32);
        tc.token_hash := encode(sha256(convert_to(tc.token, 'UTF8')), 'hex');
        tc.session_id := ts.id;
        tc.issued_at := n;
        tc.expires_at := least(n + interval '30 seconds', test_cfg.expires_at);
        insert into private.qr_test_challenges values(tc.*);
        delete from private.qr_test_challenges where expires_at < n - interval '5 minutes';
      end if;

      return jsonb_build_object(
        'v', 1,
        'state', 'ACTIVE',
        'testMode', true,
        'serverTime', to_char(n at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
        'date', to_char(test_day, 'DD/MM/YYYY'),
        'shift', test_label,
        'isPaused', false,
        'token', tc.token,
        'expiresIn', greatest(0, extract(epoch from tc.expires_at - n)::int),
        'stats', stats_obj,
        'lastScan', last_scan
      );
    end if;
  end if;

  -- 4. Xử lý Chế độ Thật (Production Attendance Window)
  if pg_catalog.to_regprocedure('private.attendance_active_window(timestamptz)') is not null then
    select * into w from private.attendance_active_window(n);
  else
    select business_date, shift, starts_at, ends_at, late_at, false as is_early
    into w from private.attendance_window(n);
  end if;

  -- Nếu hiện đang ngoài khung giờ điểm danh
  if w.shift is null then
    return jsonb_build_object(
      'v', 1,
      'state', 'OUTSIDE_WINDOW',
      'testMode', false,
      'serverTime', to_char(n at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
      'date', to_char((n at time zone 'Asia/Ho_Chi_Minh')::date, 'DD/MM/YYYY'),
      'shift', null,
      'isPaused', false,
      'token', null,
      'expiresIn', 0,
      'stats', null,
      'lastScan', null
    );
  end if;

  -- Đang trong khung giờ: Khóa slot và tự động mở phiên nếu chưa có
  perform private.lock_attendance_slot(w.business_date, w.shift);

  insert into private.qr_sessions(business_date, shift, starts_at, ends_at)
    values(w.business_date, w.shift, w.starts_at, w.ends_at)
    on conflict(business_date, shift) do nothing returning id into new_id;

  select * into s from private.qr_sessions
    where business_date = w.business_date and shift = w.shift for update;

  if new_id is not null then
    insert into private.qr_expected_members(session_id, profile_id, student_id, display_name, schedule_revision)
      select s.id, p.id, p.student_id, p.display_name, ws.revision
      from public.profiles p
      join public.weekly_schedules ws on ws.profile_id = p.id
      where p.active
        and ws.week_start = s.business_date - ((extract(isodow from s.business_date)::int) - 1)
        and (ws.schedule->(array['t2','t3','t4','t5','t6','t7','cn'])[extract(isodow from s.business_date)::int]) ? s.shift;

    insert into public.audit_logs(actor_id, action, details)
      values(
        (select id from public.profiles where role in ('admin','super_admin') and active order by (role='super_admin') desc, id limit 1),
        'attendance.session.open',
        jsonb_build_object('sessionId', s.id, 'date', s.business_date, 'shift', s.shift, 'source', 'esp32_kiosk')
      );
  end if;

  -- 5. Tính toán Thống kê sĩ số ca trực
  with expected as (
    select profile_id from private.qr_expected_members where session_id = s.id
  ),
  att as (
    select profile_id, status from public.attendance where business_date = w.business_date and shift = w.shift
  )
  select
    count(distinct coalesce(e.profile_id, a.profile_id)),
    count(*) filter (where a.status = 'Có mặt'),
    count(*) filter (where a.status = 'Đi trễ'),
    count(*) filter (where e.profile_id is not null and (a.status is null or a.status not in ('Có mặt', 'Đi trễ', 'Vắng có phép', 'Vắng không phép')))
  into st_total, st_present, st_late, st_waiting
  from expected e full join att a on a.profile_id = e.profile_id;

  stats_obj := jsonb_build_object(
    'present', coalesce(st_present, 0),
    'late', coalesce(st_late, 0),
    'waiting', coalesce(st_waiting, 0),
    'total', coalesce(st_total, 0)
  );

  -- 6. Tìm bản ghi điểm danh vừa quét thành công trong 15s gần nhất
  select jsonb_build_object(
    'id', a.id,
    'studentId', p.student_id,
    'name', p.display_name,
    'status', a.status,
    'time', to_char(a.scanned_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS')
  ) into last_scan
  from public.attendance a
  join public.profiles p on p.id = a.profile_id
  where a.business_date = w.business_date and a.shift = w.shift
    and a.status in ('Có mặt', 'Đi trễ')
    and a.scanned_at >= n - interval '15 seconds'
  order by a.scanned_at desc, a.id desc
  limit 1;

  -- 7. Kiểm tra trạng thái chốt ca hoặc tạm dừng
  if s.closed_at is not null then
    return jsonb_build_object(
      'v', 1,
      'state', 'CLOSED',
      'testMode', false,
      'serverTime', to_char(n at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
      'date', to_char(s.business_date, 'DD/MM/YYYY'),
      'shift', s.shift,
      'isPaused', false,
      'token', null,
      'expiresIn', 0,
      'stats', stats_obj,
      'lastScan', null
    );
  end if;

  if coalesce(s.is_paused, false) then
    return jsonb_build_object(
      'v', 1,
      'state', 'PAUSED',
      'testMode', false,
      'serverTime', to_char(n at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
      'date', to_char(s.business_date, 'DD/MM/YYYY'),
      'shift', s.shift,
      'isPaused', true,
      'token', null,
      'expiresIn', 0,
      'stats', stats_obj,
      'lastScan', last_scan
    );
  end if;

  -- 8. Lấy hoặc cấp mới mã QR 30s
  select * into c from private.qr_challenges
    where session_id = s.id and expires_at > n + interval '2 seconds'
    order by expires_at desc limit 1;

  if not found then
    c.token := substr(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text, 'UTF8')), 'hex'), 1, 32);
    c.token_hash := encode(sha256(convert_to(c.token, 'UTF8')), 'hex');
    c.session_id := s.id;
    c.issued_at := n;
    c.expires_at := least(n + interval '30 seconds', s.ends_at);
    insert into private.qr_challenges values(c.*);
    delete from private.qr_challenges where expires_at < n - interval '5 minutes';
  end if;

  return jsonb_build_object(
    'v', 1,
    'state', 'ACTIVE',
    'testMode', false,
    'serverTime', to_char(n at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI:SS'),
    'date', to_char(s.business_date, 'DD/MM/YYYY'),
    'shift', s.shift,
    'isPaused', false,
    'token', c.token,
    'expiresIn', greatest(0, extract(epoch from c.expires_at - n)::int),
    'stats', stats_obj,
    'lastScan', last_scan
  );
end;
$$;

create or replace function public.esp32_get_kiosk_state(p_device_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return private.esp32_get_kiosk_state(p_device_secret);
end;
$$;

revoke all on function private.esp32_get_kiosk_state(text) from public, anon, authenticated;
revoke all on function public.esp32_get_kiosk_state(text) from public, anon, authenticated;
grant execute on function private.esp32_get_kiosk_state(text) to anon, authenticated;
grant execute on function public.esp32_get_kiosk_state(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;

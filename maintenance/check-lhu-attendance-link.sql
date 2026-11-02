-- Chỉ đếm, không đọc tên/MSSV. Không sửa snapshot phiên đã mở.
with day as (select (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date d),
shifts as (select unnest(array['Sáng','Chiều','Tối']) shift),
counts as (
  select day.d,shifts.shift,
    (select count(*) from public.weekly_schedules w join public.profiles p on p.id=w.profile_id
      where p.active and p.role='student' and w.week_start=day.d-(extract(isodow from day.d)::int-1)
      and (w.schedule->(array['t2','t3','t4','t5','t6','t7','cn'])[extract(isodow from day.d)::int]) ? shifts.shift) as current_schedule_members,
    s.id is not null as real_session_opened,
    (select count(*) from private.qr_expected_members m where m.session_id=s.id) as frozen_session_members,
    (select count(*) from public.attendance a where a.business_date=day.d and a.shift=shifts.shift) as real_attendance_rows
  from day cross join shifts left join private.qr_sessions s on s.business_date=day.d and s.shift=shifts.shift
)
select counts.*,coalesce((select enabled and expires_at>clock_timestamp() from private.qr_test_settings where id),false) as dashboard_uses_trial
from counts;

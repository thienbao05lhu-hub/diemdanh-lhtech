-- Chỉ chạy sau khi bật pg_cron và enable-attendance-cron.sql; chỉ đọc job của ứng dụng này.
-- Một dòng: schedule='* * * * *', active=true, correct_command=true.
select jobname,schedule,active,username,
  command='SET lock_timeout=''2s''; SET statement_timeout=''25s''; SELECT private.run_attendance_automation();' as correct_command
from cron.job where jobname='lhtech-attendance-lifecycle';

-- Các lần gần nhất cần status='succeeded'. Không xuất nội dung lỗi/dữ liệu người dùng.
select r.status,r.start_time,r.end_time
from cron.job_run_details r join cron.job j on j.jobid=r.jobid
where j.jobname='lhtech-attendance-lifecycle'
order by r.runid desc limit 10;

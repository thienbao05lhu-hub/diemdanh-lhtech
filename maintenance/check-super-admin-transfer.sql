-- Chỉ đọc; không trả mật khẩu/hash/token. Chủ project chạy sau từng bước bàn giao.
select p.student_id,p.display_name,p.role,p.active,u.email,
  coalesce(u.encrypted_password,'')<>'' as has_password,
  u.email_confirmed_at is not null as email_confirmed
from public.profiles p join auth.users u on u.id=p.id
where p.student_id in ('123000896','900000001') order by p.student_id;

select (select count(*) from public.profiles where role='student' and active) as active_students,
  (select count(*) from public.profiles where role='super_admin' and active) as active_super_admins,
  h.email_released_at,h.prepared_at,h.completed_at
from private.super_admin_handover h where h.id=true;

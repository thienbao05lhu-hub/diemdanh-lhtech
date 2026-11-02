-- Chỉ số tổng, không xuất danh sách sinh viên.
select count(*) filter(where active and role='student') as active_students,
 count(*) filter(where active and role='student' and btrim(department)<>'') as students_with_department,
 count(*) filter(where active and role='super_admin') as active_super_admins
from public.profiles;

-- Dừng nhận việc/tạo báo cáo mới, không sửa điểm danh hoặc xóa lịch sử Zalo.
-- HTTP đã bắt đầu có thể đã được nhà cung cấp tiếp nhận; cần đối chiếu sending/unknown.
begin;
update private.zalo_report_automation set enabled=false where id;
update private.zalo_delivery_settings set enabled=false where id;
insert into public.audit_logs(action,details) values('zalo.automation.disabled','{"source":"project-owner-sql"}');
commit;

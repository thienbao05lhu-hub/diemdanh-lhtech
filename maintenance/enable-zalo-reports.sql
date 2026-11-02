-- CHỈ chạy khi chủ dự án quyết định bật gửi thật. File này chưa được chạy khi triển khai.
-- Bot token/người nhận phải được xác nhận trước; không ghi secret vào file.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $enable$ declare actor uuid; owners integer;begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then raise exception 'Chạy bằng chủ project.';end if;
 if exists(select 1 from private.qr_test_settings where id and enabled) then raise exception 'Cần kết thúc chế độ thử QR trước.';end if;
 if not exists(select 1 from private.attendance_automation where id and enabled) then raise exception 'Cần xác minh và bật vòng đời ca thật trước.';end if;
 if not exists(select 1 from cron.job where jobname='lhtech-zalo-delivery-worker' and active and command='SELECT private.tick_zalo_reports();') then raise exception 'Cần Cron SQL 187 trước.';end if;
 perform 1 from public.profiles order by id for no key update;
 select count(*) into owners from public.profiles where active and role='super_admin';
 if owners<>1 then raise exception 'Cần xác định đúng một chủ chịu trách nhiệm automation.';end if;
 select id into actor from public.profiles where active and role='super_admin';
 perform 1 from private.zalo_report_automation where id for update;
 perform 1 from private.zalo_delivery_settings where id for update;
 if not exists(select 1 from private.zalo_delivery_settings where id and recipient_id is not null and recipient_confirmed_at is not null)
  or not exists(select 1 from vault.secrets where name='lhtech_zalo_bot_token')
  or not exists(select 1 from vault.secrets where name='lhtech_zalo_worker_secret') then raise exception 'Chưa hoàn tất cấu hình Bot/người nhận.';end if;
 if exists(select 1 from private.zalo_outbox where status in ('pending','sending','unknown')) then raise exception 'Đối chiếu queue còn chờ/chưa xác định trước khi bật.';end if;
 update private.zalo_delivery_settings set enabled=true where id;
 if not private.zalo_delivery_available() then raise exception 'Quyền điểm danh hoặc cấu hình chưa sẵn sàng.';end if;
 update private.zalo_report_automation set actor_id=actor,starts_at=case when enabled then starts_at else private.qr_server_now() end,enabled=true where id;
 insert into public.audit_logs(actor_id,action,details) values(actor,'zalo.automation.enabled',jsonb_build_object('source','project-owner-sql'));
end;$enable$;
commit;

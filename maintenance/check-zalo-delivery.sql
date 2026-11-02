-- Chỉ đọc metadata/trạng thái; không xuất Bot token, recipient hoặc nội dung tin.
select enabled,recipient_id is not null and recipient_confirmed_at is not null as recipient_configured
from private.zalo_delivery_settings where id;
select status,count(*) as jobs from private.zalo_outbox group by status;
select n.nspname,p.proname,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname in (
 'admin_enqueue_zalo_report','admin_get_zalo_delivery','zalo_authorize_worker','zalo_claim_delivery','zalo_finish_delivery')
order by p.proname,n.nspname;
select c.relname,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relname in ('zalo_delivery_settings','zalo_outbox');

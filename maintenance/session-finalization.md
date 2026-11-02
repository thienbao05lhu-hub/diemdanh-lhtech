# Mở và chốt ca trên database

Giữ nguyên thiết kế tối và các nút cũ. SQL 120 đã được chủ project xác nhận chạy thành công. SQL 130 cũng đã được xác nhận bằng ảnh: RLS/quyền/publication đúng và đủ sáu trigger đang hoạt động. Chưa có xác nhận quét thử Realtime qua hai thiết bị.

## Sửa lỗi quyền cron.job — 02/11/2026

Bản 141 đầu tiên có câu UPDATE trực tiếp cron.job; Supabase đã trả 42501 trước COMMIT. Bản mới dùng job_id trả về từ cron.schedule và gọi cron.alter_job(job_id, active := true); file dừng cũng gọi alter_job(..., active := false). Không cấp thêm quyền ghi catalog. Mở lại artifacts/enable-attendance-cron.sql và chạy toàn bộ bản mới; không cần chạy lại 140 hoặc cài lại extension. Transaction bị lỗi chưa lưu phần kích hoạt của lần đó. Đã tái hiện lỗi cũ và kiểm chứng sửa bằng role BYPASSRLS không có INSERT/UPDATE/DELETE trên cron.job, với API scheduler mô phỏng; vẫn cần xác nhận trên Supabase thật.

Tham chiếu API: [pg_cron alter_job](https://github.com/citusdata/pg_cron#altering-a-cron-job).

## Cài và bật

1. Chủ project mở SQL Editor project `oalnswbnjhkkovxjxtlz`, chạy toàn bộ `artifacts/restore-safe-session-finalization.sql` (nguồn `supabase/schemas/140_session_finalization.sql`). Bước này sửa logic nút Chốt ca cũ; tác vụ tự động vẫn tắt.
2. Vào **Integrations > Cron**, bật extension **pg_cron** nếu chưa bật. Chạy toàn bộ `artifacts/enable-attendance-cron.sql` (nguồn 141). Chỉ tạo/cập nhật job `lhtech-attendance-lifecycle`; lịch mỗi phút. Chưa cài pg_cron thì file dừng và hoàn tác phần bật, không báo thành công giả.
3. Chạy từng SELECT trong `supabase/diagnostics/check-session-finalization.sql`, rồi `check-attendance-cron.sql`. Sau khoảng một đến hai phút, kiểm tra `last_run_at` và lịch sử job `succeeded`. Lịch sử job thành công không thay thế kiểm tra điểm danh thực tế.
4. Nghiệm thu trong project thử/tài khoản thử: chụp danh sách, quét hợp lệ, duyệt nghỉ, tới giờ chốt kiểm tra trạng thái và thử chạy lại. Không đóng ca đang vận hành chỉ để kiểm thử.

Không chạy lại 90/100/110/120/130 hoặc installer cũ để cài bước này. Các file đánh số thể hiện thứ tự thủ công, không chạy glob theo thứ tự tên file. SQL mới không sửa UID/mật khẩu, không cấp quyền ghi trực tiếp cho client.

## Quy tắc

Job dùng giờ server tại `Asia/Ho_Chi_Minh`: mở trong các khoảng 07:00–11:00, 13:00–17:00 và 18:00–22:00. Nếu Admin chưa mở, job tạo phiên và chụp người đang hoạt động có lịch tương ứng. Snapshot bao gồm revision lịch; chỉnh lịch sau đó không thay danh sách phiên cũ. Snapshot ghi thời điểm thực và số giây mở chậm trong audit, không giả là đã mở đúng đầu ca. Không tạo token QR hoặc bỏ kiểm tra Auth/thiết bị.

Chỉ sau khi hết giờ, job tạo **Vắng không phép** cho người trong snapshot mà chưa có bản ghi. Người không có lịch/snapshot không bị tự đánh vắng. Snapshot là danh sách đã chốt tại lúc mở; việc khóa tài khoản sau đó không tự xóa người khỏi snapshot. Các bản ghi Có mặt/Đi trễ/Vắng có phép đã có được giữ nguyên trạng thái, giờ quét, lý do và provenance, rồi khóa. Tham gia ngoài lịch cũng giữ nguyên lượt quét và được khóa.

Nút Chốt ca cũ vẫn cho Admin chủ động đóng sớm với lý do; từ bước 140, thao tác này cũng tạo vắng còn thiếu và khóa phiên. Không có thao tác mở lại. Bấm lại sau timeout hoặc job chạy lại không tạo thêm vắng/audit chốt. Phiên đã đóng trước bước 140 được giữ nguyên; không tự bổ sung vắng hồi tố.

Kích hoạt từ ngày Việt Nam hiện tại. Không xử lý phiên trước ngày kích hoạt, không dựng lại phiên đã hết giờ nhưng chưa từng mở. Khi bỏ lỡ toàn bộ một ca, cần đối chiếu dữ liệu thay vì suy diễn lịch sử từ lịch hiện tại. Một lượt job xử lý tối đa 12 phiên đã mở quá hạn; backlog còn lại xử lý ở lượt sau.

Giờ tạo bản ghi vắng được lưu trong cột scanned_at NOT NULL của schema cũ cho tương thích, nhưng API lịch sử cá nhân/bảng ca/CSV chỉ trình bày giờ quét cho Có mặt/Đi trễ. Không coi thời điểm chốt là lượt sinh viên quét.

## An toàn, lỗi và dừng

Worker/helper/config nằm private, không cấp EXECUTE hoặc quyền bảng cho anon/authenticated. Worker là SECURITY INVOKER và yêu cầu chủ database/bypassrls; Cron chạy bằng người tạo job. Nút Admin vẫn kiểm tra Auth UID và vai trò database. Worker dừng nếu quyền submit/device/QR cần thiết bị thu hồi, tránh đánh vắng khi các RPC điểm danh đang bị khóa. Trình duyệt không được gọi worker hoặc cung cấp đồng hồ.

Để phối hợp với scan/duyệt/sửa, bước chốt/mở khóa các profile theo UUID, rồi slot/session/attendance. Đây là thao tác khóa ngắn trên danh sách profile của xưởng hiện tại; chưa đo tải lớn hoặc cạnh tranh nhiều kết nối thật. Job đặt lock timeout 2 giây, statement timeout 25 giây; nếu bận/lỗi, transaction bị hủy để lần sau thử lại. Không gọi HTTP/Zalo/LHU trong transaction.

Tạo vắng, khóa điểm danh, đóng phiên, nhật ký và tín hiệu Realtime cùng transaction. Lỗi audit hoặc dữ liệu approved thiếu attendance khiến lượt job thất bại và hoàn tác; không tự đổi đơn approved thành KP. Đối chiếu qua lịch sử Cron/đơn nghỉ trước khi sửa dữ liệu; không mở quyền client để chữa lỗi. Một phiên lỗi dữ liệu có thể chặn lượt job, cần chủ project xử lý nguyên nhân.

Dừng riêng tác vụ bằng `artifacts/disable-attendance-cron.sql`: tắt config và đúng job của ứng dụng, giữ dữ liệu. Bật lại bằng file 141; ngày bắt đầu gốc được giữ để hoàn tất phiên đã mở còn tồn. Containment 90 mới cũng tắt config; job còn được scheduler gọi sẽ trả disabled. Lượt đang chạy có thể hoàn tất trước khi lệnh dừng lấy được khóa. Đừng tắt extension pg_cron để dừng riêng ứng dụng, vì sẽ ảnh hưởng các job khác.

Đây là tác vụ cloud, không cần giữ web mở. Nó phụ thuộc project Supabase/Cron đang hoạt động; không phải cam kết dịch vụ 24/7. Lịch sử pg_cron tăng dần, chủ project cần theo dõi dung lượng và thiết lập chính sách giữ lịch sử chạy phù hợp; không xóa audit nghiệp vụ. LHU, Zalo và ESP32 chưa được mở trong bước này.

## Bằng chứng và giới hạn

PGlite kiểm chứng ACL, snapshot, cận 11:00, idempotency, giữ lượt quét/nghỉ, rollback audit, trạng thái mặc định tắt và containment. Scheduler trong kiểm thử là mô phỏng, không chạy extension pg_cron thật. Cần xem lịch sử job và dữ liệu trên project thật sau khi người dùng chạy SQL. Tham khảo [Cron quickstart](https://supabase.com/docs/guides/cron/quickstart) và [bật Cron](https://supabase.com/docs/guides/cron/install).

# Lớp sinh viên và đồng bộ lịch LHU

Giữ nguyên giao diện tối đã chốt. Tài khoản quản trị riêng vẫn có trong danh sách phân quyền; bộ đếm thiết bị, lịch xưởng và thống kê chỉ tính sinh viên đang hoạt động. Không đổi Auth UID hoặc mật khẩu.

## Thứ tự triển khai

1. Trong workspace, mở `artifacts/restore-student-departments.sql`, sao chép toàn bộ vào SQL Editor của chủ project rồi Run. File gồm SQL 160 và lớp của 23 sinh viên lấy lại từ MongoDB cũ. Chỉ điền lớp đang trống; không ghi đè lớp đã có. Kết quả mong đợi: `students=23`, `students_with_department=23`. File chứa danh sách riêng, không tải lên GitHub. Bản schema không kèm danh sách là [restore-student-directory.sql](restore-student-directory.sql).
2. Chạy toàn bộ [restore-lhu-sync.sql](restore-lhu-sync.sql) (SQL 170). Bước này chỉ chuẩn bị backend, worker mặc định chưa bật.
3. Supabase Dashboard → **Edge Functions → Deploy a new function → Via Editor**. Đặt tên chính xác `lhu-sync-worker`. Thay mã mặc định bằng toàn bộ [lhu-sync-worker.ts](lhu-sync-worker.ts), hoặc file cùng tên trong `artifacts`, rồi Deploy. Trong cấu hình function, tắt **Verify JWT with legacy secret**. Worker Cron dùng secret riêng; mọi yêu cầu từ web vẫn được kiểm tra `auth.getUser()` và quyền Admin từ database.
4. Vào **Edge Functions → Secrets**, thêm tên `LHU_WORKER_SECRET`. Giá trị là nội dung file riêng `artifacts/lhu-worker-secret.private.txt` trong máy. Không gửi nội dung đó vào chat hoặc đưa lên GitHub. URL và các khóa Supabase cần cho worker do môi trường Edge cung cấp sẵn; không đưa service key vào `js/config.js`.
5. Bật extension **pg_net** tại Database → Extensions nếu chưa có. `pg_cron` và Vault đã dùng ở các bước trước. Sau đó chạy toàn bộ file riêng `artifacts/enable-lhu-sync-cron.private.sql` tại SQL Editor. File đã điền cùng secret với bước 4, lưu vào Vault. Bản mẫu không có secret là [enable-lhu-sync-cron.sql](enable-lhu-sync-cron.sql).
6. Đợi khoảng một phút, chạy [check-lhu-sync.sql](check-lhu-sync.sql). Cần `enabled=true`, `worker_recent=true`; các RPC `lhu_claim_item`/`lhu_finish_item` phải `authenticated_execute=false`, `anon_execute=false`. Cron `succeeded` chỉ xác nhận đã gửi HTTP; chưa chứng minh Edge chạy thành công.
7. Tải lại Admin bằng **Ctrl+F5**. Trong bảng lịch tuần hiện có, chọn tuần rồi bấm **Đồng bộ lịch tự động**. Worker lấy tối đa ba sinh viên mỗi lượt Cron, tuần tự và nghỉ 500 ms sau mỗi request; 23 người thường cần vài lượt Cron. Có thể đóng trình duyệt trong lúc lấy lịch.
8. Khi hoàn tất, mở phần chi tiết ngay dưới nút để xem lịch trước/sau từng sinh viên và các lỗi. Chưa có lịch xưởng nào bị thay đổi ở bước này. Bấm lại nút lúc nhãn là **Áp dụng lịch đã xem**, xác nhận bằng hộp thoại sẵn có. Lịch cập nhật có revision, lịch sử và audit.

## Quy tắc dữ liệu

- API trường hiện trả `data[0]` (họ tên), `data[1]` (phân trang), `data[2]` (buổi học); không có lớp. Không suy đoán lớp từ MSSV hoặc nhóm môn học.
- Lịch rảnh = ba ca của bảy ngày trừ các buổi học đang có hiệu lực trong tuần. JSON/ngày/ca/phân trang bất thường sẽ báo lỗi, giữ lịch cũ. Tuần không có buổi học hợp lệ được xem trước là rảnh cả tuần.
- Giữ lịch có nguồn `manual`/`rollback`. Lịch `migration` hoặc `lhu` được đề xuất thay khi xem trước; khi áp dụng vẫn kiểm tra revision và hồ sơ. Thay đổi phát sinh sau lúc lấy dữ liệu khiến sinh viên đó được bỏ qua.
- Bản xem trước hết hạn sau hai giờ. Chỉ một lượt lấy lịch chạy trên toàn hệ thống; lease 90 giây và tối đa ba lần thử mỗi sinh viên ngăn worker cũ ghi đè worker mới.
- Không sửa điểm danh, snapshot ca đã mở, tài khoản, thiết bị hoặc mật khẩu. Không bật lại tự động đánh vắng thật trong lúc đang thử QR. Chưa có lịch đồng bộ tuần tự động; chỉ lấy lịch khi Admin bấm nút.
- Chưa khôi phục Zalo trong bước này. Không gửi tin nhắn thử hoặc thông báo cho sinh viên.

Muốn dừng riêng worker LHU, chạy [disable-lhu-sync-cron.sql](disable-lhu-sync-cron.sql). Không tắt job điểm danh. Bản `security-containment.sql` mới cũng dừng ghi LHU nếu cần khóa hệ thống.

Đã kiểm tra parser/API trên MSSV chủ dự án, kiểm tra cục bộ PostgreSQL/PGlite và mock Edge/Auth/Cron. Chưa chạy SQL 160/170 hoặc triển khai Edge vào project thật thay chủ project. Phép thử Cron cục bộ không thay thế kiểm tra `worker_recent` và lượt xem trước trên cloud.

Tài liệu chính thức: [Edge Auth](https://supabase.com/docs/guides/functions/auth), [Cron gọi Edge](https://supabase.com/docs/guides/functions/schedule-functions), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Vault](https://supabase.com/docs/guides/database/vault).

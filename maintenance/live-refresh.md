# Cập nhật tự động trên Admin, giữ nguyên giao diện

Chủ project xác nhận đã chạy thành công SQL 120 ngày 01/11/2026. SQL đó có kiểm tra điều kiện 110. Đây là xác nhận từ người dùng; chưa có phiên nghiệm thu Admin/Supabase Realtime thật từ công cụ. Bước này không thay màu, CSS, bố cục hoặc nút của giao diện tối.

## Áp dụng

1. Mở SQL Editor của project `oalnswbnjhkkovxjxtlz`, chạy toàn bộ `artifacts/enable-live-refresh.sql` bằng tài khoản chủ. Nguồn là `supabase/schemas/130_live_refresh.sql`. Không cần chạy lại 100/110/120 đã hoàn tất.
2. Chạy riêng từng SELECT trong `supabase/diagnostics/check-live-refresh.sql`. Kết quả đầu: RLS bật, anon không có quyền, authenticated chỉ SELECT, published và publication_safe đều true. Kết quả thứ hai có sáu trigger đang hoạt động. Helper trigger không được cấp EXECUTE cho client.
3. Tải lại Admin. Dùng tài khoản sinh viên thử quét QR hợp lệ trong ca; Admin đang mở sẽ tải lại điểm danh. Thử duyệt nghỉ và thay đổi lịch ở tab khác, đối chiếu dữ liệu thật sau tải lại. Không thử bằng cách chỉnh localStorage hoặc giả giờ trình duyệt.
4. Thử ẩn/hiện tab, mất mạng rồi kết nối lại và đăng xuất. Thử nhập ghi chú hoặc sửa lịch chưa lưu trong khi tab khác có cập nhật: bản nháp phải được giữ. Nếu ai khác đổi phiên bản đơn/lịch, cần đối chiếu lại trước khi ghi.

Publication `supabase_realtime` phải có sẵn, cho phép INSERT và không ở chế độ FOR ALL TABLES. Script dừng và hoàn tác nếu điều kiện này không đạt; không tự mở quyền toàn bộ bảng để chữa lỗi. Chỉ thêm bảng tín hiệu vào publication, giữ nguyên các thành viên đã có. Không chạy lại installer mở quyền cũ.

## Dữ liệu và kết nối

Realtime chỉ gửi bảng `app_change_events` gồm id, topic, profile_id và created_at. Không gửi tên, email, nội dung đơn nghỉ, token QR hoặc khóa thiết bị. Mỗi thay đổi insert/update/delete ở sáu bảng profiles, devices, attendance, weekly_schedules, leave_requests và audit_logs tạo một tín hiệu INSERT cùng transaction. RLS giới hạn Admin đang hoạt động hoặc tín hiệu của chính chủ hồ sơ; tín hiệu audit chỉ Admin đọc được. Giao diện Admin dùng topic để gọi lại các API đã kiểm tra Auth/quyền; không lấy bản ghi nghiệp vụ từ payload Realtime.

Một kết nối cho mỗi tab Admin, gộp tín hiệu và cách các đợt đọc ít nhất ba giây. Khi kết nối lỗi, thử lại với khoảng chờ tăng từ 5 đến 60 giây. Ẩn tab, offline hoặc đăng xuất sẽ đóng kết nối; quay lại tải snapshot mới. Web vẫn đọc định kỳ 30 giây khi tab hiện và có quyền, kể cả chưa chạy SQL 130. Đọc lại không tự thử lại thao tác ghi hoặc bỏ kiểm tra phiên bản.

Bản nháp lịch, ghi chú duyệt nghỉ và hộp xác nhận đang mở được bảo vệ khỏi việc dựng lại giao diện. Ghi chú chỉ được giữ khi đơn vẫn cùng phiên bản. Phản hồi ca cũ hoặc phiên đăng nhập cũ không được ghi đè bảng hiện tại.

Tín hiệu là dữ liệu tạm: mỗi 100 sự kiện, dọn tối đa 1.000 tín hiệu quá 24 giờ hoặc nằm ngoài 10.000 id gần nhất; khi ít hoạt động, tín hiệu có thể còn lâu hơn. Không xóa điểm danh, đơn nghỉ hoặc audit. Không dùng tín hiệu như hàng đợi bảo đảm giao nhận. Polling và tải lại snapshot xử lý trường hợp bỏ lỡ tín hiệu.

Chạy lại containment 90 sẽ thu hồi quyền đọc tín hiệu và tắt capability; không xóa dữ liệu. LHU, Zalo, reset hàng loạt, ESP32 và đánh vắng tự động chưa được mở bởi bước này.

## Kiểm chứng

Kiểm thử cục bộ dùng PGlite cho transaction/RLS/ACL/trigger và mô phỏng SDK/DOM cho vòng đời kết nối, bản nháp và phản hồi đến trễ. PGlite không xác minh WebSocket của dịch vụ Supabase; cần nghiệm thu bước 3–4 trên project thật. Tham khảo [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

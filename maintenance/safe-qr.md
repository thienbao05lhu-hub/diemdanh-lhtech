# Khôi phục điểm danh QR — 01/11/2026

Đây là một phần của chuyển đổi, chưa phải bản hoàn tất toàn bộ hệ thống. SQL containment đã được chủ project xác nhận chạy. Bước này khôi phục riêng QR, thiết bị và đọc lịch sử; duyệt nghỉ, sửa điểm danh, đồng bộ LHU, Zalo và ESP32 tiếp tục tạm dừng trên bản cloud.

## Áp dụng

1. Sao lưu database trước khi thay đổi. Mở đúng project `oalnswbnjhkkovxjxtlz` trong Supabase SQL Editor.
2. Chạy toàn bộ `artifacts/restore-safe-qr.sql`. Nguồn chính là `supabase/schemas/100_safe_qr.sql`; hai file phải giống hệt nhau. Không cần sửa UID, email hoặc mật khẩu. Chỉ chạy trên database đã khóa quyền bằng bản 90.
3. Kết quả cuối: `Đã bật QR an toàn. Duyệt nghỉ, sửa điểm danh, LHU và Zalo vẫn tạm khóa.` Nếu báo lỗi, transaction rollback; giữ nguyên lỗi để kiểm tra, không chạy lại các installer PWA cũ.
4. Chạy `supabase/diagnostics/check-safe-qr.sql`: bảng không có quyền anonymous/ghi trực tiếp authenticated; private QR cũng không có SELECT cho authenticated. RPC QR được mở cho authenticated nhưng tự kiểm tra Auth UID/active/role. RPC mật khẩu, duyệt nghỉ, sửa điểm danh cũ vẫn đóng.
5. Sau khi GitHub Pages cập nhật, tải lại Admin và trang sinh viên. Nếu SQL chưa chạy hoặc capability lỗi, giao diện tiếp tục khóa điểm danh.

## Nghiệm thu với tài khoản thử riêng

- Dùng một tài khoản admin và hai sinh viên Auth đã xác nhận, có hồ sơ active. Không gửi mật khẩu vào chat, không dùng tài khoản thật để tạo điểm danh thử.
- Trong giờ ca Việt Nam, mở Admin để tạo phiên QR. Lịch tuần hiện có được chụp vào phiên ở lần mở đầu tiên. Sinh viên chưa có lịch vẫn có thể quét và được ghi `inSchedule=false`; không tự tạo lịch rảnh hoặc đánh vắng.
- Sinh viên đăng nhập, dùng nút **Xác Nhận & Khóa Thiết Bị** của thiết kế cũ, rồi bấm **Tiếp Tục Quét Lại** để mở camera. Thiết bị đã có binding sẽ được xác minh bằng khóa lưu ở trình duyệt. Chỉ hiển thị thành công sau khi server trả bản ghi đúng UID. URL có `?t=` được giữ chờ xác nhận qua nút Tiếp Tục Quét Lại, không tự gửi điểm danh.
- Quét lại không tạo bản ghi mới hoặc sửa thời gian quét đầu. Mã hết hạn, sai thiết bị, tài khoản inactive, ca đã khóa phải bị từ chối. Camera chỉ mở sau thao tác người dùng; khi chuyển ứng dụng/tab phải xác minh lại thiết bị.
- Dùng **Mở khóa thiết bị** trên Admin cho sinh viên thử để đăng ký trình duyệt mới. Admin thường không reset thiết bị của admin khác; super_admin mới được quyền đó.
- RPC chốt phiên yêu cầu lý do, khóa bản ghi hiện có và ngăn cấp mã/quét tiếp trong ca. Nút chốt từng được thêm vào Admin đã được gỡ để giữ nguyên thiết kế đã chốt; phần nối thao tác chốt sẽ dùng luồng UI được người dùng chấp thuận. Không mở lại phiên đã chốt. Bước này chưa tạo vắng hàng loạt và chưa gửi báo cáo Zalo.
- Các cửa sổ: `[07:00,11:00)`, `[13:00,17:00)`, `[18:00,22:00)`. Đi trễ bắt đầu đúng `08:31`, `13:31`, `18:31`. Giờ/UID/ca từ trình duyệt không được dùng để ghi dữ liệu.

## Thiết kế và giới hạn

Các bảng phiên, mã QR và hash khóa thiết bị nằm trong schema private, bật RLS và không cấp quyền bảng cho anon/authenticated. Chỉ wrapper SECURITY INVOKER public gọi hàm private SECURITY DEFINER với search_path rỗng, kiểm tra danh tính và vai trò từ profiles. Mã QR có 128 bit, tối đa 30 giây, có thể dùng chung bởi nhiều sinh viên trong ca; một lần tải QR của admin khác không làm mã đang hiệu lực hết hạn sớm.

Mỗi thao tác lấy khóa profile trước, sau đó session và attendance; reset khóa profile theo UUID. Dùng NO KEY UPDATE cho profile để không chặn khóa FK KEY SHARE khi chụp thành viên. Sau khi đợi khóa session, server đọc lại clock_timestamp và kiểm tra hạn QR/giờ ca. Tạo bản ghi và audit trong cùng transaction; giữ unique(profile_id,business_date,shift).

Khóa thiết bị là bí mật ngẫu nhiên lưu trong trình duyệt, hash tại database. Đây là ràng buộc trình duyệt, không phải chứng thực phần cứng hay đảm bảo chống chia sẻ tài khoản/ảnh QR. Xóa storage hoặc đổi trình duyệt cần admin mở khóa. Binding cũ chỉ được chuyển khi khóa trình duyệt khớp; public.devices mới chỉ lưu dấu `bound-v2:active`, không lưu khóa quét mới. Chưa xóa dữ liệu thiết bị/nhật ký cũ để giữ khả năng đối chiếu.

Có kiểm thử PostgreSQL cục bộ bằng PGlite, Auth UID mô phỏng và các probe JavaScript DOM giả lập. Chưa nghiệm thu Supabase Auth/PostgREST thật, camera điện thoại thật hay tải đồng thời trên PostgreSQL nhiều kết nối. Không coi kiểm thử một kết nối là bằng chứng kiểm thử cạnh tranh. ESP32 và Zalo không được bật trong bước này.

Nguồn tham khảo: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html), [SHA-256 trong PostgreSQL](https://www.postgresql.org/docs/current/functions-binarystring.html).

## Khi cần dừng lại

Chạy bản cập nhật `artifacts/security-containment.sql` để khóa lại các RPC ghi QR/đăng ký thiết bị/chốt ca. Không xóa dữ liệu đã ghi. Capability trả qrEnabled=false khi quyền submit/registration bị thu hồi; giao diện dừng nhận điểm danh. Đây là dừng ghi, không phải xóa/hoàn tác các điểm danh vừa ghi.

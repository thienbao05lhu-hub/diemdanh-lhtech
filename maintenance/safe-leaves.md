# Xin nghỉ và xét duyệt — bước tiếp sau QR

Chủ project đã gửi kết quả chạy SQL QR và ảnh kiểm tra ACL/RLS đúng. Luồng QR chưa nghiệm thu bằng camera, tài khoản và Auth/PostgREST thật. Bước này chuẩn bị xin nghỉ và xét duyệt, chưa mở sửa điểm danh thủ công, LHU, Zalo, ESP32 hay đánh vắng tự động.

## Cập nhật Supabase

1. Sao lưu trước khi cập nhật. Mở đúng project `oalnswbnjhkkovxjxtlz` trong SQL Editor bằng tài khoản chủ project.
2. Chạy toàn bộ `artifacts/restore-safe-leaves.sql`, sao chép từ nguồn `supabase/schemas/110_safe_leaves.sql`. Không sửa UID/email/mật khẩu. File yêu cầu đã có containment và QR an toàn; không cần chạy lại các installer cũ.
3. Kết quả cuối: **Đã bật xin nghỉ và duyệt nghỉ an toàn. Sửa điểm danh thủ công, LHU và Zalo vẫn tạm khóa.** Nếu lỗi, transaction rollback; không tự xóa/gộp đơn trùng để vượt kiểm tra.
4. Chạy riêng từng SELECT trong `supabase/diagnostics/check-safe-leaves.sql` và kiểm tra: anon không có quyền; authenticated không ghi thẳng bảng; bảng private không đọc được; RPC legacy vẫn tắt. RPC mới có EXECUTE cho authenticated nhưng kiểm tra UID/active/role ở bên trong.
5. Tải lại Admin và App sinh viên. Form/nút duyệt chỉ bật khi server xác nhận capability mới. Trước khi chạy SQL, vẫn đọc được đơn cũ và hiển thị trạng thái chờ cập nhật.

SQL thêm revision cho đơn và bảng private ghi nguồn gốc thay đổi điểm danh. Không tự sửa trạng thái hoặc gán lại UID cho đơn cũ. Có unique index theo profile/ngày/ca; nếu phát hiện trùng, dừng để đối chiếu. Schema 100 được cập nhật khóa ca; SQL 110 chứa đầy đủ các hàm QR cần thay, nên người đã chạy bản 100 cũ chỉ cần chạy 110, không cần chạy lại 100.

## Quy tắc

- Thành viên active gửi đơn cho chính UID đang đăng nhập; không nhận MSSV, tên, reviewer hay thời gian từ client. Không cần mở camera/đăng ký thiết bị để xin nghỉ vì đây không phải xác nhận có mặt.
- Chỉ xin nghỉ từ ngày hiện tại ở Việt Nam đến 30 ngày tới, ca Sáng/Chiều/Tối, lý do 1–500 ký tự. Ca đã chốt, kết thúc giờ nhận hoặc đã có mặt/đi trễ không nhận đơn mới. Gửi lại cho cùng ca trả đơn đã có, giữ nội dung/trạng thái cũ.
- Gửi đơn chỉ tạo **Chờ duyệt**, chưa ghi vắng có phép. Admin active duyệt/từ chối; không tự duyệt đơn của chính mình. Từ chối và hủy duyệt bắt buộc có lý do.
- Admin gửi số phiên bản đơn đã đọc. Nếu người khác đã xử lý, server từ chối phiên bản cũ; tải lại trước khi quyết định. Đơn, điểm danh và nhật ký cùng transaction: lỗi một phần sẽ hoàn tác cả lượt xử lý.
- Chấp thuận chỉ tạo điểm danh vắng có phép hoặc thay bản ghi vắng không phép chưa khóa. Không ghi đè có mặt, đi trễ, vắng có phép không xác định nguồn gốc hoặc ca đã khóa. Chưa có lịch không tự xem là lên xưởng; `in_schedule=false`.
- Hủy duyệt đưa approved về pending; chỉ xóa bản ghi do lượt duyệt tạo hoặc khôi phục trạng thái vắng không phép trước đó khi bản ghi vẫn khớp snapshot. Nếu sinh viên đã quét QR, giữ nguyên lần quét. Dữ liệu thay đổi khác hoặc đơn legacy thiếu provenance cần đối chiếu, không tự hoàn tác.
- Có thể xét lại đơn rejected thành approved; không tự chuyển reviewing thành kết quả cuối. Không thay quyết định sau thời điểm kết thúc ca hoặc khi ca chốt sớm. Không xóa lịch sử đơn và nhật ký.
- Giờ đóng ca: 11:00, 17:00, 22:00 Việt Nam. QR/duyệt/chốt dùng cùng advisory lock cho ngày/ca, kể cả chưa có session. Khóa profile theo UUID trước, sau đó ca/session/đơn/attendance. Helper không được client gọi trực tiếp.

## Nghiệm thu

Dùng tài khoản thử riêng để không tạo dữ liệu điểm danh thử cho sinh viên thật. Trong App, gửi đơn cho ca tương lai, xác nhận chưa có vắng có phép. Trong Admin, duyệt rồi kiểm tra attendance/audit; thử một tab cũ để xác nhận không ghi đè quyết định mới. Thử hủy duyệt trước khi chốt, sau đó thử QR thay vắng có phép bằng có mặt. Không bấm chốt ca vận hành thật để thử nếu chưa muốn khóa ca đó.

Đơn cũ không khớp profile/MSSV, reviewing hoặc approved không có nguồn gốc thay đổi sẽ bị chặn khi xử lý. Không chạy lại `fix-audit-logs-and-leaves.sql` hay `create-leave-requests-table.sql` cũ vì các file đó mở lại quyền legacy.

Đã có kiểm thử cục bộ PGlite và JavaScript với Auth/DOM mô phỏng, gồm rollback khi audit lỗi, CAS, bảo vệ ca khóa và không xóa lần quét. Kiểm thử một kết nối không chứng minh chạy đồng thời trên PostgreSQL nhiều kết nối. Chưa chạy SQL 110 hoặc nghiệm thu Auth/PostgREST/camera trên Supabase thật thay người dùng. Giao diện hiện tải tối đa 50 đơn cá nhân và phân trang 25 đơn Admin, làm mới khi quay lại hoặc mỗi 30 giây; Realtime/CSV chưa thực hiện trong bước này.

Khi cần dừng ghi, bản cập nhật `artifacts/security-containment.sql` thu hồi cả RPC QR và hai RPC nghỉ mới. Không xóa dữ liệu; capability chuyển false để khóa thao tác. Chạy lại 110 sau containment yêu cầu khôi phục QR bằng 100 trước.

Nguồn: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html).

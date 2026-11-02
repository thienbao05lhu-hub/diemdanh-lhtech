# Tách tài khoản Super Admin riêng

Người dùng yêu cầu tạo một tài khoản quản trị riêng rồi bỏ quyền quản trị của 123000896. Lỗi khởi tạo mật khẩu xác nhận hiện có 22 sinh viên active. Sau bàn giao, tài khoản cũ trở lại sinh viên: **23 sinh viên + một tài khoản quản trị riêng**. Không xóa UID, lịch, lịch sử, thiết bị hay audit của tài khoản cũ.

## Thứ tự thực hiện bởi chủ project

Các file đã điền email được giữ trong artifacts riêng, không đăng lên Pages. Mật khẩu Admin mới do chủ tự nhập tại Dashboard, không gửi vào chat hoặc dùng mật khẩu ban đầu của sinh viên.

1. Chạy toàn bộ `artifacts/01-release-admin-email.sql`. Nếu email Admin mới đang nằm ở tài khoản cũ, script chuyển tài khoản cũ sang `123000896@student.lhu.edu.vn`, đồng bộ identity email, giữ nguyên UID, mật khẩu và vai trò Super Admin. Sau bước này tài khoản cũ vẫn đăng nhập bằng MSSV 123000896 hoặc email MSSV cùng mật khẩu cũ. Script dừng nếu alias đã dùng, có OAuth/provider khác hoặc yêu cầu đổi email đang chờ; không tự xóa/gộp user.
2. Vào **Authentication > Users > Add user > Create new user**. Dùng email Admin riêng đã chọn, đặt mật khẩu riêng và bật **Auto Confirm User**. Đây phải là Auth UID mới. Không sửa mật khẩu Admin cũ hoặc đặt vai trò qua user_metadata. Nếu user mới đã được tạo đúng email thì không tạo lặp.
3. Chạy `artifacts/02-prepare-new-super-admin.sql`. Script tìm Auth UID mới theo email, yêu cầu đã có mật khẩu và xác nhận email. Tạo hồ sơ mã nội bộ **900000001**, tên Quản trị viên cao nhất, vai trò **admin** tạm để kiểm tra đăng nhập; tài khoản cũ vẫn là Super Admin. Mã nội bộ đáp ứng schema hiện tại, không phải MSSV sinh viên. Nếu mã/UID đã thuộc hồ sơ khác, dừng thay vì ghi đè.
4. Đăng xuất web hiện tại rồi đăng nhập web bằng **email Admin mới và mật khẩu riêng vừa tạo**. Cần vào được dashboard; lúc này nhãn vai trò tạm là Admin. Nếu chưa đăng nhập được, không chạy bước 5: quyền cũ vẫn còn để xử lý.
5. Chạy `artifacts/03-complete-super-admin-transfer.sql`. Guard yêu cầu Auth ghi nhận lần đăng nhập mới sau bước 02. Trong một transaction, nâng tài khoản mới thành super_admin và đổi tài khoản cũ thành student, kiểm tra đúng 22 sinh viên trước đó và ghi audit. Không có thời điểm commit mà hệ thống mất Super Admin. Lỗi audit hoặc trạng thái lệch sẽ hoàn tác toàn bộ.
6. Ctrl + F5 dashboard tài khoản mới. Chạy từng SELECT của `supabase/diagnostics/check-super-admin-transfer.sql`: tài khoản mới super_admin, tài khoản cũ student, active_students=23 và completed_at có giá trị. Đăng nhập sinh viên bằng MSSV; tài khoản quản trị riêng đăng nhập bằng email, không dùng 900000001 làm MSSV đăng nhập.
7. Sau chuyển quyền, chạy **bản mới** `artifacts/initialize-23-student-passwords.sql`. File nay lọc theo role student/active, tính cả 123000896 sau khi đã trở thành sinh viên; vẫn không đặt lại mật khẩu Admin mới. Không sửa guard 23 thành 22 để chạy trước bàn giao.

## Quyền và dữ liệu

Không dùng lại bootstrap chủ đầu tiên vì đã tồn tại Super Admin. Không tạo RPC chuyển vai trò, không mở anonymous/raw write hoặc RPC mật khẩu legacy. Handover là operation owner-only và ledger private bật RLS, không cấp quyền client. Tạo Auth user mới dùng Dashboard/Auth Admin API; thao tác đồng bộ email cũ là operation chuyển dữ liệu một lần, chỉ hỗ trợ email-only và kiểm tra trùng trước khi sửa.

Vai trò của mọi API/RLS lấy từ profiles hiện tại, nên token cũ của 123000896 không giữ quyền Admin sau commit bàn giao. Không tuyên bố đã thu hồi tất cả phiên Auth: phiên cũ có thể còn nhưng quyền truy cập bị giới hạn thành sinh viên tại database. Giao diện cũng bỏ điều kiện gắn cứng Super Admin theo MSSV và bỏ ép tên hiển thị theo mã/role; dùng thông tin đã xác minh từ phiên và hồ sơ thật.

Chạy lại cùng bước sau hoàn tất không cấp thêm quyền hay ghi lại audit. Nếu tài khoản/vai trò đã bị thay đổi ngoài luồng, script dừng đối chiếu. Ledger giữ thời điểm giải phóng email, chuẩn bị, hoàn tất và hai UUID; không giữ mật khẩu/hash. Nếu Auth mới chưa sẵn sàng, không hạ quyền cũ.

## Kiểm chứng

PGlite kiểm tra alias trùng, không cho client thao tác, đồng bộ email identity/giữ UID/password, user Auth thiếu xác nhận, không ghi đè hồ sơ khác, yêu cầu đăng nhập mới, rollback audit, replay và RLS token cũ sau hạ quyền. Test tích hợp khởi tạo bcrypt cho đúng 23 sinh viên sau bàn giao và giữ mật khẩu quản trị mới. Chưa tạo user hoặc chuyển quyền thật trên Supabase từ công cụ; chủ project chạy và xác nhận từng bước.

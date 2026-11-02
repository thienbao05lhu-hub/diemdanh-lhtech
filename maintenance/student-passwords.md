# Cấp mật khẩu ban đầu cho 23 sinh viên

Người dùng chốt phạm vi: **23 sinh viên, không gồm Admin**. Mật khẩu khởi tạo được người dùng chỉ định riêng, không đưa vào mã JavaScript, Pages hoặc kho GitHub công khai. Các bước dưới đây chưa được công cụ chạy trên Supabase thật.

## Khi database báo chỉ có 22 sinh viên

Người dùng yêu cầu chuyển quyền khỏi 123000896 sang tài khoản quản trị riêng. Làm theo `super-admin-transfer.md` trước: chỉ sau hoàn tất bàn giao, 123000896 mới trở thành sinh viên thứ 23. Bản mới operation mật khẩu tính cả tài khoản này theo role; giữ nguyên bảo vệ các tài khoản còn là Admin. Không đổi guard từ 23 thành 22 và không chạy lại bản SQL cũ đã loại trừ cố định MSSV chủ.

## Chủ project thực hiện một lần

1. Mở file riêng trong workspace `artifacts/initialize-23-student-passwords.sql`, chép toàn bộ vào SQL Editor project `oalnswbnjhkkovxjxtlz`, chạy bằng tài khoản chủ. Không upload file này lên GitHub hoặc gói frontend.
2. Script chỉ xử lý role student, active; không dùng MSSV cố định để loại trừ người đã trở lại sinh viên. Phải tìm thấy đúng 23 hồ sơ; nếu có 22/24 hoặc thiếu tài khoản Auth/email thì toàn bộ transaction dừng, không tự thêm/xóa người hay đổi vai trò. Danh sách import cũ trong workspace chỉ có 22 alias sinh viên, nên số thực tế trên Supabase phải được kiểm tra bằng guard này.
3. Kết quả sau chạy có MSSV, tên, email đăng nhập, cờ login_with_student_id, initialized và email_confirmed; không trả mật khẩu hoặc hash. Nếu login_with_student_id=true, dùng MSSV trên trang đăng nhập; nếu false, dùng đúng email của dòng đó. Không sửa email/UID để chữa lệch tài khoản.

Mỗi mật khẩu có bcrypt salt riêng (cost 10). Thao tác xác nhận email đăng nhập Auth và ghi audit theo UUID, không đổi role/active/email/UID, không đụng tài khoản Admin hoặc thiết bị. Ledger private ghi người đã được khởi tạo nhưng không lưu mật khẩu/hash. Chạy lại cùng file giữ nguyên người đã được cấp, kể cả họ đã tự đổi mật khẩu; không dùng file này làm chức năng reset mật khẩu định kỳ.

Đây là thao tác dữ liệu Auth một lần bằng quyền chủ project theo quy trình SQL thủ công đã chọn, không phải RPC mật khẩu cho trình duyệt. Nó yêu cầu pgcrypto có sẵn và quyền UPDATE auth.users của chủ; không tự GRANT quyền Auth để vượt lỗi. Nó không thu hồi các phiên Auth đang mở hoặc gọi email notification; thay đổi mật khẩu thường ngày đi qua Supabase Auth SDK.

## Sinh viên tự đổi khi muốn

Sau khi đăng nhập app, bấm nút **Đổi** đang có → nhập **1** để mở trang Thiết lập mật khẩu bằng phiên hiện tại. Nhập mật khẩu mới ít nhất 10 ký tự và nhập lại; lưu thành công sẽ kết thúc phiên hiện tại để đăng nhập lại bằng mật khẩu mới. Nhập **2** ở nút Đổi vẫn dùng chức năng đăng xuất/đổi tài khoản; Hủy giữ nguyên phiên.

Cũng có thể mở trực tiếp `reset-password.html` sau đăng nhập. Khi đã có phiên, không cần nhận email recovery; người chưa đăng nhập chỉ thấy luồng xác nhận email như cũ. Nếu project bật yêu cầu reauthentication cho phiên cũ, đăng nhập lại rồi đổi bằng phiên mới; không tắt bảo vệ Auth để tránh bước xác nhận.

Luồng đổi dùng auth.getUser để xác minh lại UID và auth.updateUser chỉ nhận password của chính phiên đó. Chỉ báo đã lưu khi SDK trả đúng UID. Không gửi role/UID mục tiêu từ trình duyệt, không dùng mật khẩu dự phòng, không lưu password trong localStorage. Thiết kế, CSS và bố cục app không đổi; nút Đổi cũ mở lựa chọn thao tác.

Nguồn operation: `supabase/operations/initialize-student-passwords.sql` là mẫu không có mật khẩu thật; bản điền chỉ tồn tại ở artifacts riêng. Nếu guard báo sai số lượng, đối chiếu danh sách thực tế thay vì sửa số 23 để chạy bừa. Không chạy lại importer hoặc installer PWA cũ vốn mở quyền.

## Kiểm chứng

PGlite dùng extension pgcrypto thật để kiểm tra bcrypt, 23 salt khác nhau, không đổi hai tài khoản quản trị mẫu, không ghi đè mật khẩu người tự đổi, chặn số lượng 22/24 và rollback khi audit lỗi. VM kiểm tra lựa chọn Đổi, phiên thay UID, updateUser lỗi/thiếu UID và không báo thành công giả. Chưa có thử đăng nhập Supabase thật sau thao tác; cần chủ project xác nhận kết quả và dùng một tài khoản sinh viên thử.

Tham khảo [Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser), [cách lưu mật khẩu](https://supabase.com/docs/guides/auth/password-security) và [pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html).

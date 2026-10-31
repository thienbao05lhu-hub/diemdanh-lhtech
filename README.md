# Điểm danh LHTech — frontend Supabase

Bản chuyển đổi đang triển khai: đăng nhập bằng Supabase Auth, hồ sơ tài khoản, Admin xem thành viên và nhật ký. Điểm danh QR, lịch xưởng, duyệt nghỉ, đồng bộ LHU, Zalo và ESP32 chưa được chuyển xong trong bản này. Chưa dùng bản này để thay hệ thống đang vận hành.

Website là HTML/CSS/JavaScript tĩnh, không cần npm hay bước build. Bản SDK Supabase chính thức 2.118.0 được phục vụ trong `vendor/`, kèm giấy phép MIT.

Đưa **nội dung của thư mục này** lên gốc repository `thienbao05lhu-hub/diemdanh-lhtech`. Trong GitHub, chọn Settings > Pages > Deploy from a branch > main > /(root). Địa chỉ dự kiến khi Pages được bật: `https://thienbao05lhu-hub.github.io/diemdanh-lhtech/`.

Cấu hình công khai trong `js/config.js` chỉ chứa project URL và publishable key. Tài khoản đăng nhập phải tồn tại trong Supabase Auth và có hồ sơ tương ứng trong bảng `profiles`. Phiên đăng nhập được lưu bằng SDK trong sessionStorage của tab; mật khẩu không được lưu trong storage. Quyền dữ liệu vẫn do PostgreSQL/RLS kiểm tra.

Chỉ xuất bản các file trong thư mục này. Không đưa `.env`, dữ liệu MongoDB, mã khóa ESP32/Zalo hoặc mật khẩu lên repository public.

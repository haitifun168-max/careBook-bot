# 📖 TÀI LIỆU HƯỚNG DẪN SỬ DỤNG HỆ THỐNG TELEGRAM SHOP BOT & WEB DASHBOARD
*(Tài liệu dành cho Khách hàng và Quản trị viên hệ thống)*

---

## 👤 PHẦN 1: HƯỚNG DẪN DÀNH CHO KHÁCH HÀNG (NGƯỜI MUA)

Khách hàng tương tác với Shop Bot hoàn toàn tự động trực tiếp trên khung chat Telegram thông qua các nút bấm menu và các câu lệnh nhanh.

### 1. Danh sách lệnh chính của Khách hàng
*   `/start` — 🔄 Khởi động hoặc khởi động lại Bot, hiển thị lời chào kèm menu chức năng chính.
*   `/menu` — 👤 Xem thông tin cá nhân (Telegram ID, Số dư ví hiện tại, ngày tham gia).
*   `/product` — 📦 Xem danh sách sản phẩm và các danh mục sản phẩm đang mở bán.
*   `/nap [số tiền]` — 💰 Tạo yêu cầu nạp tiền tự động vào ví số dư (Ví dụ: `/nap 50000`).
*   `/checkpay` — 🔍 Xem trạng thái của 5 đơn hàng gần nhất đã thực hiện.
*   `/support` — 🆘 Lấy thông tin liên hệ hỗ trợ trực tiếp với chủ shop.
*   `/myid` — 🆔 Xem Telegram ID của bản thân.

### 2. Hướng dẫn mua hàng trực tiếp (Thanh toán qua VietQR)
Áp dụng khi khách hàng không có số dư trong ví hoặc số dư không đủ.
1.  Gõ `/product` hoặc nhấn nút **📦 Sản phẩm** trên Menu chính.
2.  Chọn danh mục -> chọn sản phẩm muốn mua -> chọn số lượng mong muốn.
3.  Hệ thống hiển thị thông tin hóa đơn và ảnh mã **QR VietQR** thanh toán:
    *   Mã QR đã chứa sẵn số tài khoản ngân hàng của shop, số tiền chính xác và nội dung chuyển khoản đặc biệt (Ví dụ: `NAP PAY-XYZ123`).
    *   > [!IMPORTANT]
        > **Lưu ý đặc biệt**: Khách hàng khi chuyển khoản tuyệt đối **không được thay đổi nội dung chuyển khoản** tự động. Nếu thay đổi, hệ thống SePay sẽ không nhận diện được đơn hàng và không thể giao tự động.
4.  Sau khi khách hàng chuyển khoản thành công bằng ứng dụng Ngân hàng (Smart Banking), hệ thống sẽ nhận diện trong vòng **3 - 5 giây**, giao hàng trực tiếp trên khung chat Telegram dưới dạng tin nhắn định dạng rõ ràng (chứa tài khoản, mật khẩu, key kích hoạt...).

### 3. Hướng dẫn mua hàng bằng Số dư ví (Thanh toán tức thì)
1.  Nếu tài khoản của khách hàng có số dư ví $\ge$ giá trị đơn hàng cần mua.
2.  Khi chọn số lượng sản phẩm, hệ thống sẽ hiển thị thêm nút bấm: **"💵 Thanh toán số dư"**.
3.  Khách hàng nhấn nút, hệ thống sẽ trừ trực tiếp tiền trong ví và **giao sản phẩm ngay lập tức** mà không cần qua bước quét mã ngân hàng.

### 4. Hướng dẫn Nạp tiền vào ví số dư (`/nap`)
1.  Khách hàng gõ `/nap [số tiền]` (ví dụ: `/nap 100000`) hoặc nhấn nút **💰 Nạp số dư**.
2.  Bot gửi ảnh mã **QR VietQR** chuyển khoản tương ứng.
3.  Khách hàng chuyển khoản đúng số tiền và nội dung chuyển khoản đi kèm.
4.  Khi hệ thống nhận được tiền, Bot sẽ tự động cộng số dư vào tài khoản và gửi tin nhắn thông báo biến động số dư thành công.

---

## 🔧 PHẦN 2: HƯỚNG DẪN DÀNH CHO ADMIN (QUẢN TRỊ VIÊN)

Admin quản trị toàn bộ hệ thống thông qua hai kênh song song: **Web Dashboard** và **Telegram Admin Commands**.

### A. QUẢN TRỊ QUA WEB DASHBOARD (KHUYÊN DÙNG)
Giao diện Web Dashboard trực quan, bảo mật giúp Admin quản lý nhanh mà không cần gõ lệnh Telegram phức tạp.

#### 1. Đăng nhập hệ thống bảo mật OTP
1.  Truy cập đường dẫn URL của Web Dashboard (Ví dụ: `https://dvtt-shop-bot.onrender.com/admin/login`).
2.  Nếu truy cập từ nút bấm **🖥️ Web Dashboard** trên Telegram, hệ thống sẽ tự động đăng nhập (Auto-login).
3.  Nếu truy cập thủ công, bạn nhấn nút **Gửi mã OTP qua Telegram**.
4.  Hệ thống sẽ tạo mã OTP gồm 6 chữ số và gửi trực tiếp tới Telegram cá nhân của Admin. Nhập mã OTP vào trang đăng nhập để vào Dashboard.

#### 2. Các phân hệ trên Web Dashboard
*   **Phân hệ Tổng quan (Overview)**:
    *   Xem nhanh doanh số tổng, số lượng đơn thành công, tổng người dùng, tổng tồn kho.
    *   Xem biểu đồ Chart.js trực quan phản ánh doanh số tăng trưởng của 7 ngày gần nhất.
    *   Xem danh sách sản phẩm bán chạy nhất (Top Sellers) và trạng thái tồn kho thực tế của các sản phẩm.
    *   Theo dõi 10 đơn hàng/giao dịch vừa phát sinh theo thời gian thực (Real-time).
*   **Phân hệ Quản lý sản phẩm**:
    *   Xem danh sách, chỉnh sửa tên, sửa đơn giá, bật/tắt (Active/Inactive) hoặc xóa hẳn sản phẩm.
    *   Thêm mới sản phẩm chỉ với 1 form điền thông tin (Chọn danh mục, nhập tên, giá bán, chọn emoji).
*   **Phân hệ Quản lý kho hàng (Stock)**:
    *   Admin chọn sản phẩm muốn nạp kho.
    *   Dán danh sách tài khoản (định dạng mỗi tài khoản trên một dòng, ví dụ: `email|pass|info`) vào ô văn bản rồi nhấn **Thêm tài khoản**.
    *   Kiểm tra số lượng tài khoản chưa bán và dọn dẹp kho hàng (Clear Stock) nếu cần.

---

### B. QUẢN TRỊ NHANH QUA LỆNH TELEGRAM (ADMIN ONLY)
Chỉ tài khoản Telegram có ID khớp với `ADMIN_ID` mới thực thi được các lệnh dưới đây.

#### 1. Panel quản lý tổng quan
*   Lệnh `/admin` — Mở Menu quản trị chính gồm các chỉ số KPI nhanh và các nút tắt.

#### 2. Các câu lệnh quản trị sản phẩm & kho hàng nhanh
*   `/addcategory [tên] | [emoji]` — Thêm danh mục mới (Ví dụ: `/addcategory Canva | 🎨`).
*   `/addproduct [catID] | [tên] | [giá]` — Thêm sản phẩm nhanh (Ví dụ: `/addproduct 1 | Tài khoản Canva Pro | 20000`).
*   `/listproduct` — Xem toàn bộ sản phẩm của shop kèm mã số ID sản phẩm.
*   `/editprice [ID_sản_phẩm] [giá_mới]` — Sửa giá sản phẩm nhanh (Ví dụ: `/editprice 2 15000`).
*   `/editname [ID_sản_phẩm] [tên_mới]` — Sửa tên hiển thị của sản phẩm.
*   `/toggleproduct [ID_sản_phẩm]` — Bật (🟢) hoặc Tắt (🔴) trạng thái bán của sản phẩm.
*   `/deleteproduct [ID_sản_phẩm]` — Xóa hoàn toàn sản phẩm và kho hàng chưa bán.
*   `/addstock [ID_sản_phẩm]` — Nạp hàng vào kho (sau đó gửi danh sách tài khoản dạng email|pass).
*   `/viewstock [ID_sản_phẩm]` — Xem các tài khoản chưa bán trong kho của sản phẩm đó.
*   `/clearstock [ID_sản_phẩm]` — Xóa sạch toàn bộ tài khoản chưa bán trong kho.

#### 3. Quản lý Đơn hàng & Ví khách hàng
*   `/pending` — Xem toàn bộ đơn hàng đang chờ thanh toán.
*   `/confirm [ID_đơn_hàng]` — Xác nhận thanh toán thủ công và giao hàng tự động cho khách (Dùng trong trường hợp SePay lỗi không gửi webhook).
*   `/cancelorder [ID_đơn_hàng]` — Hủy đơn hàng đang chờ.
*   `/addbalance [ID_Telegram_khách] [số_tiền]` — Cộng tiền thủ công vào ví khách hàng (Ví dụ: `/addbalance 1234567 50000`). Khách sẽ nhận được tin nhắn báo số dư mới.
*   `/deductbalance [ID_Telegram_khách] [số_tiền]` — Trừ bớt tiền trong ví khách hàng.

#### 4. Gửi tin nhắn truyền thông (Broadcast)
*   Lệnh `/broadcast` — Gửi thông báo đến toàn bộ người dùng đã từng nhắn tin với bot.
*   *Cách sử dụng*: Gõ `/broadcast`, sau đó nhập nội dung thông điệp (hỗ trợ HTML). Bot sẽ tự động gửi lần lượt đến tất cả khách hàng và báo cáo tổng kết số lượng gửi thành công/thất bại cho Admin.

---

## 🛠️ PHẦN 3: CẤU HÌNH VẬN HÀNH WEBHOOK SEPAY VÀ DEPLOY (DÀNH CHO KỸ THUẬT)

### 1. Cấu hình biến môi trường (.env)
Khi chạy ứng dụng trên máy chủ thực tế (Render, VPS), cần đảm bảo cấu hình đầy đủ các biến môi trường sau:
*   `BOT_TOKEN`: Token lấy từ `@BotFather` của Telegram.
*   `ADMIN_ID`: ID tài khoản Telegram của Admin chính để nhận OTP đăng nhập Dashboard và thông báo.
*   `BANK_BIN`: Mã BIN ngân hàng nhận tiền (Ví dụ: MB Bank là `970422`).
*   `BANK_ACCOUNT`: Số tài khoản ngân hàng nhận tiền.
*   `BANK_ACCOUNT_NAME`: Tên chủ tài khoản ngân hàng nhận tiền (viết liền không dấu).
*   `BANK_NAME`: Tên ngân hàng nhận tiền (Ví dụ: `MB`).
*   `SEPAY_API_KEY`: API Key lấy từ SePay.vn để xác thực bảo mật webhook.
*   `DASHBOARD_TOKEN`: Khóa dùng làm token xác thực tự động cho Web Dashboard.
*   `PUBLIC_URL`: URL công khai của máy chủ của bạn (Ví dụ: `https://dvtt-shop-bot.onrender.com`).
*   `PORT`: Cổng máy chủ chạy Webhook (mặc định Render tự gán là `10000`).

### 2. Cấu hình tích hợp Webhook trên SePay.vn
1.  Đăng nhập vào SePay.vn -> Tích hợp API -> Webhooks -> Thêm mới.
2.  Cấu hình:
    *   **URL**: `https://[DOMAIN_CỦA_BẠN]/webhook/sepay` (Ví dụ: `https://dvtt-shop-bot.onrender.com/webhook/sepay`).
    *   **Kiểu dữ liệu (Content-Type)**: `application/json` (dạng JSON).
    *   **Xác thực API**: Thêm tiêu đề HTTP Header Authorization với giá trị: `Apikey [SEPAY_API_KEY_CỦA_BẠN]` trùng khớp với cấu hình trong tệp `.env`.
3.  Nhấn nút **Test kết nối** trên SePay để kiểm tra tín hiệu truyền dẫn.

---
*Tài liệu được cập nhật mới nhất vào ngày 24/06/2026.*

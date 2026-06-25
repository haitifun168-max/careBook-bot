# 📖 QUY TRÌNH NGHIỆP VỤ THANH TOÁN (SEPAY WEBHOOK WORKFLOWS)

Tài liệu này mô tả chi tiết quy trình xử lý dữ liệu của Telegram Shop Bot khi nhận được tín hiệu thông báo nhận tiền từ hệ thống SePay Webhook.

---

## 🗺️ Quy trình tổng quan (Tổng thể)

Khi có biến động số dư tài khoản ngân hàng, SePay sẽ gửi một `HTTP POST` request chứa thông tin giao dịch về endpoint `/webhook/sepay` của Bot. Quy trình xử lý diễn ra như sau:

```mermaid
graph TD
    A[Nhận Webhook từ SePay] --> B{Kiểm tra API Key?}
    B -- Không khớp/Thiếu --> C[Trả về 401 Unauthorized]
    B -- Khớp API Key --> D[Trích xuất Mã giao dịch bằng Regex]
    D --> E{Tìm thấy mã?}
    E -- Không tìm thấy --> F{Chứa chữ 'TEST' hoặc 'SEPAY'?}
    F -- Đúng --> G[Trả về 200 OK - Test connection]
    F -- Sai --> H[Trả về 400 Bad Request / Invalid Code]
    E -- Tìm thấy mã chuẩn --> I{Tìm trong bảng orders và deposits?}
    I -- Khớp Đơn hàng (orders) --> Workflow1[Quy trình Đơn hàng - Xem Mục 1]
    I -- Khớp Nạp ví (deposits) --> Workflow2[Quy trình Nạp số dư - Xem Mục 2]
    I -- Không khớp mã nào --> J[Trả về 404 Not Found - Code not found]
```

---

## 📦 1. Quy trình xử lý Đơn hàng (Orders)

Khi mã giao dịch (ví dụ: `NAP PAY-1TVWQ8`) khớp với một đơn hàng đang chờ thanh toán trong bảng `orders`:

### Trường hợp 1.1: Đơn hàng đủ kho tự động (Giao hàng tự động - Auto Delivery)
Áp dụng khi số lượng sản phẩm trong bảng `stock` lớn hơn hoặc bằng số lượng sản phẩm khách hàng đặt.

```mermaid
sequenceDiagram
    participant S as SePay Webhook
    participant B as Bot Server
    participant DB as Database (shop.db)
    participant C as Khách hàng (Telegram)
    participant A as Admin (Telegram)

    S->>B: Gửi Webhook thanh toán (Số tiền >= Tổng tiền đơn)
    B->>DB: Truy vấn lấy thông tin đơn hàng & kho hàng (stock)
    Note over B: Kho tự động còn hàng!
    B->>DB: Đánh dấu các tài khoản đã bán (is_sold = 1)
    B->>DB: Cập nhật trạng thái đơn = 'delivered' & lưu tài khoản vào 'delivered_data'
    B->>C: Gửi tin nhắn chúc mừng thành công & danh sách tài khoản (email|pass)
    B->>A: Gửi thông báo đơn hàng hoàn tất tự động
    B-->>S: Phản hồi HTTP 200 {"success": true}
```

### Trường hợp 1.2: Đơn hàng hết kho tự động (Chờ giao thủ công - Manual Queue)
Áp dụng khi số lượng sản phẩm trong bảng `stock` rỗng hoặc không đủ số lượng đặt.

```mermaid
sequenceDiagram
    participant S as SePay Webhook
    participant B as Bot Server
    participant DB as Database (shop.db)
    participant C as Khách hàng (Telegram)
    participant A as Admin (Telegram)

    S->>B: Gửi Webhook thanh toán
    B->>DB: Truy vấn lấy thông tin đơn & kiểm tra kho
    Note over B: Kho tự động rỗng! (0 sản phẩm)
    B->>DB: Cập nhật trạng thái đơn = 'paid' (Đã thanh toán)
    B->>C: Thông báo: "Đã thanh toán. Kho đang tạm hết, Admin đang chuẩn bị giao thủ công"
    B->>A: Cảnh báo: "⚠️ LỖI GIAO HỰ TỰ ĐỘNG đơn #ID do hết kho. Admin vui lòng giao thủ công"
    B->>B: Đặt trạng thái Admin = deliver_order (chờ nhập tài khoản cho đơn #ID)
    B-->>S: Phản hồi HTTP 200 {"success": true}
    
    Note over A, B: Giao hàng thủ công sau đó:
    A->>B: Gửi danh sách tài khoản qua chat (email1|pass1...)
    B->>DB: Cập nhật trạng thái đơn = 'delivered' & lưu vào 'delivered_data'
    B->>C: Chuyển tiếp danh sách tài khoản đã nhận cho Khách hàng thành công
    B->>A: Xác nhận: "Đã giao đơn hàng #ID thành công!"
```

---

## 💰 2. Quy trình Nạp số dư vào ví (Deposits)

Áp dụng khi mã giao dịch (ví dụ: `NAP PAY-XYZ123`) khớp với một yêu cầu nạp tiền được tạo qua lệnh `/nap [số tiền]` trong bảng `deposits`.

```mermaid
sequenceDiagram
    participant S as SePay Webhook
    participant B as Bot Server
    participant DB as Database (shop.db)
    participant C as Khách hàng (Telegram)
    participant A as Admin (Telegram)

    S->>B: Gửi Webhook thanh toán (Số tiền chuyển khoản)
    B->>DB: Truy vấn kiểm tra yêu cầu nạp tiền (status = 'pending')
    B->>DB: Cộng số tiền chuyển khoản vào số dư user (users.balance = balance + amount)
    B->>DB: Cập nhật trạng thái yêu cầu nạp = 'completed'
    B->>C: Thông báo: "💰 Nạp số dư thành công! Cộng +Xđ. Số dư hiện tại: Yđ"
    B->>A: Thông báo: "🔔 GIAO DỊCH NẠP TIỀN THÀNH CÔNG từ Khách ID: X, Số tiền: Yđ"
    B-->>S: Phản hồi HTTP 200 {"success": true}
```

---

## 🛠️ 3. Quy trình Kiểm thử Kết nối (Test Ping)

Áp dụng khi bạn nhấn nút **"Kiểm tra kết nối"** hoặc **"Gửi thử"** trên bảng điều khiển SePay.

```mermaid
sequenceDiagram
    participant S as SePay Webhook
    participant B as Bot Server

    S->>B: Gửi Webhook với nội dung "SEPAY TEST WEBHOOK"
    Note over B: Không trích xuất được mã đơn hàng.
    Note over B: Nhận diện nội dung chứa chữ 'TEST' hoặc 'SEPAY'.
    B->>B: Ghi nhận log: "Nhận webhook thử nghiệm từ SePay. Phản hồi OK."
    B-->>S: Phản hồi HTTP 200 {"success": true, "message": "Test connection successful"}
```

---

## 🔍 Hướng dẫn xử lý sự cố (Troubleshooting)

*   **Hiện tượng 1: SePay báo lỗi gửi thất bại (HTTP 401)**
    *   *Nguyên nhân:* API Key cấu hình trên SePay và file `.env` không khớp.
    *   *Khắc phục:* Đảm bảo tham số Authorization trên SePay có định dạng `Apikey [MÃ_KEY]` và khớp từng ký tự với `SEPAY_API_KEY` trong `.env`.
*   **Hiện tượng 2: SePay báo lỗi gửi thất bại (HTTP 404)**
    *   *Nguyên nhân:* Mã nội dung chuyển khoản gửi sang không khớp với bất kỳ đơn hàng hoặc yêu cầu nạp tiền đang hoạt động nào trong cơ sở dữ liệu (hoặc do đơn hàng đó đã bị hủy/hoàn thành trước đó).
    *   *Khắc phục:* Tạo một đơn hàng mới từ Telegram để có mã thanh toán mới tinh rồi giả lập lại.
*   **Hiện tượng 3: SePay báo lỗi Timeout (Không kết nối được)**
    *   *Nguyên nhân:* Máy chủ webhook của Bot chưa được bật, hoặc cổng `3000` bị chặn bởi tường lửa, hoặc đường hầm (localtunnel/localhost.run) đã bị ngắt kết nối.
    *   *Khắc phục:* Kiểm tra xem lệnh `ssh -R ... nokey@localhost.run` trong terminal còn chạy không, và đảm bảo URL Webhook cấu hình trên SePay đã được cập nhật đúng địa chỉ mới nhất.

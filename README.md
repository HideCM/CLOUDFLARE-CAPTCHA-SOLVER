# Cloudflare Mode Extension

Extension tự động giải quyết Cloudflare challenge, được phát triển bởi @Tranthanh1202.

## Tính năng chính

- 🔄 Tự động giải quyết Cloudflare challenge
- 🖱️ Mô phỏng hành vi người dùng thực tế
- 📑 Hỗ trợ nhiều tab cùng lúc
- ⚡ Tự động phát hiện và xử lý challenge
- 🔒 Bảo mật và an toàn

## Cài đặt

1. Tải extension từ Chrome Web Store hoặc clone repository này
2. Mở Chrome và truy cập `chrome://extensions/`
3. Bật chế độ "Developer mode" ở góc phải
4. Click "Load unpacked" và chọn thư mục chứa extension

## Cách sử dụng

1. Cài đặt extension
2. Truy cập trang web có Cloudflare challenge
3. Extension sẽ tự động phát hiện và giải quyết challenge
4. Không cần thao tác thêm

## Cấu trúc file

```
├── manifest.json      # Cấu hình extension
├── background.js      # Service worker
├── script.js         # Content script
├── oldscript.js      # Phiên bản cũ của script
└── logo.png          # Icon extension
```

## Chi tiết kỹ thuật

### Quyền cần thiết
- `debugger`: Để tương tác với tab
- `tabs`: Để quản lý các tab
- `host_permissions`: Truy cập các trang web

### Cơ chế hoạt động
1. Content script phát hiện Cloudflare challenge
2. Service worker gắn debugger vào tab
3. Tự động tìm và click vào challenge
4. Mô phỏng hành vi người dùng

### Bảo mật
- Chỉ xử lý các domain Cloudflare
- Không lưu trữ dữ liệu người dùng
- Mã nguồn mở và minh bạch

## Tùy chỉnh

### Thời gian delay
```javascript
const DELAY_BETWEEN_ACTIONS = 1000; // 1 giây
```

### Số lần thử lại
```javascript
const MAX_RETRIES = 3;
```

## Xử lý lỗi

- Tự động thử lại khi thất bại
- Dọn dẹp tài nguyên khi tab đóng
- Log chi tiết để debug

## Đóng góp

Mọi đóng góp đều được chào đón. Vui lòng:
1. Fork repository
2. Tạo branch mới
3. Commit thay đổi
4. Push lên branch
5. Tạo Pull Request

## Giấy phép

MIT License
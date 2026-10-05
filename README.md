# Hướng Dẫn Deploy Tingee MCP Server Dành Cho DevOps Heno

Tài liệu này hướng dẫn cách deploy **Tingee MCP Server** lên máy chủ Heno trong 3 phút. Server này đóng vai trò cầu nối bảo mật giữa AI Agent của DOS và hệ thống Tingee, tự động chặn reset các loa đã liên kết quá 30 ngày.

---

## 1. Cơ Chế Bảo Mật & 2 Loại Token (Rất Quan Trọng)

1. **Master API Key của Tingee (`TINGEE_API_KEY`, `TINGEE_SPEAKER_API_KEY`)**:
   - Nằm **100% trên server Heno** trong file `.env`.
   - **Tuyệt đối không gửi key này cho DOS**. DOS và AI Agent hoàn toàn không biết key này.
2. **Bearer Token kết nối (`MCP_BEARER_TOKEN`)**:
   - Bạn tự sinh bằng lệnh: `openssl rand -hex 32`.
   - Token này là "chìa khóa cửa" để AI Agent gõ cửa server MCP của bạn.
   - Gửi token này + URL MCP qua cho DOS đăng ký vào hệ thống.

---

## 2. Các Bước Deploy (3 Phút)

### Bước 1: Kéo mã nguồn & cấu hình `.env`
Trên server Heno:
```bash
cd /opt/dosclaw/ # hoặc thư mục bạn quản lý docker
git clone https://github.com/DOS/HENO-MCP-Server.git
cd HENO-MCP-Server
```

Tạo file `.env`:
```bash
cp .env.example .env
nano .env
```

Điền các thông tin thực tế:
```ini
# Sinh ngẫu nhiên: openssl rand -hex 32
MCP_BEARER_TOKEN=điền_token_ngẫu_nhiên_vào_đây

# API Keys thực tế của Tingee
TINGEE_API_KEY=key_reset_loa_tingee
TINGEE_RESET_URL=https://open-api.tingee.vn/v1/device/reset-device

TINGEE_SPEAKER_API_KEY=key_tra_cuu_loa_tingee
TINGEE_SPEAKER_STATUS_URL=https://open-api.tingee.vn/v1/partner/speakers/status

PORT=18070
```

### Bước 2: Khởi động container
```bash
docker compose up -d --build
```

Kiểm tra trạng thái container:
```bash
docker compose ps
curl http://127.0.0.1:18070/health
```
Kết quả trả về JSON `{"ok":true,"service":"tingee-mcp-server",...}` là container đã chạy hoàn hảo!

---

## 3. Expose HTTPS Ra Ngoài (Cloudflare Tunnel / Nginx)

Expose cổng nội bộ `18070` ra Internet qua domain riêng của bạn, ví dụ: `https://mcp-dosclaw.tingee.vn` (hoặc tạo path reverse proxy `https://dosclaw.tingee.vn/mcp`).

Sau khi cấu hình, test thử bằng lệnh:
```bash
# 1. Test Health (công khai):
curl -s https://mcp-dosclaw.tingee.vn/health

# 2. Test Tools List (kèm Bearer Token):
curl -s -X POST https://mcp-dosclaw.tingee.vn/mcp \
  -H "Authorization: Bearer <MCP_BEARER_TOKEN_BẠN_ĐÃ_ĐẶT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 4. Gửi Cho DOS.AI Để Đăng Ký

Sau khi test xong, bạn chỉ cần gửi lại cho bên DOS:
1. **URL endpoint MCP**: `https://mcp-dosclaw.tingee.vn/mcp`
2. **Bearer Token**: Giá trị `MCP_BEARER_TOKEN` bạn đã cấu hình ở Bước 1 (gửi qua kênh bảo mật riêng).

Bên DOS sẽ kích hoạt tool vào bot Em Huyền trong 1 phút!

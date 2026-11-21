# Roadmap

Các việc còn dở, tổng hợp từ các phiên làm việc trước (21/11/2026).

## Chưa làm

- [ ] **Ngày tạo trong danh sách dự án** (trang chính). Server đã lưu `created` trong meta và trả về qua `/api/jobs`, nhưng giao diện chưa hiển thị.
- [ ] **Icon emoji trên thanh công cụ timeline** (🗑 Xoá, 🔗 Nhóm, 🧲 Hút dính) có màu sẵn nên lệch với bộ icon màu riêng. Thay bằng ký hiệu thường hoặc SVG cho đồng bộ.
- [ ] **Nút ◆ chuyển cảnh** đang màu vàng. Quyết định giữ màu hay chuyển sang xám như phần còn lại.
- [ ] **README chưa nói về Editor**: trình dựng `/editor` (timeline, chuyển cảnh, chữ, bộ lọc, xuất video), các API mới (`/api/projects`, `timeline`, `media`, `export`, `export-file`, `open-export`, `api/settings/...`), tự tìm lời bài hát (LRCLIB → Claude CLI) và mục "Cấu trúc" (`server/static/editor/`, `musicvideo/lyrics_lookup.py`).
- [ ] **Xoá `server/static/index.backup.html`** nếu không còn dùng.

## Cần kiểm tra

- [ ] **Chỉnh màu từng clip + 11 chuyển cảnh mới**: mới thử trên bản xem trước, chưa xuất thử video thật.
- [ ] **Sửa lời theo lời chuẩn**: chưa thử tạo job mới từ giao diện web (mới chạy lại trên video mẫu "Từng Yêu Chill (30s)").
- [ ] **Bộ lọc màu toàn video** (tab Bộ lọc): kiểm tra kết quả khi xuất khớp với bản xem trước.

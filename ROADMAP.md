# Roadmap

Các việc còn dở, tổng hợp từ các phiên làm việc trước (21/11/2026).

## Chưa làm

- [ ] **Ngày tạo trong danh sách dự án** (trang chính). Server đã lưu `created` trong meta và trả về qua `/api/jobs`, nhưng giao diện chưa hiển thị.
- [ ] **Icon emoji trên thanh công cụ timeline** (🗑 Xoá, 🔗 Nhóm, 🧲 Hút dính) có màu sẵn nên lệch với bộ icon màu riêng. Thay bằng ký hiệu thường hoặc SVG cho đồng bộ.
- [ ] **Nút ◆ chuyển cảnh** đang màu vàng. Quyết định giữ màu hay chuyển sang xám như phần còn lại.
- [ ] **README chưa nói về Editor**: trình dựng `/editor` (timeline, chuyển cảnh, chữ, bộ lọc, xuất video), các API mới (`/api/projects`, `timeline`, `media`, `export`, `export-file`, `open-export`, `api/settings/...`), tự tìm lời bài hát (LRCLIB → Claude CLI) và mục "Cấu trúc" (`server/static/editor/`, `musicvideo/lyrics_lookup.py`).
- [ ] **Xoá `server/static/index.backup.html`** nếu không còn dùng.
- [ ] **Phát hành bản mới (v1.0.4)**: từ v1.0.3 đã có thêm chuyển cảnh mượt, thư viện logo kênh, bỏ Remotion Studio, ô màu gọn trong bảng Tinh chỉnh, sửa nút kiểm tra cập nhật — máy đã cài chưa nhận được.
- [ ] **README chưa nói về tính năng mới**: Codex CLI dự phòng cho Claude, logo kênh (thư mục `logos/`), 4 chuyển cảnh mượt.
- [ ] **Ô màu trong Editor** (`/editor`) vẫn là ô màu to kiểu cũ, chưa đổi sang ô nhỏ + mã hex như trang chính.
- [ ] **Bộ lọc màu trong Editor áp lên cả logo**, làm logo đổi màu. Nên để logo nằm ngoài bộ lọc (như phụ đề / chữ).
- [ ] **Nút "Ngẫu nhiên" chuyển cảnh trong Editor** bỏ sót kiểu "Hoà tan + phóng" và trộn cả các kiểu gắt (nhiễu, rung…). Nên có tuỳ chọn "ngẫu nhiên kiểu mượt".
- [ ] **v1.0.4 còn thiếu trong ghi chú phát hành / README**: tab **AI** trong Editor (sửa timeline bằng câu lệnh, lệnh "khôi phục lại" / "về như ban đầu"), tự dọn file tạm + lịch sử hoàn tác sau khi xuất video (API `/api/jobs/{id}/ai-edit`, `/api/jobs/{id}/cleanup`), di chuột lên khối timeline hiện đủ chữ.
- [ ] **AI chưa sửa được chữ trong câu lời** và chưa thêm được clip mới (từ Pixabay). Cần thêm thao tác cho AI nếu muốn.
- [ ] **Bản khôi phục của AI bị xoá khi xuất video** (theo cơ chế dọn dẹp). Cân nhắc giữ lại bản gần nhất hoặc báo trước cho người dùng.
- [ ] **AI mất ~15 giây mỗi lệnh**: có thể hiện tiến trình rõ hơn hoặc cho phép huỷ lệnh đang chạy.
- [ ] **Ý tưởng đã đề xuất, chưa chọn làm**: sóng âm + điểm nhịp trên track Nhạc, "cắt theo nhịp", thư viện clip Pixabay trong tab Media, ảnh thu nhỏ trên clip video, keyframe, marker, xuất một đoạn in/out, lưu phiên bản dự án.
- [ ] **Video tạo trước đây** vẫn dùng chuyển cảnh cũ (trượt/quét, 0,5 giây). Có thể thêm nút "Đổi sang chuyển cảnh mượt" cho dự án cũ.

## Cần kiểm tra

- [ ] **Tạo trọn một video mới từ giao diện web** với logo kênh + chuyển cảnh mượt (mới thử bằng khung hình dựng riêng, chưa xem chuyển động liên tục).
- [ ] **Tạo video khi chỉ dùng Codex CLI** (Claude ngắt): đã thử riêng bước chọn cảnh và tìm lời, chưa chạy trọn một video. Lưu ý: trên máy này Codex đang ở trạng thái "Đã ngắt".

- [ ] **Chỉnh màu từng clip + 11 chuyển cảnh mới**: mới thử trên bản xem trước, chưa xuất thử video thật.
- [ ] **Sửa lời theo lời chuẩn**: chưa thử tạo job mới từ giao diện web (mới chạy lại trên video mẫu "Từng Yêu Chill (30s)").
- [ ] **Dọn dẹp sau khi xuất video**: mới gọi trực tiếp API dọn dẹp, chưa chạy qua một lần xuất video thật từ Editor.
- [ ] **Tab AI khi chỉ dùng Codex CLI**: mới thử với Claude CLI.
- [ ] **Tab AI với các lệnh "làm tối / tắt tiếng" và "xoá câu lời"**: đúng ở lần thử đầu, chưa thử lại sau khi đổi prompt.
- [ ] **Bộ lọc màu toàn video** (tab Bộ lọc): kiểm tra kết quả khi xuất khớp với bản xem trước.

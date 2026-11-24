# Roadmap

Đối chiếu với code ngày 24/11/2026. Mục đã hoàn thành được đánh dấu; các ý tưởng chưa chọn làm vẫn để mở.

## Tính năng và tài liệu

- [x] **Ngày tạo trong danh sách dự án**: hiển thị theo giờ địa phương khi job có `created`.
- [x] **Icon timeline**: thay emoji ở Xoá, Nhóm và Hút dính bằng ký hiệu một màu.
- [x] **Nút ◆ chuyển cảnh**: đã chuyển sang màu trắng đồng bộ.
- [x] **README về Editor**: bổ sung tính năng, API, tìm lời và cấu trúc thư mục.
- [x] **Xoá `server/static/index.backup.html`**: không có tham chiếu sử dụng.
- [x] **v1.0.4**: đã có tag phát hành; phiên bản code hiện tại là v1.0.37.
- [x] **README về tính năng mới**: model Claude/Codex, thư viện logo và 4 chuyển cảnh mượt.
- [x] **Ô màu trong Editor**: ô nhỏ cùng mã hex có thể nhập.
- [x] **Bộ lọc màu trong Editor**: logo được loại khỏi bộ lọc toàn video, kể cả dự án cũ có clip ảnh tên `Logo`.
- [x] **Ngẫu nhiên chuyển cảnh**: gồm cả Hoà tan + phóng; thêm nút chỉ chọn kiểu mượt.
- [x] **README về tab AI, dọn dẹp sau xuất** và tooltip đầy đủ trên clip timeline.
- [x] **AI sửa chữ trong câu lời**: đã có `fix_lyrics` và `set_text`.
- [x] **AI thêm clip Pixabay mới**: thao tác `pixabay` tìm, tải và thêm clip mới vào timeline khi đã kết nối Pixabay.
- [x] **Bản khôi phục AI khi xuất video**: giữ bản gần nhất.
- [x] **Trạng thái AI khi chạy**: hiển thị thời gian chờ và bước đang xử lý.
- [ ] **Huỷ lệnh AI đang chạy**: cần cơ chế dừng CLI ở server; chưa triển khai.
- [ ] **Ý tưởng đã đề xuất, chưa chọn làm**: sóng âm + điểm nhịp trên track Nhạc, "cắt theo nhịp", thư viện clip Pixabay trong tab Media, keyframe, marker, xuất một đoạn in/out, lưu phiên bản dự án.
- [x] **Ảnh thu nhỏ trên clip video**: đã có trong timeline.
- [x] **Video tạo trước đây**: thêm nút "Đổi chuyển cảnh cũ sang mượt" trong Editor.

## Cần kiểm tra

- [ ] **Tạo trọn một video mới từ giao diện web** với logo kênh + chuyển cảnh mượt (mới thử bằng khung hình dựng riêng, chưa xem chuyển động liên tục).
- [ ] **Tạo video khi chỉ dùng Codex CLI** (Claude ngắt): đã thử riêng bước chọn cảnh và tìm lời, chưa chạy trọn một video. Lưu ý: trên máy này Codex đang ở trạng thái "Đã ngắt".

- [ ] **Chỉnh màu từng clip + 11 chuyển cảnh mới**: mới thử trên bản xem trước, chưa xuất thử video thật.
- [ ] **Sửa lời theo lời chuẩn**: chưa thử tạo job mới từ giao diện web (mới chạy lại trên video mẫu "Từng Yêu Chill (30s)").
- [ ] **Dọn dẹp sau khi xuất video**: mới gọi trực tiếp API dọn dẹp, chưa chạy qua một lần xuất video thật từ Editor.
- [ ] **Tab AI khi chỉ dùng Codex CLI**: mới thử với Claude CLI.
- [ ] **Tab AI với các lệnh "làm tối / tắt tiếng" và "xoá câu lời"**: đúng ở lần thử đầu, chưa thử lại sau khi đổi prompt.
- [ ] **Bộ lọc màu toàn video** (tab Bộ lọc): kiểm tra kết quả khi xuất khớp với bản xem trước.

## Đăng lên mạng xã hội (24/11/2026)

Đã có: **TikTok** – gửi video vào hộp nháp (Content Posting API, chế độ Upload), AI viết caption, hashtag luôn thêm.
Đang dùng app **Sandbox** (chỉ tài khoản trong Target users dùng được). Hướng dẫn người dùng: `docs/tiktok-guide.html`.

- [ ] **Thử gửi video thật lên TikTok** từ đầu tới cuối (đã kết nối được, chưa gửi thật).
- [ ] **Nộp TikTok duyệt bản Production**: quay video demo (kết nối → gửi → thấy trong app TikTok), tải lên mục App review, Submit. Được duyệt thì người dùng chỉ cần đổi sang Client Key/Secret production, không sửa code.
- [ ] **Thêm nền tảng khác** (YouTube Shorts, Facebook Reels…). Đã có chỗ cắm sẵn, làm theo đúng mẫu TikTok:
  1. **Giao diện**: thêm 1 dòng vào `SHARE_TARGETS` trong `server/static/index.html` (`id`, `name`, `icon`, `desc`, `open: j => xxxDialog(j)`). Dòng không có `open` hiện mờ "Sắp có". Bảng chọn `shareDialog(j)` được mở từ menu ⋯ của dự án và nút "📤 Đăng lên mạng xã hội" trong hộp Xuất video của Editor (`/?share=<job_id>`).
  2. **Server**: tạo module riêng như `server/tiktok.py` (OAuth, lưu token vào file riêng trên máy và thêm file đó vào `.gitignore`, hàm `upload(video, on_state)`), gắn router vào `server/app.py`, thêm endpoint `POST /api/jobs/{id}/<nền tảng>` chạy upload trong thread và lưu trạng thái vào `job.json` (như khoá `tiktok`).
  3. **Cài đặt**: thêm một khối `.svc` trong bảng Cài đặt để nhập key và Kết nối, kèm link hướng dẫn trong `docs/` (GitHub Pages).
  4. **Caption**: dùng lại `POST /api/jobs/{id}/tiktok/caption` (AI viết từ tên bài + lời) hoặc tách thành endpoint chung nếu nền tảng mới cần độ dài hoặc hashtag khác.
  5. Video nguồn là `output/<job>/video.mp4` (bản H.264 xuất từ Editor được chép vào đây).
- [x] **Tự xuất lại video trước khi đăng nếu có chỉnh sửa chưa xuất**: so thời gian sửa `timeline.json` với `video.mp4`, hiển thị nhắc trên trang chủ và xuất lại H.264 trước khi gửi TikTok.
- [x] **Cảnh quay không lặp giữa các video**: lưu ID clip trong `pixabay_history.json` ở `DATA_DIR`, ưu tiên loại clip của 10 dự án trước, thử thêm trang kết quả thứ hai và chọn ngẫu nhiên trong nhóm clip phù hợp. Chỉ dùng lại clip cũ khi không tìm được clip mới.
## Rà soát các phiên làm việc (24/11/2026, bản hiện tại v1.0.37)

Ghi chú: các mục cũ về v1.0.4 và README đã được đối chiếu, cập nhật ở đầu roadmap. Bản GitHub trước thay đổi này là v1.0.37.

### Chưa làm
- [ ] **Hàng chờ dự án + ưu tiên xuất video** (đã đề xuất, người dùng chưa chốt làm): hiện bấm Tạo video là chạy ngay, nhiều dự án chạy song song làm máy rất nặng; xuất video từ Editor cũng chạy song song. Hướng làm:
  1. Mỗi lúc chỉ chạy 1 dự án; dự án sau hiện "Đang chờ (thứ N)", tự chạy khi dự án trước xong, có nút huỷ khi đang chờ.
  2. Bấm Xuất video trong Editor thì **tạm dừng** (đóng băng, không chạy lại từ đầu) dự án đang tạo, xuất xong tự chạy tiếp; trạng thái "Tạm dừng – đang ưu tiên xuất video".
  3. Đăng mạng xã hội không cần chờ/tạm dừng.
  4. Tắt app khi còn hàng chờ thì mở lại tự chạy tiếp (lưu hàng chờ ra file, đúng quy tắc lưu mọi lựa chọn).
- [ ] **Xuất video bằng ffmpeg trực tiếp** cho timeline đơn giản (cắt, ghép, chữ, nhạc) để nhanh gần CapCut. Remotion hiện chỉ ~5–6 khung/giây ở 1080p (máy không có GPU NVIDIA). Việc lớn, làm khi người dùng yêu cầu.

### Cần kiểm tra
- [ ] **Nút "⬇ Tải đoạn nhạc"** (`/api/cut-audio`): code xong nhưng chưa kiểm tra trên app thật sau khi khởi động lại server (lúc thử trả 404 vì server cũ).
- [ ] **Chạy lại từ chỗ lỗi / Tiếp tục** (v1.0.36, `resume_job` trong `server/app.py`): chưa xác nhận người dùng chạy lại thành công dự án "Tình như lá bay xa".
- [ ] **Render tự thử lại với ít luồng hơn**: mới thử với đúng clip lỗi, chưa thử trên nhiều dự án.
- [ ] **Phụ đề chill chạy theo ký tự** (Chữ chảy, Hiện trước vài chữ, Sáng dần, Sương mờ – v1.0.17): mới xem trong Editor, chưa xuất video hoàn chỉnh.
- [ ] **Tuỳ chọn phụ đề ở form tạo video** (v1.0.34): kiểm tra tạo trọn một video với từng kiểu và lựa chọn được nhớ sau khi khởi động lại.
- [ ] **Tăng tốc xuất video** (720p/480p dựng thẳng, JPEG, 6 luồng, `veryfast`; chờ ảnh 120 giây + tải lại 2 lần – v1.0.18): mới đo đoạn 10 giây, chưa xuất trọn một video qua Editor; chưa xác nhận dự án "1 Từng Yêu" xuất được.
- [ ] **Hậu tố model Codex** (nhanh / cân bằng / đời cũ): tự đoán từ mô tả tiếng Anh – kiểm tra lại khi Codex có model mới.

- [x] **Nút "Dọn dẹp" clip tải về** (đã làm: Cài đặt → "Clip đã tải"; `GET /api/clips`, `POST /api/clips/cleanup`; `restore_clips` tải lại clip thiếu khi mở Editor, xuất video, render lại) (yêu cầu của người dùng, để tiết kiệm ổ đĩa): hiện clip Pixabay lưu chung ở thư mục `clips` và **không bao giờ bị xoá** (kể cả khi xuất video hay xoá dự án). Đã chốt: **người dùng tự bấm dọn**, app không tự xoá (không xoá lúc dự án xong, lúc xuất, lúc đóng hay mở app). Hướng làm: trong Cài đặt hiện dung lượng thư mục clip (vd "Clip đã tải: 2,3 GB") kèm nút "Dọn dẹp", hỏi xác nhận rồi xoá; không cho bấm khi có dự án đang chạy. Mở lại dự án cũ trong Studio sau khi dọn thì app tự tải lại clip theo ID Pixabay lưu trong timeline. Lịch sử chống trùng ở mục trên chỉ lưu ID nên không bị ảnh hưởng.

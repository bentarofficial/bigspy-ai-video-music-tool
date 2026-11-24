# AI Music Video Tool

<p align="center">
  <a href="https://github.com/bentarofficial/bigspy-ai-video-music-tool/releases/latest">
    <img src="https://img.shields.io/badge/%E2%AC%87%20T%E1%BA%A3i%20v%E1%BB%81%20cho%20Windows-b%E1%BA%A3n%20m%E1%BB%9Bi%20nh%E1%BA%A5t-2ea44f?style=for-the-badge" alt="Tải về">
  </a>
  <br>
  <img src="https://img.shields.io/github/v/release/bentarofficial/bigspy-ai-video-music-tool?label=phi%C3%AAn%20b%E1%BA%A3n" alt="Phiên bản">
  <img src="https://img.shields.io/github/downloads/bentarofficial/bigspy-ai-video-music-tool/total?label=l%C6%B0%E1%BB%A3t%20t%E1%BA%A3i" alt="Lượt tải">
</p>

> Tải file `AI-Music-Video-Setup-x.y.z.exe` trong mục **Assets** của bản phát hành mới nhất, chạy và làm theo hướng dẫn cài đặt.

## Lấy API key Pixabay (miễn phí)

App cần key Pixabay để tìm và tải clip:

1. Đăng nhập (hoặc tạo tài khoản miễn phí) tại [pixabay.com](https://pixabay.com).
2. Mở [trang API → Search Videos](https://pixabay.com/api/docs/#api_search_videos).
3. Ở bảng **Parameters**, dòng **key (required)** có ô màu xanh **Your API key**: chép chuỗi trong ô đó.
4. Trong app, bấm **Cài đặt → Kết nối → Pixabay**, dán key rồi bấm **Kết nối**.

## Kết nối AI: Claude CLI hoặc Codex CLI (tuỳ chọn)

Có AI, app sẽ chọn cảnh quay theo nội dung lời bài hát, tìm lời chuẩn của bài và dùng được tab **AI chỉnh sửa** trong Editor. Không có AI, app vẫn chạy được, chỉ chọn cảnh theo ô **Chủ đề hình ảnh**.

Chỉ cần **một trong hai**. Trong Cài đặt, chọn model Claude hoặc Codex muốn dùng; app sẽ chạy CLI tương ứng với model đã chọn. App dùng gói bạn đã đăng nhập trong CLI, không cần API key riêng.

**Claude CLI** (cần gói Claude Pro/Max):

```powershell
npm install -g @anthropic-ai/claude-code
claude
```

**ChatGPT Codex CLI** (cần gói ChatGPT Plus/Pro):

```powershell
npm install -g @openai/codex
codex
```

Lần đầu chạy lệnh `claude` hoặc `codex`, làm theo hướng dẫn để đăng nhập rồi thoát. Sau đó mở lại app, vào **Cài đặt → Kết nối**: CLI đã cài sẽ hiện nút **Kết nối** / **Huỷ kết nối** để bật hoặc tắt.

Tải lên một file nhạc (mp3/wav/m4a/flac). Tool sẽ:

1. Nghe và lấy **lời bài hát** kèm thời điểm từng chữ (Whisper). Nếu bạn dán sẵn lời, tool căn lời đó vào giọng hát nên chính xác hơn.
2. Phân tích **nhịp (beat)** và chia bài thành các cảnh, điểm cắt cảnh rơi đúng nhịp.
3. Chọn **từ khóa hình ảnh** cho từng cảnh: Claude CLI hoặc Codex CLI đọc lời bài hát theo model đã chọn. Nếu không kết nối AI thì dùng chủ đề bạn nhập.
4. Tìm và tải **video miễn phí bản quyền từ Pixabay**.
5. Dựng video bằng **Remotion**: các chuyển cảnh mượt gồm Hoà tan + phóng, Hoà tan nhoè, Đẩy mềm và Hoà sáng; hiệu ứng zoom chậm, **phụ đề chạy khớp lời** và **tên bài hát có hiệu ứng**.

## Cài đặt (một lần)

Cần có Python 3.10+ và Node.js 18+. Không cần cài FFmpeg vì đã có sẵn qua `imageio-ffmpeg` và Remotion.

```powershell
pip install -r requirements.txt
cd remotion; npm install; cd ..
copy .env.example .env    # rồi điền PIXABAY_API_KEY (hoặc nhập trong giao diện web)
```


## Chạy

- Tải file `.exe` mới nhất từ mục **Releases** trên GitHub rồi chạy; ứng dụng mở trong cửa sổ riêng

Log của server nằm trong `logs\`, log từng video nằm trong `output\<job>\log.txt`.

### Khi ổ cài đặt gần đầy

File nhạc và video có thể chiếm nhiều dung lượng. Tắt app, thêm `AI_MUSIC_VIDEO_DATA_DIR=D:\AI-Music-Video-Data` vào file `.env` trong thư mục cài đặt, rồi chép `output`, `uploads`, `exports`, `.cache` và nội dung `remotion/public` cũ sang thư mục dữ liệu mới (nội dung cuối cùng đặt trong `public`). Mở lại app; upload, file tạm và video mới sẽ dùng ổ dữ liệu này. Nếu đường dẫn chưa có, app sẽ tạo tự động.

## Trong giao diện

- **Kiểu phụ đề**
  - Karaoke: chữ đổi màu đúng lúc hát.
  - Hiện trước N chữ: chữ hiện dần, đi trước giọng hát N chữ.
  - Cả câu + câu sau: hiện trước cả câu đang hát và câu kế tiếp (mờ hơn).
- **Tên bài hát**: chỉnh chữ, cỡ chữ, màu, màu nhấn, vị trí, thời gian hiện. Hiệu ứng có `zoom`, `fade`, `typewriter`, `bounce`, `slide-up`, `glow`.
- **Lưu & render lại**: đổi style mà không phải nhận lời hay tải clip lại.

## Editor

Mở dự án bằng **Editor** tại `/editor` để sắp xếp clip trên timeline, thêm chữ và câu lời, chỉnh chuyển cảnh, âm lượng, bộ lọc màu rồi xuất video. Có thể tạo dự án dựng trống và nhập media riêng. Tab **AI** sửa timeline bằng câu lệnh khi đã kết nối Claude CLI hoặc Codex CLI; lệnh “khôi phục lại” và “về như ban đầu” dùng các bản lưu trước lần sửa bằng AI. AI cũng có thể tìm và thêm clip mới khi đã kết nối Pixabay. Có nút tra và sửa lời phụ đề: app tìm lời chuẩn qua LRCLIB, rồi dùng CLI AI đã chọn khi cần. Sau khi xuất xong, Editor dọn file tạm và lịch sử hoàn tác thông thường, nhưng giữ bản khôi phục AI gần nhất.

Các API của Editor gồm `POST /api/projects`, `GET/PUT /api/jobs/{id}/timeline`, `POST /api/jobs/{id}/media`, `POST /api/jobs/{id}/ai-edit`, `POST /api/jobs/{id}/fix-lyrics`, `POST /api/jobs/{id}/export`, `GET /api/jobs/{id}/export-file`, `POST /api/jobs/{id}/open-export` và `POST /api/jobs/{id}/cleanup`. Kết nối CLI AI và Pixabay được quản lý qua `/api/settings` và `/api/settings/{service}/{action}`.

Từ **v1.0.4**, Editor có tab AI để sửa timeline bằng câu lệnh, khôi phục lần sửa trước hoặc về ban đầu, tự dọn file tạm sau khi xuất và hiện đầy đủ tên clip khi di chuột trên timeline. Các bản mới hơn bổ sung sửa lời phụ đề, nhiều kiểu chuyển cảnh và bộ lọc màu.

## Dùng bằng dòng lệnh

```powershell
python make_video.py song.mp3 --title "Tên bài" --lyrics loi.txt --lang vi --render
python make_video.py --render-only output\<job>\props.json
```

## Cấu trúc

```
make_video.py          pipeline chính (CLI)
musicvideo/            audio, lời bài hát, beat/cảnh, từ khóa, Pixabay
server/                web server FastAPI + giao diện chính (static/index.html)
server/static/editor/  Editor: timeline, xem trước, bộ lọc, AI và xuất video
musicvideo/lyrics_lookup.py  tìm lời chuẩn qua LRCLIB và CLI AI
logos/                 thư viện logo kênh (tạo khi cần)
remotion/src/          dựng video: Scenes (chuyển cảnh), Subtitles (3 kiểu), TitleText (hiệu ứng)
scripts/               start.ps1 / stop.ps1
```

## Lưu ý

- Máy không có GPU nên Whisper chạy trên CPU. Model `small` nhanh. Với tiếng Việt nên dùng `medium` hoặc dán lời bài hát.
- Pixabay giới hạn khoảng 100 request/phút. Clip đã tải được dùng lại ở `remotion/public/clips/`.
- Remotion miễn phí cho cá nhân và công ty từ 3 người trở xuống. Nếu thương mại hóa ở quy mô lớn hơn thì cần mua license.
- Bài hát có bản quyền vẫn có thể bị Content ID chặn khi đăng lên mạng xã hội.

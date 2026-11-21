# AI Music Video Tool

<p align="center">
  <a href="https://github.com/bentarofficial/bigspy-ai-video-music-tool/releases/latest">
    <img src="https://img.shields.io/badge/⬇%20Tải%20về%20cho%20Windows-bản%20mới%20nhất-2ea44f?style=for-the-badge" alt="Tải về">
  </a>
  <br>
  <img src="https://img.shields.io/github/v/release/bentarofficial/bigspy-ai-video-music-tool?label=phiên%20bản" alt="Phiên bản">
  <img src="https://img.shields.io/github/downloads/bentarofficial/bigspy-ai-video-music-tool/total?label=lượt%20tải" alt="Lượt tải">
</p>

> Tải file `AI-Music-Video-Setup-x.y.z.exe` trong mục **Assets** của bản phát hành mới nhất, chạy và làm theo hướng dẫn cài đặt.

Tải lên một file nhạc (mp3/wav/m4a/flac). Tool sẽ:

1. Nghe và lấy **lời bài hát** kèm thời điểm từng chữ (Whisper). Nếu bạn dán sẵn lời, tool căn lời đó vào giọng hát nên chính xác hơn.
2. Phân tích **nhịp (beat)** và chia bài thành các cảnh, điểm cắt cảnh rơi đúng nhịp.
3. Chọn **từ khóa hình ảnh** cho từng cảnh: Claude CLI (lệnh `claude`, dùng gói Claude đang đăng nhập, không cần API key) đọc lời bài hát. Nếu không có CLI thì dùng chủ đề bạn nhập.
4. Tìm và tải **video miễn phí bản quyền từ Pixabay**.
5. Dựng video bằng **Remotion**: chuyển cảnh mượt (fade, slide, wipe), hiệu ứng zoom chậm, **phụ đề chạy khớp lời** và **tên bài hát có hiệu ứng**.

## Cài đặt (một lần)

Cần có Python 3.10+ và Node.js 18+. Không cần cài FFmpeg vì đã có sẵn qua `imageio-ffmpeg` và Remotion.

```powershell
pip install -r requirements.txt
cd remotion; npm install; cd ..
copy .env.example .env    # rồi điền PIXABAY_API_KEY (hoặc nhập trong giao diện web)
```

Tùy chọn tách giọng hát để nhận lời chuẩn hơn: `pip install demucs` (nặng, cần PyTorch).

## Chạy

- **`start.bat`**: khởi động server **ẩn** (PowerShell `-WindowStyle Hidden`) rồi mở http://127.0.0.1:8790
- **`stop.bat`**: dừng server, Remotion Studio và các tiến trình render đang chạy

Log của server nằm trong `logs\`, log từng video nằm trong `output\<job>\log.txt`.

## Trong giao diện

- **Kiểu phụ đề**
  - Karaoke: chữ đổi màu đúng lúc hát.
  - Hiện trước N chữ: chữ hiện dần, đi trước giọng hát N chữ.
  - Cả câu + câu sau: hiện trước cả câu đang hát và câu kế tiếp (mờ hơn).
- **Tên bài hát**: chỉnh chữ, cỡ chữ, màu, màu nhấn, vị trí, thời gian hiện. Hiệu ứng có `zoom`, `fade`, `typewriter`, `bounce`, `slide-up`, `glow`.
- **Lưu & render lại**: đổi style mà không phải nhận lời hay tải clip lại.
- **Xem trước (Remotion Studio)**: xem từng khung hình và tua video trước khi render.

## Dùng bằng dòng lệnh

```powershell
python make_video.py song.mp3 --title "Tên bài" --lyrics loi.txt --lang vi --render
python make_video.py --render-only output\<job>\props.json
```

## Cấu trúc

```
make_video.py          pipeline chính (CLI)
musicvideo/            audio, lời bài hát, beat/cảnh, từ khóa, Pixabay
server/                web server FastAPI + giao diện (static/index.html)
remotion/src/          dựng video: Scenes (chuyển cảnh), Subtitles (3 kiểu), TitleText (hiệu ứng)
scripts/               start.ps1 / stop.ps1
```

## Lưu ý

- Máy không có GPU nên Whisper chạy trên CPU. Model `small` nhanh. Với tiếng Việt nên dùng `medium` hoặc dán lời bài hát.
- Pixabay giới hạn khoảng 100 request/phút. Clip đã tải được dùng lại ở `remotion/public/clips/`.
- Remotion miễn phí cho cá nhân và công ty từ 3 người trở xuống. Nếu thương mại hóa ở quy mô lớn hơn thì cần mua license.
- Bài hát có bản quyền vẫn có thể bị Content ID chặn khi đăng lên mạng xã hội.

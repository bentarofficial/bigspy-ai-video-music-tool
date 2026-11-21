// Nạp Google Fonts (đều hỗ trợ tiếng Việt) trước khi render, để chữ/phụ đề hiện đúng phông đã chọn.
import {continueRender, delayRender} from 'remotion';

export const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;700;900&family=Montserrat:wght@400;700;900&family=Roboto:wght@400;700;900&family=Open+Sans:wght@400;700;800&family=Nunito:wght@400;700;900&family=Lexend:wght@400;700;900&family=Josefin+Sans:wght@400;700&family=Quicksand:wght@400;700&family=Comfortaa:wght@400;700&family=Oswald:wght@400;700&family=Anton:wght@400&family=Baloo+2:wght@400;800&family=Playfair+Display:wght@400;700;900&family=Merriweather:wght@400;700;900&family=Noto+Serif:wght@400;700&family=Lobster:wght@400&family=Pacifico:wght@400&family=Dancing+Script:wght@400;700&family=Great+Vibes:wght@400&family=Charm:wght@400;700&family=Pattaya:wght@400&family=Patrick+Hand:wght@400&family=Sigmar:wght@400&display=block";

if (typeof document !== 'undefined' && !document.getElementById('gfonts')) {
	const handle = delayRender('Đang tải phông chữ');
	const link = document.createElement('link');
	link.id = 'gfonts';
	link.rel = 'stylesheet';
	link.href = GOOGLE_FONTS_URL;
	const done = () => continueRender(handle);
	link.onload = () => {
		const fams = ["Be Vietnam Pro", "Montserrat", "Roboto", "Open Sans", "Nunito", "Lexend", "Josefin Sans", "Quicksand", "Comfortaa", "Oswald", "Anton", "Baloo 2", "Playfair Display", "Merriweather", "Noto Serif", "Lobster", "Pacifico", "Dancing Script", "Great Vibes", "Charm", "Pattaya", "Patrick Hand", "Sigmar"];
		Promise.all(fams.flatMap((f) => ['400', '700'].map((w) => document.fonts.load(`${w} 40px "${f}"`, 'Việt')))).then(done, done);
	};
	link.onerror = done; // không có mạng -> dùng phông dự phòng
	setTimeout(done, 15000);
	document.head.appendChild(link);
}

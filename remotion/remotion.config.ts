import {Config} from '@remotion/cli/config';
import os from 'os';

// Render nhanh: dùng ~3/4 luồng CPU (dùng hết thì Chrome hay treo lúc khởi động), chụp khung JPEG (nhanh hơn PNG nhiều)
Config.setConcurrency(Math.max(1, Math.round(os.cpus().length * 0.75)));
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(90);
Config.setX264Preset('veryfast');

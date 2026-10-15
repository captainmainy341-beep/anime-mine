"""Remove white-with-navy-outline burned-in subtitles using LaMa inpainting.

usage: desub.py INPUT OUTPUT MODEL FFMPEG
Prints "progress <0..1>" lines on stdout; exits 0 on success.
"""
import re
import subprocess
import sys

import cv2
import numpy as np
import torch

src, dst, model_path, ffmpeg = sys.argv[1:5]

probe = subprocess.run([ffmpeg, '-hide_banner', '-i', src], capture_output=True, text=True).stderr
size = re.search(r'Video:.*?, (\d{3,5})x(\d{3,5})', probe)
W, H = int(size.group(1)), int(size.group(2))
fps = float(re.search(r'([\d.]+) fps', probe).group(1))
duration = re.search(r'Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)', probe)
total_frames = 0
if duration:
    seconds = int(duration.group(1)) * 3600 + int(duration.group(2)) * 60 + float(duration.group(3))
    total_frames = max(1, int(seconds * fps))

torch.set_grad_enabled(False)
model = torch.jit.load(model_path, map_location='cpu').eval()

STROKE = max(2, round(H / 360))
BAND_TOP = int(H * 0.62)
MIN_CORE = H * W * 0.0004
MIN_BLOB = H * 0.8
SCALE = min(1.0, 540 / H)
PAD = 40
CLOSE_KERNEL = np.ones((STROKE * 3, STROKE * 8), np.uint8)
NEAR_KERNEL = np.ones((2 * STROKE + 1, 2 * STROKE + 1), np.uint8)
GROW_KERNEL = np.ones((STROKE * 5 + 2, STROKE * 5 + 2), np.uint8)


def text_mask(frame):
    band = frame[BAND_TOP:].astype(np.int16)
    r, g, b = band[..., 0], band[..., 1], band[..., 2]
    white = np.minimum(np.minimum(r, g), b) > 215
    navy = (b > r + 18) & (r < 70) & (g < 70) & (b < 140)
    outline = navy & (cv2.dilate(white.astype(np.uint8), NEAR_KERNEL) > 0)
    fill = white & (cv2.dilate(navy.astype(np.uint8), NEAR_KERNEL) > 0)
    core = (outline | fill).astype(np.uint8)
    if core.sum() < MIN_CORE:
        return None
    closed = cv2.morphologyEx(core, cv2.MORPH_CLOSE, CLOSE_KERNEL)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(closed)
    keep = np.zeros_like(core)
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] > MIN_BLOB:
            keep |= ((labels == i) & (core > 0)).astype(np.uint8)
    if not keep.any():
        return None
    full = np.zeros((H, W), np.uint8)
    full[BAND_TOP:] = cv2.dilate(keep, GROW_KERNEL)
    return full


def snap8(value):
    return max(8, int(round(value / 8)) * 8)


def inpaint(frame, mask):
    ys, xs = np.where(mask > 0)
    y0, x0 = max(0, ys.min() - PAD), max(0, xs.min() - PAD)
    y1, x1 = min(H, ys.max() + 1 + PAD), min(W, xs.max() + 1 + PAD)
    crop = frame[y0:y1, x0:x1]
    cmask = (mask[y0:y1, x0:x1] > 0).astype(np.float32)
    h, w = snap8(crop.shape[0] * SCALE), snap8(crop.shape[1] * SCALE)
    small = cv2.resize(crop, (w, h), interpolation=cv2.INTER_AREA)
    small_mask = (cv2.resize(cmask, (w, h), interpolation=cv2.INTER_NEAREST) > 0).astype(np.float32)
    image = torch.from_numpy(small).permute(2, 0, 1)[None].float() / 255
    out = model(image, torch.from_numpy(small_mask)[None, None])[0].permute(1, 2, 0).clamp(0, 1).numpy()
    restored = cv2.resize((out * 255).astype(np.uint8), (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_CUBIC)
    result = frame.copy()
    selected = cmask > 0
    result[y0:y1, x0:x1][selected] = restored[selected]
    return result


decoder = subprocess.Popen(
    [ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    stdout=subprocess.PIPE,
)
encoder = subprocess.Popen(
    [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
     '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
     '-i', src, '-map', '0:v', '-map', '1:a?',
     '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
     '-c:a', 'copy', '-sn', '-dn', '-movflags', '+faststart', '-f', 'mp4', dst],
    stdin=subprocess.PIPE,
)

frame_bytes = W * H * 3
done = 0
while True:
    buffer = decoder.stdout.read(frame_bytes)
    if len(buffer) < frame_bytes:
        break
    frame = np.frombuffer(buffer, np.uint8).reshape(H, W, 3)
    mask = text_mask(frame)
    if mask is not None:
        frame = inpaint(frame, mask)
    encoder.stdin.write(frame.tobytes())
    done += 1
    if done % 24 == 0 and total_frames:
        print(f'progress {min(1.0, done / total_frames):.4f}', flush=True)

encoder.stdin.close()
encoder_code = encoder.wait()
decoder_code = decoder.wait()
if encoder_code != 0 or decoder_code != 0:
    sys.exit(f'ffmpeg failed (decode {decoder_code}, encode {encoder_code})')
print('progress 1.0000', flush=True)

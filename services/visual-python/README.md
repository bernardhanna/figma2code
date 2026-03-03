# Visual Python Service (Optional)

Optional OpenCV/SSIM analysis sidecar for visual compare.  
Node remains the orchestrator and falls back to JS diff automatically when this service is disabled or unavailable.

## API

`POST /analyze` (multipart/form-data)

- `baseline`: PNG file
- `output`: PNG file
- `breakpoint`: string (e.g. `mobile|tablet|desktop`)
- `metadata`: JSON string (optional)
- `includeMask`: `1|0` (optional, default `1`)

Response:

- `ssim`
- `diffPixels`
- `totalPixels`
- `diffRatio`
- `offenders`: list of rects `{x,y,w,h,area,severity}`
- `hints`: lightweight classification hints
- `diffMaskPngBase64` (when `includeMask=1`)

## Run locally

```bash
cd services/visual-python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8091
```

Health:

```bash
curl -s http://127.0.0.1:8091/health
```


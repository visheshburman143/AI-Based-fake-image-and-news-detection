import io
import importlib.util
import json
import logging
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MODEL_ID = "NYUAD-ComNets/NYUAD_AI-generated_images_detector"
_model_lock = threading.Lock()
_image_model = None
_image_processor = None
_torch = None


class RequestError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class TruthLensHandler(BaseHTTPRequestHandler):
    server_version = "TruthLens/1.0"

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "factCheckConfigured": bool(os.environ.get("GOOGLE_FACT_CHECK_API_KEY")),
                "imageDependenciesReady": all(
                    importlib.util.find_spec(package) is not None
                    for package in ("torch", "transformers", "PIL")
                ),
                "imageModelLoaded": _image_model is not None,
                "imageModel": MODEL_ID,
            })
            return

        filename = "index.html" if path == "/" else path.lstrip("/")
        if filename not in {"index.html", "styles.css", "app.js"}:
            self.send_error(404)
            return
        content_type = {
            "index.html": "text/html; charset=utf-8",
            "styles.css": "text/css; charset=utf-8",
            "app.js": "text/javascript; charset=utf-8",
        }[filename]
        try:
            content = (ROOT / filename).read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path == "/api/fact-check":
                self.handle_fact_check()
            elif path == "/api/image-check":
                self.handle_image_check()
            else:
                self.send_json(404, {"error": "Endpoint not found."})
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except Exception as error:
            logging.exception("Local analyzer request failed: %s", error)
            self.send_json(500, {"error": "The local analyzer encountered an unexpected error."})

    def handle_fact_check(self):
        api_key = os.environ.get("GOOGLE_FACT_CHECK_API_KEY")
        if not api_key:
            raise RequestError(
                "Fact-check search is not configured. Set GOOGLE_FACT_CHECK_API_KEY and restart the local server.",
                503,
            )
        body = self.read_body(16 * 1024)
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RequestError("The claim request must contain valid JSON.")
        if not isinstance(payload, dict) or not isinstance(payload.get("query"), str):
            raise RequestError("The claim request must include a text query.")
        query = payload["query"].strip()
        if len(query) < 20:
            raise RequestError("Enter at least 20 characters to search for fact-check reviews.")

        params = urllib.parse.urlencode({
            "query": query[:500],
            "pageSize": "5",
            "key": api_key,
        })
        request = urllib.request.Request(
            f"https://factchecktools.googleapis.com/v1alpha1/claims:search?{params}",
            headers={"Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                response_data = json.loads(response.read(1024 * 1024))
        except urllib.error.HTTPError as error:
            if error.code in (400, 403):
                raise RequestError("Google rejected the API key or request. Check that the Fact Check Tools API is enabled for this key.", 502)
            raise RequestError(f"Fact-check service returned HTTP {error.code}. Try again later.", 502)
        except (urllib.error.URLError, TimeoutError):
            raise RequestError("Could not reach the fact-check service. Check your internet connection and try again.", 502)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RequestError("The fact-check service returned an unreadable response.", 502)

        claims = []
        for item in response_data.get("claims", [])[:5]:
            reviews = []
            for review in item.get("claimReview", [])[:3]:
                publisher = review.get("publisher") or {}
                reviews.append({
                    "publisher": publisher.get("name", "Fact-check publisher"),
                    "title": review.get("title", ""),
                    "rating": review.get("textualRating", ""),
                    "url": review.get("url", ""),
                    "date": review.get("reviewDate", ""),
                })
            claims.append({
                "text": item.get("text", ""),
                "claimant": item.get("claimant", ""),
                "claimDate": item.get("claimDate", ""),
                "reviews": reviews,
            })
        self.send_json(200, {"claims": claims})

    def handle_image_check(self):
        body = self.read_body(MAX_IMAGE_BYTES)
        try:
            from PIL import Image, ImageOps, UnidentifiedImageError
        except ImportError:
            raise RequestError("Image analysis needs Pillow. Install the packages in requirements.txt and restart.", 503)

        try:
            with Image.open(io.BytesIO(body)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP", "GIF"}:
                    raise RequestError("Choose a JPG, PNG, WEBP, or GIF image.")
                if source.width * source.height > 40_000_000:
                    raise RequestError("This image has too many pixels to analyze safely.")
                image = ImageOps.exif_transpose(source).convert("RGB")
        except RequestError:
            raise
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise RequestError("The image could not be decoded safely.")

        model, processor, torch = self.load_image_model()
        inputs = processor(images=image, return_tensors="pt")
        with torch.inference_mode():
            logits = model(**inputs).logits[0]
            probabilities = torch.softmax(logits, dim=-1).tolist()

        scores = []
        id2label = model.config.id2label
        for index, value in enumerate(probabilities):
            label = str(id2label.get(index, id2label.get(str(index), f"class_{index}")))
            scores.append({"label": label, "score": round(float(value) * 100, 1)})
        scores.sort(key=lambda result: result["score"], reverse=True)
        score_by_label = {result["label"].strip().lower(): result["score"] for result in scores}
        ai_score = round(score_by_label.get("dalle", 0) + score_by_label.get("sd", 0), 1)
        real_score = score_by_label.get("real", 0)
        if ai_score >= 70:
            assessment = "Model detected stronger AI-generation signals"
        elif real_score >= 70:
            assessment = "Model detected stronger real-image signals"
        else:
            assessment = "Model result is inconclusive"
        self.send_json(200, {
            "assessment": assessment,
            "aiScore": ai_score,
            "realScore": real_score,
            "scores": scores,
            "model": MODEL_ID,
        })

    @staticmethod
    def load_image_model():
        global _image_model, _image_processor, _torch
        with _model_lock:
            if _image_model is None:
                try:
                    import torch
                    from transformers import AutoImageProcessor, AutoModelForImageClassification
                except ImportError:
                    raise RequestError(
                        "Image AI needs PyTorch and Transformers. Install requirements.txt in a supported Python environment, then restart.",
                        503,
                    )
                try:
                    model = AutoModelForImageClassification.from_pretrained(MODEL_ID)
                    processor = AutoImageProcessor.from_pretrained(MODEL_ID)
                    model.eval()
                except Exception as error:
                    logging.exception("Could not load the image model: %s", error)
                    raise RequestError(
                        "Could not load the image model. Check your internet connection and available disk space, then try again.",
                        503,
                    )
                _image_model = model
                _image_processor = processor
                _torch = torch
            return _image_model, _image_processor, _torch

    def read_body(self, limit):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise RequestError("Invalid request size.")
        if length < 1:
            raise RequestError("Request body is empty.")
        if length > limit:
            raise RequestError("Request is larger than the allowed limit.")
        body = self.rfile.read(length)
        if len(body) != length:
            raise RequestError("Request body was incomplete.")
        return body

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        if self.path.startswith("/api/"):
            super().log_message(format_string, *args)


if __name__ == "__main__":
    address = ("127.0.0.1", int(os.environ.get("PORT", "8000")))
    print(f"Truth Lens is running at http://{address[0]}:{address[1]}")
    print("Image bytes are analyzed locally. Fact-check query text is sent to Google only on request.")
    ThreadingHTTPServer(address, TruthLensHandler).serve_forever()

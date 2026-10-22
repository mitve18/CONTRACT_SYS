"""OCR for scanned pages, cheapest first: local Tesseract, then a vision model for one page at a time."""

from __future__ import annotations

import io
import logging
import shutil
from dataclasses import dataclass
from functools import lru_cache

from app.core.config import get_settings

log = logging.getLogger(__name__)

VISION_PROMPT = (
    "תמלל את כל הטקסט שבתמונה של עמוד מחוזה, מילה במילה, בסדר הקריאה הנכון (עברית מימין לשמאל). "
    "שמור על מספור סעיפים ועל ירידות שורה. אל תוסיף הסברים, כותרות או סיכום. "
    "אם יש חותמת או כתב יד שלא ניתן לקרוא, כתוב [לא קריא]."
)


@dataclass
class OcrResult:
    text: str
    confidence: float  # 0-100
    engine: str  # "tesseract" | "vision" | "none"


@lru_cache(maxsize=1)
def tesseract_available() -> bool:
    s = get_settings()
    try:
        import pytesseract

        if s.tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = s.tesseract_cmd
        elif not shutil.which("tesseract"):
            return False
        langs = pytesseract.get_languages(config="")
        if "heb" not in langs:
            log.warning("tesseract found but Hebrew language data (heb) is missing")
            return False
        return True
    except Exception:
        return False


def ocr_tesseract(png: bytes) -> OcrResult:
    import pytesseract
    from PIL import Image

    image = Image.open(io.BytesIO(png))
    data = pytesseract.image_to_data(
        image, lang="heb+eng", config="--psm 6", output_type=pytesseract.Output.DICT
    )
    confs = [float(c) for c, w in zip(data["conf"], data["text"]) if w.strip() and float(c) >= 0]
    confidence = sum(confs) / len(confs) if confs else 0.0
    text = pytesseract.image_to_string(image, lang="heb+eng", config="--psm 6")
    return OcrResult(text=text, confidence=confidence, engine="tesseract")


def ocr_vision(png: bytes, *, request_id: str | None = None) -> OcrResult:
    from agno.agent import Agent
    from agno.media import Image

    from app.core.llm import ensure_budget, model_for, record_run

    ensure_budget()
    agent = Agent(name="ocr", model=model_for("fast", max_tokens=3000, temperature=0), telemetry=False)
    run = agent.run(VISION_PROMPT, images=[Image(content=png, format="png")])
    record_run("ocr_vision", run, request_id)
    return OcrResult(text=str(run.content or ""), confidence=85.0, engine="vision")


def ocr_page(png: bytes, *, allow_vision: bool = True) -> OcrResult:
    s = get_settings()
    result = OcrResult("", 0.0, "none")
    if tesseract_available():
        try:
            result = ocr_tesseract(png)
        except Exception:
            log.exception("tesseract failed")
    good_enough = result.confidence >= s.ocr_min_confidence and len(result.text.strip()) >= s.ocr_min_chars_per_page
    if good_enough or not allow_vision:
        return result
    try:
        return ocr_vision(png)
    except Exception:
        log.exception("vision OCR failed")
        return result

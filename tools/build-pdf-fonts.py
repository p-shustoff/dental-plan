#!/usr/bin/env python3
"""Пересобирает vendor/pdf-fonts.js — шрифты, которые встраиваются в PDF.

Браузер не даёт странице, открытой с диска, читать соседние файлы через fetch,
поэтому TTF-шрифты для jsPDF лежат в JS-файле в виде base64.

Что делает скрипт:
  1. скачивает TTF из репозитория google/fonts (Golos Text — вариативный, IBM Plex Mono — статические);
  2. делает из Golos Text два начертания: 400 и 600;
  3. урезает все шрифты до латиницы, кириллицы и нужных знаков (₽, №, тире, кавычки);
  4. переименовывает урезанный IBM Plex Mono: в его лицензии зарезервировано имя «Plex»,
     а изменённую версию нельзя распространять под этим именем;
  5. записывает vendor/pdf-fonts.js.

Запуск из корня репозитория:
    pip install fonttools
    python3 tools/build-pdf-fonts.py
"""
import base64
import io
import json
import pathlib
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "pdf-fonts.js"
BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

SOURCES = {
    "golos": BASE + "golostext/GolosText%5Bwght%5D.ttf",
    "plex-medium": BASE + "ibmplexmono/IBMPlexMono-Medium.ttf",
    "plex-semibold": BASE + "ibmplexmono/IBMPlexMono-SemiBold.ttf",
}

# Латиница, кириллица и знаки, которые встречаются в планах лечения.
UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + list(range(0x400, 0x460))
    + [0x2116, 0x2013, 0x2014, 0x2026, 0x2022, 0x20BD, 0x2192,
       0x201C, 0x201D, 0x201E, 0x2018, 0x2019, 0x2009, 0x202F]
)


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url) as r:
        return r.read()


def rename(font: TTFont, family: str) -> None:
    """Меняет имя семейства во всех записях таблицы name."""
    for rec in font["name"].names:
        if rec.nameID in (1, 4, 16, 21):
            rec.string = family
        elif rec.nameID == 6:
            rec.string = family.replace(" ", "")


def shrink(font: TTFont) -> bytes:
    opts = subset.Options()
    opts.layout_features = ["kern", "liga"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.drop_tables += ["GDEF", "GPOS", "GSUB", "meta"]
    cmap = font.getBestCmap()
    s = subset.Subsetter(opts)
    s.populate(unicodes=[u for u in UNICODES if u in cmap])
    s.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def main() -> None:
    raw = {k: fetch(u) for k, u in SOURCES.items()}
    out = {}

    for weight, key in [(400, "ui-normal"), (600, "ui-bold")]:
        f = instancer.instantiateVariableFont(TTFont(io.BytesIO(raw["golos"])), {"wght": weight}, updateFontNames=True)
        out[key] = shrink(f)

    for src, key in [("plex-medium", "num-normal"), ("plex-semibold", "num-bold")]:
        f = TTFont(io.BytesIO(raw[src]))
        rename(f, "Dental Plan Mono")
        out[key] = shrink(f)

    payload = {k: base64.b64encode(v).decode() for k, v in out.items()}
    OUT.write_text(
        "/* Сгенерировано tools/build-pdf-fonts.py, не редактируйте вручную.\n"
        "   Golos Text и урезанный IBM Plex Mono (переименован в Dental Plan Mono), лицензия SIL OFL 1.1, см. LICENSES/. */\n"
        "window.PDF_FONTS = " + json.dumps(payload) + ";\n",
        encoding="utf-8",
    )
    for k, v in out.items():
        print(f"{k}: {len(v) // 1024} КБ")
    print(f"Записано: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

"""Backend validation for Support Request message attachments.

The browser's declared Content-Type is never trusted: the extension must be
on the allow-list AND the file's leading bytes must match that type. The
stored/served content type comes from this table, not from the upload.
"""
import io
import os
import re
import zipfile

from rest_framework.exceptions import ValidationError

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_FILES_PER_MESSAGE = 5

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

# extension -> (content type, kind of signature check)
ALLOWED_TYPES = {
    ".jpg": ("image/jpeg", "jpeg"),
    ".jpeg": ("image/jpeg", "jpeg"),
    ".png": ("image/png", "png"),
    ".webp": ("image/webp", "webp"),
    ".pdf": ("application/pdf", "pdf"),
    ".doc": ("application/msword", "ole"),
    ".docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "ooxml:word/"),
    ".xls": ("application/vnd.ms-excel", "ole"),
    ".xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ooxml:xl/"),
    ".ppt": ("application/vnd.ms-powerpoint", "ole"),
    ".pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", "ooxml:ppt/"),
    ".csv": ("text/csv", "text"),
    ".txt": ("text/plain", "text"),
}

ALLOWED_EXTENSIONS_LABEL = "JPG, PNG, WebP, PDF, Word, Excel, PowerPoint, CSV, TXT"


def _read_head(f, n=8192):
    f.seek(0)
    head = f.read(n)
    f.seek(0)
    return head


def signature_ok(kind, f):
    head = _read_head(f)
    if kind == "jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if kind == "png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if kind == "webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if kind == "pdf":
        return b"%PDF-" in head[:1024]
    if kind == "ole":
        return head.startswith(OLE_MAGIC)
    if kind.startswith("ooxml:"):
        prefix = kind.split(":", 1)[1]
        if not head.startswith(b"PK\x03\x04"):
            return False
        try:
            f.seek(0)
            with zipfile.ZipFile(io.BytesIO(f.read())) as zf:
                names = zf.namelist()
            f.seek(0)
        except (zipfile.BadZipFile, OSError):
            return False
        return "[Content_Types].xml" in names and any(n.startswith(prefix) for n in names)
    if kind == "text":
        return b"\x00" not in head
    return False


def clean_filename(name):
    name = os.path.basename((name or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return (name or "attachment")[:150]


def validate_attachments(files):
    """Returns [(file, clean_name, content_type)] or raises ValidationError."""
    if len(files) > MAX_FILES_PER_MESSAGE:
        raise ValidationError({"attachments": f"You can attach at most {MAX_FILES_PER_MESSAGE} files per message."})
    result = []
    for f in files:
        name = clean_filename(f.name)
        ext = os.path.splitext(name)[1].lower()
        if ext not in ALLOWED_TYPES:
            raise ValidationError({"attachments": f"'{name}': file type not allowed. Allowed: {ALLOWED_EXTENSIONS_LABEL}."})
        if f.size == 0:
            raise ValidationError({"attachments": f"'{name}' is empty."})
        if f.size > MAX_FILE_SIZE:
            raise ValidationError({"attachments": f"'{name}' is larger than the 10 MB limit."})
        content_type, kind = ALLOWED_TYPES[ext]
        if not signature_ok(kind, f):
            raise ValidationError({"attachments": f"'{name}' doesn't look like a valid {ext} file."})
        result.append((f, name, content_type))
    return result

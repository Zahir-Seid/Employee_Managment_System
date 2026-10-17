import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from PIL import Image


def attach_photos(client, report_id, count=4):
    """Upload `count` real PNG photos to a report through the API."""
    for i in range(count):
        buffer = io.BytesIO()
        Image.new("RGB", (80, 60), (i * 40, 10, 10)).save(buffer, format="PNG")
        photo = SimpleUploadedFile(f"photo{i}.png", buffer.getvalue(), content_type="image/png")
        response = client.post(reverse("reports:report-photo-upload", args=[report_id]), {"image": photo}, format="multipart")
        assert response.status_code == 201, response.data

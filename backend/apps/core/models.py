import uuid

from django.db import models


class TimeStampedModel(models.Model):
    """Abstract base model providing UUID primary keys and audit timestamps.

    Every domain entity in EMS extends this so that:
    - Primary keys are UUIDs (safer to expose in URLs/APIs than sequential ints).
    - created_at / updated_at are automatically tracked, which the audit
      trail (FR49) and reporting (FR35, FR40) both rely on.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["-created_at"]

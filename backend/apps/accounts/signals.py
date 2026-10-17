from django.db.models.signals import pre_save
from django.dispatch import receiver

from .models import User


@receiver(pre_save, sender=User)
def default_username_to_email(sender, instance, **kwargs):
    """Since login is by email (FR1), the underlying `username` field is
    kept in sync automatically so admins never need to manage it separately.
    """
    if not instance.username:
        instance.username = instance.email

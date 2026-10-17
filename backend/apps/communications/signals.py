from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import SupportRequest, SupportType, TodoItem


@receiver(post_save, sender=SupportRequest)
def generate_todo_items(sender, instance, created, **kwargs):
    """FR21: automatically generate a to-do list for each Communications
    Support Request, containing only the specific items selected in that
    request. One TodoItem per selected support type (support_types is
    multi-select again, reverted from a brief single-dropdown stint). Each
    item's label folds in that type's optional description from
    support_details, if one was given. Runs once, at creation time only —
    support requests aren't edited after submission (FR20: Communications
    arranges support outside the system).
    """
    # `raw` is True while a fixture/dump is being loaded (e.g. the one-off
    # copy from SQLite into PostgreSQL): the to-do items are already part of
    # that data, so generating them again would create duplicates.
    if kwargs.get("raw") or not created:
        return

    details = instance.support_details or {}
    items = []
    for support_type in instance.support_types:
        base_label = SupportType(support_type).label
        description = (details.get(support_type) or "").strip()
        label = f"{base_label}: {description}" if description else base_label
        items.append(TodoItem(support_request=instance, support_type=support_type, label=label))

    TodoItem.objects.bulk_create(items)

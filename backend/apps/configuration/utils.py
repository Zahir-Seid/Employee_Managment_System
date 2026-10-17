from .models import ConfigOption


def get_config_labels(list_type, active_only=False):
    """Returns a {value: label} dict for a given ConfigListType — used
    wherever code previously built a label lookup from a fixed
    `dict(SomeEnum.choices)` (e.g. Support Type in the PDF/Excel/Word
    report generators), so admin-added options show their real label
    instead of falling back to the raw stored value.
    """
    qs = ConfigOption.objects.all()
    if active_only:
        qs = qs.filter(is_active=True)
    return dict(qs.filter(list_type=list_type).values_list("value", "label"))

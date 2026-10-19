"""Test-time throttle overrides.

Gotcha (which bit finding #9's tests): DRF's `SimpleRateThrottle.THROTTLE_RATES`
is a CLASS-LEVEL snapshot of `api_settings.DEFAULT_THROTTLE_RATES` taken
at class-creation (import) time. `override_settings(REST_FRAMEWORK=...)`
does reload `api_settings`, but builds a fresh dict, so the throttle
classes keep reading the stale snapshot — scoped rates like `auth` or
`login_user` changed via override_settings simply never reach the
throttles.

These helpers patch the class-level snapshot itself: every
SimpleRateThrottle subclass picks the new dict up on its next
instantiation — i.e. on the next request.

Usage inside a TestCase:

    def setUp(self):
        self.enterContext(patch_throttle_rates(auth="1000/min", login_user="3/min"))
"""
from unittest.mock import patch

from rest_framework.settings import api_settings


def patch_throttle_rates(**rates):
    """Patches the rates snapshot DRF throttles actually read from, for
    the named scopes. Returns a context-managed patch object."""
    effective = dict(api_settings.DEFAULT_THROTTLE_RATES)
    effective.update(rates)
    return patch("rest_framework.throttling.SimpleRateThrottle.THROTTLE_RATES", effective)

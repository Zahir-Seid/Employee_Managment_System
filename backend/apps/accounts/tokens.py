"""JWT refresh-token lifecycle helpers.

The `token_blacklist` app is installed, which makes every RefreshToken be
CHECKED against the blacklist on every refresh — but, without token
rotation, nothing was ever WRITING to it. A stolen refresh token therefore
kept working for its entire REFRESH_TOKEN_LIFETIME (7 days) even after the
account's password changed (security review finding #1).

Every password-mutating flow (self-service Change Password, Admin
Set Password, email-OTP Password Reset) calls
`blacklist_outstanding_refresh_tokens` after saving the new password, so
credential rotation immediately revokes every outstanding refresh token —
including one that was stolen before the change.
"""
from django.db import transaction

from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken


def blacklist_outstanding_refresh_tokens(user):
    """Blacklists every refresh token ever issued for `user`, so none can
    be refreshed again.

    Deliberate trade-off: this revokes the caller's own current session
    device too. There is no reliable way to distinguish "the compromised
    session" from "my other laptop", and credential rotation is exactly
    the moment you choose to be conservative. The current device keeps its
    access token until it expires (access lifetimes are short by design)
    and then lands on the normal Login screen.
    """
    with transaction.atomic():
        for outstanding in OutstandingToken.objects.filter(user=user).iterator():
            BlacklistedToken.objects.get_or_create(token=outstanding)

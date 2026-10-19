"""Security review finding #9: the shared "auth" rate (60/min, IP-keyed)
protects the login endpoint from one IP flooding it, but does nothing to
stop a slow distributed attack or one IP cycling usernames. This throttle
mates the per-username attempt rate to the attempted account itself, so
an attacker guessing many passwords for one mailbox hits the same bucket
no matter where the requests come from.

The key is the *attempted* email from the request body (lowest-cased),
not `request.user` — at login time there is no authenticated user.
Malformed requests without a usable email key to nothing here; the
"auth" IP scope still covers them.
"""
from rest_framework.throttling import SimpleRateThrottle


class AttemptedUsernameThrottle(SimpleRateThrottle):
    scope = "login_user"

    def get_cache_key(self, request, view):
        email = request.data.get(view.username_field, "") if isinstance(request.data, dict) else ""
        email = str(email or "").strip().lower()
        if not email:
            return None
        return self.cache_format % {"ident": email, "scope": self.scope}

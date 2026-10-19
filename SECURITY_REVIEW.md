# Backend Security Review — OWASP Top 10 (authn / authz / IDOR focus)

**Scope:** `backend/` (Django + DRF + SimpleJWT). Method: full read of every app's views/serializers/permissions, focused analysis of the trust boundaries, then **live exploitation attempts** against the running Docker stack (`:8090`) with three throwaway users (`sec_a` Staff/owner, `sec_b` Staff, `sec_c` Communications — created via the admin staff API for the PoCs).

**Key surfaces:** events (owner-scoped), support requests + messages + attachments (assignment-scoped), post-event reports (owner-only), reports module (role-gated), audit logs, notifications, configuration/System Settings, content (Home/TV), accounts (login, OTP registration/reset, staff management), JWT lifecycle, file uploads.

Legend: 🔴 High · 🟠 Medium · 🟡 Low · ⚪ Info/Hardening. Every attack result below was reproduced live unless marked *static*.

**Status 2026-10-19 (updated):** findings **#1, #2, #3, #4, #5, #6, #9 are FIXED** (refresh-token blacklisting; embed gating; anonymous content filter — plus the follow-up fixes: photo magic-byte check `apps/reports/validators.py`, `POST /auth/logout/` in `apps/accounts/views.py` + `ActionType.LOGOUT`, per-mailbox login throttle `apps/accounts/throttling.py`, and export filename sanitation in `apps/reports/views_generation.py`). Regression tests: `test_refresh_token_blacklisting.py`, `test_event_detail_embeds.py`, `test_content.py`, `test_logout.py`, `test_login_throttle.py`, `FilenameSanitationTests` in `test_reports.py`. #3's fix: `NUM_PROXIES`/`TRUSTED_PROXY_COUNT` (default 1 = the shipped nginx hops, spoofed XFF prefixes ignored — `test_throttle_ident.py`) plus a `CACHE_BACKEND=filebased` option so gunicorn's 3 workers share throttle counters (compose sets it; multi-replica deployments swap in Redis). #7 (docs-block nginx snippet pending owner approval), #8, and #10 are documented follow-ups.

---

## Executive summary

The codebase has an unusually disciplined authorization model — nearly every endpoint layers a permission class on top of object-level ownership/assignment checks, uploads are signature-validated, and audit logging is pervasive. Three real gaps were confirmed, all in "second doors" the dedicated endpoints don't share: **one hard one (stolen refresh tokens survive a password change)**, one ACL-bypass-by-embedding, and one draft-content leak. In addition, the brute-force rate limiter collapses into a single shared bucket behind the nginx proxy — availability bug at best, misleading protection at worst.

| # | Severity | OWASP | Finding |
|---|----------|-------|---------|
| 1 | 🔴 High **[FIXED]** | A07 | Stolen refresh tokens survive password change/reset (7-day window) |
| 2 | 🟠 Medium **[FIXED]** | A01 | Event-detail endpoint embeds other users' support requests + reports (bypasses 403/404) |
| 3 | 🟠 Medium **[FIXED]** | A04/A05 | Rate-limit buckets collapse to one global ident behind the reverse proxy |
| 4 | 🟠 Medium **[FIXED]** | A01 | Anonymous list endpoint leaks unpublished/future-scheduled content |
| 5 | 🟡 Low **[FIXED]** | A08 | Event-photo validation is extension-only (no magic bytes) |
| 6 | 🟡 Low **[FIXED]** | A07 | No logout/revoke endpoint; tokens stored in `localStorage` |
| 7 | 🟡 Low | A05 | API docs (`/api/docs/`, `/api/schema/`, `/api/redoc/`) publicly reachable |
| 8 | 🟡 Low | A05 | `DEBUG` defaults to `True` when unset |
| 9 | 🟡 Low **[PARTIALLY FIXED]** | A07 | No per-user lockout on repeated failed logins; min password length 8 |
| 10 | ⚪ Info | A01 | Design-consistency notes (event history read-all, staff directory, docs of matrix) |

---

## Confirmed findings

### 1. 🔴 Stolen refresh tokens survive a password change (A07: Identification & Authentication Failures)

**Evidence (live):** Created user, captured refresh token, `POST /auth/change-password/ {current_password, new_password}` → 200. Then `POST /auth/refresh/` with the **old** refresh token → **200, new access token issued.** The attacker keeps the account for the full refresh lifetime (**7 days**, `SIMPLE_JWT['REFRESH_TOKEN_LIFETIME']`) even after the legitimate user rotates the credential. The same applies after an Admin password reset (`SetPasswordView`) and after the email-OTP reset flow (`PasswordResetCompleteSerializer`) — none of them touch the token store.

**Root cause (static):**
- `config/settings.py` → `SIMPLE_JWT`: `ROTATE_REFRESH_TOKENS: False`, `BLACKLIST_AFTER_ROTATION: False`. The `token_blacklist` app *is* installed, so refresh tokens **are** blacklist-checked on every refresh — but nothing ever writes to the blacklist.
- `backend/apps/accounts/views.py:63` — the `RefreshView` docstring claims "rotation + blacklisting configured in settings.SIMPLE_JWT keeps stolen refresh tokens from being reused." This is **false** on both counts; the comment will mislead the next person auditing this.
- `ChangePasswordSerializer.save`, `SetPasswordSerializer.save`, `PasswordResetCompleteSerializer.save` — none invalidate outstanding tokens.

**Remediation (pick one, first is the standard approach):**
1. In every password-mutating path, blacklist the user's outstanding refresh tokens:
   ```python
   from rest_framework_simplejwt.tokens import RefreshToken
   def blacklist_user_tokens(user):
       for token in OutstandingToken.objects.filter(user=user):
           BlacklistedToken.objects.get_or_create(token=token)
   ```
   Apply in the three serializers above (for change-password, blacklist *all but* the current pair; for admin/OTP reset, all).
2. Or set `ROTATE_REFRESH_TOKENS = True` + `BLACKLIST_AFTER_ROTATION = True` so every refresh rotates and revokes (solves logout too). Watch client compatibility (the frontend stores one refresh token — rotation is transparent to it).
3. Fix the `RefreshView` docstring to describe reality.
- Bonus: this makes a `POST /auth/logout/` (blacklist presented refresh) trivial to add — currently users have no way to sign out a session at all.

**Priority rationale:** high severity because credential rotation is the standard containment response to a leaked token — the advice any operator would follow after a suspected compromise — yet it does nothing today.

**Resolved (2026-10-19):** option 1 implemented — `apps/accounts/tokens.py` (`blacklist_outstanding_refresh_tokens`, all outstanding tokens, transaction-wrapped) is called after `set_password` in all three serializers; `RefreshView`'s docstring now states the real mechanism. Regression tests: `test_refresh_token_blacklisting.py` (change-password / admin set-password / OTP reset each replay the pre-change refresh and expect rejection, plus fresh-login positive checks). Live: old refresh → **401**.

---

### 2. 🟠 `GET /api/events/{id}/` embeds other users' support requests and reports (A01: Broken Access Control — IDOR via nested serialization)

**Evidence (live):** `sec_a` (Staff) created an event + support request with `notes = "SECRET-NOTES-9f8e7"` and a draft post-event report.
- `sec_b` (Staff, not the owner): `GET /support-requests/{sr}/` → **404** ✅; `GET /events/{event}/post-event-report/` → **403** ✅ — the dedicated endpoints correctly refuse.
- `sec_b`: `GET /events/{event}/` → **200** with `support_request.notes == "SECRET-NOTES-9f8e7"` (full object: todo items, assignee list, status) **and** `post_event_report` embedded.
- `sec_c` (plain Communications, **not assigned**): `GET /support-requests/{sr}/` → **404** ✅, but `GET /events/{event}/` → **200** with the same support request embedded.

**Root cause (static):** `backend/apps/events/serializers.py` — `EventDetailSerializer` (lines ~100–112) nests `SupportRequestSerializer(obj.support_request)` and `PostEventReportSerializer(obj.post_event_report)` unconditionally, and the view's `EventPermission` allows any authenticated user to read any event (`has_object_permission` is a no-op on safe methods; retrieve is globally readable *by design* — "any event can be opened read-only"). The per-object rules the dedicated endpoints enforce (owner-only reports, assigned-only support requests, staff-owned-only message threads) are simply not re-applied where the same data is embedded.

**Impact:** Any authenticated user can read the internal free-text notes, per-item worklists, assignment details, and (draft) post-event narratives/attendance numbers of events they do not own. Internal tooling softens the impact, but it directly contradicts the rules the API enforces everywhere else (and breaks comms-team assignment confidentiality).

**Remediation:** gate the nested fields using the *same* predicates as the dedicated endpoints, e.g.:

```python
def get_support_request(self, obj):
    u = self.context["request"].user
    if not obj.has_support_request or not u.is_authenticated:
        return None
    if u.is_staff_only:                     # plain staff: own events only
        if obj.owner_id != u.id:
            return None
    elif not u.is_communications and not u.is_admin_role and not u.is_superuser:
        return None
    elif not u.is_communications_lead:      # plain comms: assigned only
        if not obj.support_request.assigned_to.filter(pk=u.pk).exists():
            return None
    ...
```

(Same shape as `_visible_requests` in `apps/communications/views.py`.) Mirror-gate `get_post_event_report` (owner, comms, leadership/admin — matching `PostEventReportCreateView.get`). Add regression tests: staff-B / unassigned-comms-C each assert `support_request is None` and `post_event_report is None` in the event-detail payload.

**Related, same umbrella:** `EventHistoryView` (audit trail of any event) is readable by any authenticated user — reasonable *while* all event content is readable, but tighten or document together with this fix.

**Resolved (2026-10-19):** the support-request embed reuses the endpoint's own `_visible_requests` predicate (no second copy to drift); the post-event-report embed and the dedicated GET now share one predicate, `_may_view_report` in `apps/reports/views.py`. Writing that predicate surfaced a bonus bug it already had: the dedicated GET's `is_staff_role` check also matched **Admin**, so an Admin reading someone else's report was refused even though comms/leadership tests assert "any report" — Admin is now explicitly allowed (matching `AdminEventDetailView`'s edit-any-event precedent). Regression tests: `test_event_detail_embeds.py` (6 cases incl. no-context fail-closed). Live re-verified for other-staff, unassigned comms, owner, leadership, admin-role, and the bootstrap superuser.

---

### 3. 🟠 Rate-limit buckets collapse into one global ident behind the reverse proxy (A04/A05)

**Evidence (live, through nginx):** 110 rapid `POST /api/auth/refresh/` → 82×400 + **28×429**; 100 rapid anonymous `GET /api/home/feed/` → 54×200 + **46×429**. All requests from all "clients" share the nginx container's IP, so:

- DRF's throttles (`get_ident()` = `REMOTE_ADDR`) count **every user of the system** as a single client. One abusive anonymous visitor (or one broken cron) exhausts the 20/hour anon bucket for *everyone* — the public Home feed, docs, and anonymous surfaces go 429 for the whole site until the window rolls over. The `auth` 60/min bucket shared by all staff means a busy morning of legitimate logins can lock everyone out of authentication endpoints.
- Conversely the limits are ×N inflated by the **per-process `LocMemCache`** (one bucket per gunicorn worker bucket ≈ 3×20/h anon, measured), and every counter resets when a worker restarts — protections are weaker and stronger than they look depending on which worker answers.

**Root cause:** `config/settings.py` REST_FRAMEWORK throttle settings (anon 20/h, user 1000/h, scopes `auth` 60/min, `otp_request` 5/h, `otp_verify` 20/h) + default cache backend (`LocMemCache`, per-process) + DRF ignoring `X-Forwarded-For` (correct — unless it's told the hop is trusted).

**Remediation (deploy-side + code):**
1. Trust exactly the nginx hop: run behind `uvicorn`/gunicorn bound to the container network and set `USE_X_FORWARDED_PORT`/`SECURE_PROXY_SSL_HEADER` appropriately; for throttling, add a custom `get_ident`-based throttle class that takes the left-most self-declared XFF item **only** when `REMOTE_ADDR` matches the known proxy subnet (or nginx injects `X-Real-IP`/`X-Forwarded-For` and the override uses it, rejecting spoofed chains from outside). Do **not** set `X-Forwarded-For`-trusting globally without validating the proxy hop, or clients can spoof unlimited idents.
2. Move throttle counters to a shared cache (`CACHES["default"] = locmem... → Redis` or a dedicated `CACHES["throttling"]` backend; DRF has no built-in Redis throttle but `django-redis` + `DRF-track/redis-throttle` style classes work) and set the same value for the rate-limit cache in Docker Compose (e.g., add a `redis` service or mount a `memcached`; simplest first step: keep LocMem but document that limits are per-worker and raise/lower accordingly).
3. Optional: `django-axes`-style per-user+IP lockout for `/auth/login/` (see finding 9).

**Resolved (2026-10-19):** DRF's built-in proxy support does the job — `NUM_PROXIES` is now set from `TRUSTED_PROXY_COUNT` (default 1, matching both shipped nginx configs), so the identity is the **last** `X-Forwarded-For` hop: the address our proxy appended. Client-supplied prefixes are ignored, closing the spoofing angle, and requests key on the real client address instead of collapsing onto the nginx container. For the per-worker half, a `CACHE_BACKEND=filebased` option (compose default, shared directory in the container) gives gunicorn's 3 workers one set of counters without adding a service; multi-replica deployments extend the settings block with Redis. Compose, both env templates, and the deployment guide document the two knobs. Regression tests: `test_throttle_ident.py` (last-hop wins over spoofed prefixes; 3 forged prefixes share one spent bucket → 429; `REMOTE_ADDR` fallback).

---

### 4. 🟠 Anonymous endpoint lists unpublished/future-scheduled content (A01)

**Evidence (live):** `sec_c` (Communications) created `title = "DRAFT-ONLY …"`, `publish_date = 2027-12-31`, not yet showable.
- Public feed `GET /api/home/feed/` → draft correctly **absent** ✅
- `GET /api/home/content/` **without any token** → draft **present** in the list ❌

**Root cause (static):** `backend/apps/content/views.py` `HomeContentListCreateView.get_permissions()` returns `AllowAny` for GET "because nothing here is confidential (it's the same news/announcements the public Home page shows)". True only for *currently showable* items; the list returns **every** row (drafts, expired, future-scheduled), i.e. content the public feed deliberately filters out via `is_currently_showable`. Also exposes internal author names (`created_by_name`) anonymously.

**Remediation:** For unauthenticated GET, filter to `is_currently_showable` items (return only published, in-window content — same contract as the feed, one code path); keep the full unfiltered list for authenticated Communications/Admin (it feeds the Manage Content page). If the management UI needs the full list unauthenticated for some reason, at minimum move it behind `IsAuthenticated`. Cheap and safe: gate GET on `IsAuthenticated` and rely on the feed for public reads — the public Home page already uses `/home/feed/`.

**Resolved (2026-10-19):** `HomeContentListCreateView.get_queryset` now returns showable items only for anonymous callers (Python-level `is_currently_showable`, as the feed does) and the full list for authenticated users; the Manage Content page consumer is always authenticated so nothing changes for it. Regression test in `test_content.py` (anon list hides unpublished draft + deactivated row; authenticated admin still sees both). Live re-verified.

---

### 5. 🟡 Event-status-report photos: extension-only validation (A08)

**Static:** `backend/apps/reports/validators.py:validate_photo_file` checks the extension (`ALLOWED_PHOTO_EXTENSIONS`) and size cap only — no signature/magic-byte check. Compare with the *attachment* pipeline (`backend/apps/communications/attachments.py`), which is exemplary: extension allow-list **plus** magic-byte signature, size caps, stored content type derived from the allow-list table, filename basename/control-character stripping.

Risk is contained (photos served as `image/jpeg`/`image/png` with `X-Content-Type-Options: nosniff` on the public nginx; SVG/HTML not in the list), but a polyglot file renamed `.png` is accepted today.

**Remediation:** reuse the signature logic from `attachments.py` (or a tiny `imghdr`-era check) inside `validate_photo_file`; the shared code already exists — this is a 10-line change plus tests.

**Resolved (2026-10-19):** `validate_photo_file` now also checks the leading bytes, sharing the attachment pipeline's signature logic (made public as `attachments.signature_ok`). One nuance worth recording: Pillow's own decode check in `ImageField` rejects undecodable junk anyway, but it sniffs bytes regardless of extension — so a *genuine* JPEG named `.png` used to pass both checks and be stored/served as `image/png`. The signature step is what closes that extension/bytes mismatch. Regression tests in `test_reports.py`: JPEG-bytes-named-PNG and PNG-bytes-named-JPG rejected with a clear message; matched pairs still accepted.

---

### 6. 🟡 No logout / no revocable sessions; tokens in `localStorage` (A07)

Logging out on the frontend only drops the token client-side; a stolen refresh/access remains server-valid (see #1). Both tokens live in `localStorage` (XSS-exfiltratable; React escapes by default which mitigates, but any injected dependency is a one-line token thief).

**Remediation:** Pairs with #1 — add `POST /auth/logout/` (blacklist presented refresh; clients also clear storage), enable rotation+blacklist, and consider shortening refresh lifetime (7 days is long for an internal tool; 24h–72h with rotation is typical). For defense-in-depth, moving refresh into an HttpOnly, SameSite=Lax cookie is the stronger pattern; if done, pair with explicit CORS exact-origin config.

**Resolved (2026-10-19):** `POST /auth/logout/` now blacklists the presented refresh token — no access token required (possession of the refresh is the proof, and the access token may already have expired), malformed/missing tokens still return a calm 200, and the sign-out is audited (`ActionType.LOGOUT`, added for this). Rotation+blacklist remains off by product choice; password changes (#1) and explicit sign-out both revoke server-side now. Regression tests: `test_logout.py`. Keeping both tokens in `localStorage` is an accepted design trade-off for this internal tool.

---

### 7. 🟡 API docs/schema/redoc publicly reachable (A05)

Verified earlier and again now: `GET /api/docs/`, `/api/schema/`, `/api/redoc/` → 200 anonymous. The schema enumerates every endpoint — an attacker's map. Recommended fix: the optional nginx block `location ~ ^/api/(docs|schema|redoc) { return 404; }` placed **before** the `/api` location, followed by a frontend image rebuild. Recommend applying it in production.

---

### 8. 🟡 `DEBUG` defaults to `True` (A05)

`config/settings.py:14` — debug-on by default when the env var is absent. The Docker deployment fails fast on missing production values (`DEBUG=False` required), but a bare-metal `manage.py runserver` deployment that forgets `DEBUG` gets verbose error pages (stack traces, settings leak) and the dev `SECRET_KEY` default. Suggest inverting the default (`DEBUG=False`) with a documented `.env.development` for local dev — fail-secure defaults.

---

### 9. 🟡 No per-account lockout; threshold-only brute force (A07)

`auth` scoped throttle: 60/min shared ident (making it effectively *global* behind the proxy — see #3). There is no account-level lockout/notification on consecutive failures. Password policy: min length 8 + common/numeric/similarity validators — acceptable for internal use but weak for an org-wide identity store.

**Remediation:** `django-axes` (4-5 failed attempts → lockout or exponential backoff, per user+IP, DB-backed so it survives restarts); raise `PASSWORD_MIN_LENGTH` to 12 for new accounts. The OTP machinery already shows this pattern (5 attempts/10-min/60-s cooldown) — good mirror to copy the UX from.

**Partially resolved (2026-10-19):** the brute-force half is addressed — `LoginView` now also applies `AttemptedUsernameThrottle` (`apps/accounts/throttling.py`), a second bucket keyed on the **attempted email** (10/min) on top of the per-IP `auth` scope, so guessing passwords for one mailbox exhausts one shared limit no matter how many IPs the guesses come from (`test_login_throttle.py`). Still open as hardening: the `django-axes`-style lockout/notification with escalating backoff, and the 12-character minimum policy.

---

### 10. ⚪ Design/hardening notes

- **✅ What's done right (verified):** registration OTP — 6-digit `secrets.randbelow`, SHA-256 hash stored, 5-attempt cap, 10-min expiry, 60-s resend cooldown, per-email binding, generic anti-enumeration responses on reset; attachment upload pipeline (see #5 — model to copy); `SetPassword`/staff management Admin-only (staff `POST /auth/staff/` → 403 live-verified); audit logs Comms/Leadership (staff 403 live-verified); system settings PATCH Admin-only (403 live-verified; anon 401); notifications fully recipient-scoped; saved reports private to creator with re-check at report endpoints; configuration writes admin-gated; TV/content writes Comms/Admin; event `owner` is server-assigned (payload `owner` ignored, live-verified); profile role/`is_superuser` write attempts ignored (403-no-op live-verified); private media served through authorized view only (public `/private_media/...` 404 live-verified); event-message attachments downloaded only by conversation participants (404-style scoping); `_assert_not_last_admin` prevents self-locked-out orgs.
- **Pattern drift:** `IsAdminOrLeadership` name promises leadership inclusion; the method only allows admin/superuser. Harmless today but the name will lie to the next contributor — rename (`IsAdminRole`) to match reality.
- **Filename from user input:** ✅ **Resolved 2026-10-19** — event-title-derived download names are now routed through the attachment pipeline's `clean_filename` at the generator boundary (`apps/reports/views_generation.py`, `_safe_report_filename`), with regression tests covering poisoned and normal titles (`FilenameSanitationTests`). Tokens still live in `localStorage` (accepted design: no HttpOnly-cookie migration planned while the SPA and API share no cookie domain).
- **Registration email enumeration:** `POST /auth/register/request-otp/` reveals "account already exists" for existing emails (a (minor) oracle distinct from the reset flow's generics). Low value given the closed user base; consider generic response.
- **Staff directory** (`/auth/staff-directory/`) exposes all active staff emails to every authenticated user — fine for internal org tooling; revisit if roles ever expand.
- **JWT signing = `SECRET_KEY`**: keeping `DJANGO_SECRET_KEY` rotation-safe in `.env` management matters, since it signs both sessions and tokens (no separate JWT key). Worth documenting for whoever rotates it.
- **Leftover `host.docker.internal`** in `docker-compose.yml` — cosmetic.

---

## OWASP Top 10 coverage (backend)

| Category | Assessment |
|---|---|
| A01 Broken Access Control | **Good overall**; the 2 gaps found (finding 2 embed bypass; finding 4 draft leak) are both fixed. Object-level checks consistently implemented elsewhere. |
| A02 Cryptographic Failures | Passwords: Argon2/PBKDF2 via Django defaults; OTP hashed at rest; HTTPS mandatory in prod settings (`SESSION_COOKIE_SECURE`, HSTS ready). `SECRET_KEY` doubles as JWT key — rotation discipline needed. |
| A03 Injection | ORM-only queries; `django-filter`/DRF serializers; no raw SQL/`extra()`/`eval`/`exec`/shell. SQL injection: none found. Template/HTML: DRF JSON responses. |
| A04 Insecure Design | Role/permission model is explicit and documented; the IDOR-by-embed and throttle-collapse gaps (findings 2/3) were design-level but are fixed. |
| A05 Security Misconfiguration | DEBUG default-on (8), docs exposure (7), throttle cache (3, fixed 2026-10-19), `CORS_ALLOW_CREDENTIALS` with explicit allowlist (fine — keep exact-match origins), prod fail-fast on missing secrets (good). |
| A06 Vulnerable Components | Not audited here (pip package versions) — recommend `pip-audit` in CI; the 89-migration codebase is current otherwise. |
| A07 Identification & Authentication Failures | The 1 real finding (refresh survival, #1) is fixed; lockout gap (9) partially addressed via the per-mailbox throttle. Login/OTP anti-enumeration, hashed OTP, throttled OTP — well done. |
| A08 Software & Data Integrity Failures | Uploads allow-listed with magic bytes for attachments and — since 2026-10-19 — for report photos (5). No deserialization, no object storage trust issues. |
| A09 Logging & Monitoring Failures | Pervasive `log_action` audit trail incl. logins/logouts/changes/deletes; audit view role-gated. Suggest: log failed-login streaks (feeds #9). |
| A10 SSRF | No server-side URL fetches. Not applicable. |

---

## Testing notes (live verification)

Live verification ran against the Docker test stack (frontend on `:8090`) with three throwaway accounts — `sec_a` (Staff, event owner), `sec_b` (Staff), `sec_c` (Communications) — created through the staff admin API, plus one draft event, one support request, one draft post-event report and one draft content item. Every attack in the findings above was executed against the running API, and then re-run after the fixes landed (with a fresh set of test accounts) to confirm the new behavior end to end: old refresh token → 401, embeds hidden for other-staff/unassigned comms while owner/leadership/admin keep them, drafts invisible to anonymous readers, spoofed `X-Forwarded-For` prefixes sharing one throttle bucket.

These accounts and rows exist only in the disposable Docker test database — remove them when convenient, or wipe that stack with `docker compose down -v`. Throttle-probe counters roll over with their windows.

One nuance surfaced during live re-verification, worth recording: the Docker bootstrap superuser (`admin@example.com`) carries `roles=["staff"]` + `is_superuser=True`. Support-request visibility is strictly role-driven (`_visible_requests` gives Staff scope-only-own-events), so that account sees support requests like its *roles* say — while permission classes like `IsAdminOrLeadership` and the new `_may_view_report` honor `is_superuser` unconditionally. Two pass keys in one app: not currently exploitable (it grants *more* to superuser, never *less*), but unify if a superuser account with narrow roles is ever a real operator.

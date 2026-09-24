"""Bounded, read-only facade over an inspected upstream artifact.

Only user-run CLI may construct this against a real account. A low-level send
interceptor counts redirects, pagination and retries, never logs response bodies,
and stops challenges instead of using alternate transport strategies.
"""

import contextlib
import importlib.metadata
import logging
import re
import time
from urllib.parse import urlparse
import requests
import garminconnect.client as upstream
from garminconnect import Garmin


class AccessStopped(BaseException):
    """Bypass upstream Exception fallbacks on access challenges/budget exhaustion."""


class Budget:
    def __init__(self, limit=100, seconds=900, interval=1.0):
        self.limit = limit
        self.seconds = seconds
        self.interval = interval
        self.count = 0
        self.started = time.monotonic()
        self.last = 0
        self.refresh_observed = False

    def tick(self):
        if self.count >= self.limit or time.monotonic() - self.started >= self.seconds:
            raise AccessStopped("partial_resumable")
        wait = self.interval - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.count += 1
        self.last = time.monotonic()


API_PATHS = [
    r"/userprofile-service/socialProfile",
    r"/userprofile-service/userprofile/user-settings",
    r"/activitylist-service/activities/search/activities",
    r"/activity-service/activity/[0-9]+(?:/details)?",
    r"/wellness-service/wellness/dailySleepData/[^/]+",
    r"/userstats-service/wellness/daily/[^/]+",
    r"/hrv-service/hrv/\d{4}-\d{2}-\d{2}",
]


def allowed_request(method, url):
    u = urlparse(url)
    if u.scheme != "https" or u.username or u.password:
        return False
    if u.hostname == "connectapi.garmin.com":
        return method == "GET" and any(re.fullmatch(p, u.path) for p in API_PATHS)
    if u.hostname == "sso.garmin.com":
        return method == "POST" and u.path in [
            "/mobile/api/login",
            "/mobile/api/mfa/verifyCode",
            "/mobile/api/mfa/verify",
            "/mobile/api/mfa/sendCode",
        ]
    if u.hostname == "diauth.garmin.com":
        return method == "POST" and u.path == "/di-oauth2-service/oauth/token"
    if u.hostname == "services.garmin.com":
        return (
            method == "POST" and u.path == "/auth/oauth-service/oauth/exchange/user/2.0"
        )
    return False


@contextlib.contextmanager
def guarded_transport(budget):
    original = requests.Session.send
    had_cffi = upstream.HAS_CFFI

    def send(session, request, **kwargs):
        if not allowed_request(request.method, request.url):
            raise AccessStopped("unreviewed_endpoint_blocked")
        if kwargs.get("verify", True) is not True:
            raise AccessStopped("tls_verification_required")
        budget.tick()
        kwargs["timeout"] = min(kwargs.get("timeout") or 30, 30)
        response = original(session, request, **kwargs)
        if response.status_code in [401, 403, 429]:
            code = {
                401: "reauth_required",
                403: "access_challenge",
                429: "rate_limited",
            }[response.status_code]
            raise AccessStopped(code)
        if "text/html" in response.headers.get("Content-Type", "").lower():
            raise AccessStopped("access_challenge")
        if (
            "/oauth/token" in request.url
            and request.body
            and "refresh_token" in str(request.body)
            and response.ok
        ):
            budget.refresh_observed = True
        return response

    requests.Session.send = send
    upstream.HAS_CFFI = False
    try:
        yield
    finally:
        requests.Session.send = original
        upstream.HAS_CFFI = had_cffi


class Reader:
    def __init__(self):
        if importlib.metadata.version("garminconnect") != "0.3.15":
            raise RuntimeError("dependency_version_mismatch")
        logging.disable(logging.CRITICAL)
        self._g = None

    def login(self, path, email=None, password=None, prompt=None):
        g = Garmin(email=email, password=password, prompt_mfa=prompt, retry_attempts=0)
        g.client.skip_strategies = {
            "mobile+cffi",
            "widget+cffi",
            "portal+cffi",
            "portal+requests",
        }
        g.login(str(path))
        if not g.client.di_token:
            raise AccessStopped("unsupported_auth_type")
        self._g = g

    def inventory(self, start, end):
        return self._g.get_activities_by_date(start, end)

    def activity(self, activity_id):
        return self._g.get_activity(str(activity_id))

    def series(self, activity_id):
        return self._g.get_activity_details(str(activity_id), maxchart=2000, maxpoly=0)

    def sleep(self, day):
        return self._g.get_sleep_data(day)

    def hrv(self, day):
        return self._g.get_hrv_data(day)

    def rhr(self, day):
        return self._g.get_rhr_day(day)

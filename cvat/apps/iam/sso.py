# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

"""
Single sign-on with Microsoft Entra ID.

The OpenID Connect flow itself comes from django-allauth. This module decides who may sign in
(by email domain), links a first SSO sign-in to an existing account with the same email, and
gives new accounts the configured role and organisation membership.
"""

from __future__ import annotations

import re

from allauth.account.models import EmailAddress
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.http import HttpResponseRedirect
from django.utils import timezone

from cvat.apps.engine.log import ServerLogManager

slogger = ServerLogManager(__name__)

LOGIN_PAGE = "/auth/login"


def sso_email(sociallogin) -> str:
    """The email to trust for an Entra sign-in: the email claim, else the sign-in name (UPN)"""
    data = sociallogin.account.extra_data or {}
    # allauth stores the ID token and userinfo claims; look in both
    candidates = [sociallogin.user.email]
    for source in (data, data.get("userinfo") or {}, data.get("id_token") or {}):
        if isinstance(source, dict):
            candidates += [source.get("email"), source.get("preferred_username"), source.get("upn")]

    for value in candidates:
        if value and "@" in value:
            return value.strip().lower()

    return ""


def is_allowed_domain(email: str) -> bool:
    domain = email.rsplit("@", 1)[-1] if "@" in email else ""
    return bool(domain) and domain in settings.CVAT_SSO_ALLOWED_DOMAINS


def _unique_username(email: str) -> str:
    User = get_user_model()
    base = re.sub(r"[^\w.@+-]", "", email.split("@", 1)[0])[:140] or "user"
    candidate, n = base, 1
    while User.objects.filter(username__iexact=candidate).exists():
        n += 1
        candidate = f"{base}{n}"
    return candidate


def _login_error(reason: str) -> ImmediateHttpResponse:
    return ImmediateHttpResponse(HttpResponseRedirect(f"{LOGIN_PAGE}?sso_error={reason}"))


class EntraSocialAccountAdapter(DefaultSocialAccountAdapter):
    def pre_social_login(self, request, sociallogin):
        email = sso_email(sociallogin)
        if not is_allowed_domain(email):
            slogger.glob.warning("SSO sign-in refused for a disallowed email domain")
            raise _login_error("domain")

        sociallogin.user.email = email

        if sociallogin.is_existing:
            return

        # First SSO sign-in for this person: link it to an existing account with the same
        # email, so people keep their jobs and history. This is safe because only accounts
        # from the configured Entra tenant and allowed domains get this far.
        User = get_user_model()
        existing = User.objects.filter(email__iexact=email).order_by("id").first()
        if existing is None:
            # Accounts made by an administrator before SSO often have the sign-in name as the
            # username and no email. Link those too, but never an account with another email.
            existing = User.objects.filter(
                username__iexact=email.split("@", 1)[0], email=""
            ).first()
        if existing is not None:
            if not existing.is_active:
                raise _login_error("inactive")
            if not existing.email:
                existing.email = email
                existing.save(update_fields=["email"])
            sociallogin.connect(request, existing)

    def is_open_for_signup(self, request, sociallogin):
        # Domain was checked in pre_social_login. This is independent of CVAT_ALLOW_SIGNUP,
        # which only controls the username and password sign-up form.
        return True

    def populate_user(self, request, sociallogin, data):
        user = super().populate_user(request, sociallogin, data)
        email = sso_email(sociallogin)
        user.email = email
        user.username = _unique_username(email)
        return user

    @transaction.atomic
    def save_user(self, request, sociallogin, form=None):
        # Stop the default post-save signal from giving the broader default role
        sociallogin.user.skip_group_assigning = True
        user = super().save_user(request, sociallogin, form)

        role = Group.objects.filter(name=settings.CVAT_SSO_DEFAULT_ROLE).first()
        if role is not None:
            user.groups.add(role)

        EmailAddress.objects.update_or_create(
            user=user, email=user.email, defaults={"verified": True, "primary": True}
        )

        self._join_organization(user)
        return user

    @staticmethod
    def _join_organization(user) -> None:
        if not settings.CVAT_SSO_ORGANIZATION:
            return

        from cvat.apps.organizations.models import Membership, Organization

        organization = Organization.objects.filter(slug=settings.CVAT_SSO_ORGANIZATION).first()
        if organization is None:
            slogger.glob.warning(
                "SSO organisation '%s' does not exist, new user not added to it",
                settings.CVAT_SSO_ORGANIZATION,
            )
            return

        Membership.objects.get_or_create(
            user=user,
            organization=organization,
            defaults={
                "role": settings.CVAT_SSO_ORGANIZATION_ROLE,
                "is_active": True,
                "joined_date": timezone.now(),
            },
        )

    def on_authentication_error(
        self, request, provider, error=None, exception=None, extra_context=None
    ):
        slogger.glob.warning("SSO sign-in failed: %s", error)
        raise _login_error("failed")

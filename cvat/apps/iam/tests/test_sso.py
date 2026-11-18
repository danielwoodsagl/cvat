# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from unittest import mock

from allauth.account.models import EmailAddress
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.models import SocialAccount, SocialLogin
from django.contrib.auth import get_user_model
from django.contrib.sessions.middleware import SessionMiddleware
from django.test import RequestFactory, TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from cvat.apps.iam.sso import EntraSocialAccountAdapter
from cvat.apps.organizations.models import Membership, Organization

User = get_user_model()


@override_settings(
    CVAT_SSO_ALLOWED_DOMAINS=["fleetscout.io", "fleetscout.co.uk"],
    CVAT_SSO_DEFAULT_ROLE="worker",
    CVAT_SSO_ORGANIZATION="fleetscout",
    CVAT_SSO_ORGANIZATION_ROLE="worker",
)
class EntraSocialAccountAdapterTest(TestCase):
    def setUp(self):
        self.adapter = EntraSocialAccountAdapter()
        self.owner = User.objects.create_user(username="org-owner", password="x")
        self.organization = Organization.objects.create(slug="fleetscout", owner=self.owner)

    def _request(self):
        request = RequestFactory().get("/api/auth/oidc/entra/login/callback/")
        SessionMiddleware(lambda r: None).process_request(request)
        request.session.save()
        return request

    @staticmethod
    def _sociallogin(email: str, uid: str = "entra-uid-1") -> SocialLogin:
        account = SocialAccount(
            provider="entra", uid=uid, extra_data={"email": email, "preferred_username": email}
        )
        return SocialLogin(user=User(email=email), account=account)

    def _sign_up(self, email: str):
        request = self._request()
        sociallogin = self._sociallogin(email)
        self.adapter.pre_social_login(request, sociallogin)
        self.adapter.populate_user(request, sociallogin, {"email": email})
        return self.adapter.save_user(request, sociallogin)

    def test_refuses_other_domains(self):
        for email in ("someone@activate-group.com", "someone@fleetscout.io.evil.com", ""):
            with self.subTest(email=email), self.assertRaises(ImmediateHttpResponse) as ctx:
                self.adapter.pre_social_login(self._request(), self._sociallogin(email))

            self.assertIn("sso_error=domain", ctx.exception.response["Location"])

    def test_new_user_gets_lowest_role_and_joins_the_organization(self):
        user = self._sign_up("New.Person@FleetScout.io")

        self.assertEqual(user.email, "new.person@fleetscout.io")
        self.assertEqual(user.username, "new.person")
        self.assertEqual(set(user.groups.values_list("name", flat=True)), {"worker"})
        membership = Membership.objects.get(user=user, organization=self.organization)
        self.assertEqual(membership.role, "worker")
        self.assertTrue(membership.is_active)
        self.assertTrue(EmailAddress.objects.get(user=user, email=user.email).verified)

    def test_other_allowed_domain_works(self):
        user = self._sign_up("someone@fleetscout.co.uk")

        self.assertEqual(user.username, "someone")

    def test_username_stays_unique(self):
        User.objects.create_user(username="new.person", email="other@fleetscout.io", password="x")

        user = self._sign_up("new.person@fleetscout.io")

        self.assertEqual(user.username, "new.person2")

    def test_links_to_existing_account_with_the_same_email(self):
        existing = User.objects.create_user(
            username="chris.little", email="Chris.Little@fleetscout.io", password="x"
        )
        groups_before = set(existing.groups.values_list("name", flat=True))
        sociallogin = self._sociallogin("chris.little@fleetscout.io")

        # connect() looks up the configured Entra app only to fill in a signal argument.
        # SSO is not configured in the test settings, so stand in for that lookup.
        with mock.patch.object(SocialAccount, "get_provider", return_value=mock.Mock(id="entra")):
            self.adapter.pre_social_login(self._request(), sociallogin)

        self.assertTrue(SocialAccount.objects.filter(user=existing, provider="entra").exists())
        self.assertEqual(User.objects.filter(email__iexact="chris.little@fleetscout.io").count(), 1)
        self.assertEqual(set(existing.groups.values_list("name", flat=True)), groups_before)

    def test_links_to_existing_account_with_no_email_by_username(self):
        existing = User.objects.create_user(username="gary.wright", email="", password="x")

        with mock.patch.object(SocialAccount, "get_provider", return_value=mock.Mock(id="entra")):
            self.adapter.pre_social_login(
                self._request(), self._sociallogin("gary.wright@fleetscout.io")
            )

        existing.refresh_from_db()
        self.assertEqual(existing.email, "gary.wright@fleetscout.io")
        self.assertTrue(SocialAccount.objects.filter(user=existing, provider="entra").exists())

    def test_does_not_link_by_username_when_the_account_has_another_email(self):
        other = User.objects.create_user(
            username="gary.wright", email="gary@somewhere-else.com", password="x"
        )
        sociallogin = self._sociallogin("gary.wright@fleetscout.io")

        self.adapter.pre_social_login(self._request(), sociallogin)

        self.assertFalse(sociallogin.is_existing)
        self.assertFalse(SocialAccount.objects.filter(user=other).exists())

    def test_refuses_inactive_existing_account(self):
        User.objects.create_user(
            username="gone", email="gone@fleetscout.io", password="x", is_active=False
        )

        with self.assertRaises(ImmediateHttpResponse) as ctx:
            self.adapter.pre_social_login(self._request(), self._sociallogin("gone@fleetscout.io"))

        self.assertIn("sso_error=inactive", ctx.exception.response["Location"])

    @override_settings(CVAT_SSO_ORGANIZATION="does-not-exist")
    def test_missing_organization_does_not_block_sign_in(self):
        user = self._sign_up("solo@fleetscout.io")

        self.assertFalse(Membership.objects.filter(user=user).exists())
        self.assertEqual(set(user.groups.values_list("name", flat=True)), {"worker"})


class SSOProvidersViewTest(TestCase):
    def _get(self):
        return APIClient().get("/api/auth/sso")

    @override_settings(CVAT_ENTRA_SSO_ENABLED=False)
    def test_lists_nothing_when_sso_is_off(self):
        response = self._get()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json(), [])

    @override_settings(CVAT_ENTRA_SSO_ENABLED=True)
    def test_lists_microsoft_and_sets_csrf_cookie_when_sso_is_on(self):
        response = self._get()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.json(),
            [{"id": "entra", "name": "Microsoft", "login_url": "/api/auth/oidc/entra/login/"}],
        )
        self.assertIn("csrftoken", response.cookies)

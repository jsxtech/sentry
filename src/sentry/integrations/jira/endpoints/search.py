from typing import Any

from bs4 import BeautifulSoup
from rest_framework.exceptions import NotFound
from rest_framework.request import Request
from rest_framework.response import Response

from sentry import features
from sentry.api.api_owners import ApiOwner
from sentry.api.api_publish_status import ApiPublishStatus
from sentry.api.base import control_silo_endpoint
from sentry.integrations.api.bases.integration import IntegrationEndpoint
from sentry.integrations.jira.integration import JiraProjectMapping
from sentry.integrations.models.integration import Integration
from sentry.integrations.types import IntegrationProviderSlug
from sentry.organizations.services.organization import RpcOrganization
from sentry.shared_integrations.exceptions import ApiError, ApiUnauthorized, IntegrationError

from .. import JiraIntegration
from ..utils import build_user_choice


@control_silo_endpoint
class JiraSearchEndpoint(IntegrationEndpoint):
    owner = ApiOwner.INTEGRATIONS
    publish_status = {
        "GET": ApiPublishStatus.PRIVATE,
    }
    """
    Called by our front end when it needs to make requests to Jira's API for data.
    """

    provider = IntegrationProviderSlug.JIRA.value

    def _get_integration(self, organization: RpcOrganization, integration_id: int) -> Integration:
        return Integration.objects.get(
            organizationintegration__organization_id=organization.id,
            id=integration_id,
            provider=self.provider,
        )

    def get(
        self, request: Request, organization: RpcOrganization, integration_id: int, **kwds: Any
    ) -> Response:
        try:
            integration = self._get_integration(organization, integration_id)
        except Integration.DoesNotExist:
            return Response(status=404)
        installation = integration.get_installation(organization.id)
        if not isinstance(installation, JiraIntegration):
            raise NotFound("Integration by that id is not a JiraIntegration.")
        jira_client = installation.get_client()

        field = request.GET.get("field")
        query = request.GET.get("query")

        if field is None:
            return Response({"detail": "field is a required parameter"}, status=400)
        if not query:
            return Response({"detail": "query is a required parameter"}, status=400)

        if field in ("externalIssue", "parent"):
            if not query:
                return Response([])
            try:
                resp = installation.search_issues(query)
            except IntegrationError as e:
                return Response({"detail": str(e)}, status=400)
            return Response(
                [
                    {"label": "({}) {}".format(i["key"], i["fields"]["summary"]), "value": i["key"]}
                    for i in resp.get("issues", [])
                ]
            )

        if field in ("assignee", "reporter"):
            try:
                response = jira_client.search_users_for_project(
                    request.GET.get("project", ""), query
                )
            except (ApiUnauthorized, ApiError):
                return Response({"detail": "Unable to fetch users from Jira"}, status=400)

            user_tuples = filter(
                None, [build_user_choice(user, jira_client.user_id_field()) for user in response]
            )
            users = [{"value": user_id, "label": display} for user_id, display in user_tuples]
            return Response(users)

        if field == "project" and features.has(
            "organizations:jira-paginated-projects", organization, actor=request.user
        ):
            try:
                response = jira_client.get_projects_paginated(params={"query": query})
            except (ApiUnauthorized, ApiError):
                return Response({"detail": "Unable to fetch projects from Jira"}, status=400)

            projects = [
                JiraProjectMapping(label=f"{p["key"]} - {p["name"]}", value=p["id"])
                for p in response.get("values", [])
            ]

            return Response(projects)

        try:
            response = jira_client.get_field_autocomplete(name=field, value=query)
        except (ApiUnauthorized, ApiError):
            return Response(
                {"detail": f"Unable to fetch autocomplete for {field} from Jira"},
                status=400,
            )
        choices = [
            {
                "value": result["value"],
                # Jira's response will highlight the matching substring in the name using HTML formatting.
                "label": BeautifulSoup(result["displayName"], "html.parser").get_text(),
            }
            for result in response["results"]
        ]
        return Response(choices)

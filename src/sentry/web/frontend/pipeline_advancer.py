from django.contrib import messages
from django.http import HttpRequest, HttpResponseRedirect
from django.http.response import HttpResponseBase
from django.urls import reverse
from django.utils.translation import gettext_lazy as _

from sentry.identity.pipeline import IdentityPipeline
from sentry.integrations.pipeline import IntegrationPipeline
from sentry.integrations.types import IntegrationProviderSlug
from sentry.organizations.absolute_url import generate_organization_url
from sentry.utils.http import absolute_uri, create_redirect_url
from sentry.web.frontend.base import BaseView

# The request doesn't contain the pipeline type (pipeline information is stored
# in redis keyed by the pipeline name), so we try to construct multiple pipelines
# and use whichever one works.
PIPELINE_CLASSES = (IntegrationPipeline, IdentityPipeline)


class PipelineAdvancerView(BaseView):
    """Gets the current pipeline from the request and executes the current step."""

    auth_required = False

    csrf_protect = False

    def handle(self, request: HttpRequest, provider_id: str) -> HttpResponseBase:
        pipeline = None

        for pipeline_cls in PIPELINE_CLASSES:
            pipeline = pipeline_cls.get_for_request(request=request)
            if pipeline:
                break

        # GitHub apps may be installed directly from GitHub, in which case
        # they will redirect here *without* being in the pipeline. If that happens
        # redirect to the integration install org picker.
        if (
            provider_id == IntegrationProviderSlug.GITHUB.value
            and request.GET.get("setup_action") == "install"
            and pipeline is None
        ):
            installation_id = request.GET.get("installation_id")
            return self.redirect(
                reverse("integration-installation", args=[provider_id, installation_id])
            )

        if pipeline is None or not pipeline.is_valid():
            messages.add_message(request, messages.ERROR, _("Invalid request."))
            return self.redirect("/")

        subdomain = pipeline.fetch_state("subdomain")
        if subdomain is not None and request.subdomain != subdomain:
            url_prefix = generate_organization_url(subdomain)
            redirect_url = absolute_uri(
                reverse("sentry-extension-setup", kwargs={"provider_id": provider_id}),
                url_prefix=url_prefix,
            )
            return HttpResponseRedirect(create_redirect_url(request, redirect_url))

        response = pipeline.current_step()
        return response

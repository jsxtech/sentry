import styled from '@emotion/styled';

import {Button} from 'sentry/components/core/button';
import Panel from 'sentry/components/panels/panel';
import {t, tct} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {Organization} from 'sentry/types/organization';
import TextBlock from 'sentry/views/settings/components/text/textBlock';

import {openUpsellModal} from 'getsentry/actionCreators/modal';
import type {Subscription} from 'getsentry/types';
import {getTrialDaysLeft} from 'getsentry/utils/billing';

import TrialBadge from './trial/badge';
import {ButtonWrapper, SubscriptionBody} from './styles';

type Props = {
  organization: Organization;
  subscription: Subscription;
};

function TrialAlert({organization, subscription}: Props) {
  if (!subscription.isTrial) {
    return null;
  }

  const daysLeft = getTrialDaysLeft(subscription);

  if (daysLeft < 0) {
    return null;
  }

  const trialName = subscription.isEnterpriseTrial
    ? t('Enterprise Trial')
    : subscription.isPerformancePlanTrial
      ? t('Performance Trial')
      : t('Business Plan Trial');

  const featuresName = subscription.isPerformancePlanTrial
    ? 'performance'
    : 'business plan';

  return (
    <Panel data-test-id="trial-alert">
      <SubscriptionBody withPadding>
        <TrialInfo>
          <TrialHeader>
            <StyledHeading>{trialName}</StyledHeading>
            <TrialBadge subscription={subscription} organization={organization} />
          </TrialHeader>
          <StyledSubText>
            {tct("With your trial you have access to Sentry's [featuresName] features.", {
              featuresName,
            })}
          </StyledSubText>
        </TrialInfo>

        {subscription.canSelfServe && (
          <ButtonWrapper gap="none">
            <Button
              size="sm"
              data-test-id="trial-details-button"
              onClick={() => openUpsellModal({organization, source: 'active_trial'})}
            >
              {t('Learn more')}
            </Button>
          </ButtonWrapper>
        )}
      </SubscriptionBody>
    </Panel>
  );
}

const TrialInfo = styled('div')`
  display: grid;
  grid-auto-rows: auto;
  gap: ${space(1)};
`;

const TrialHeader = styled('div')`
  display: flex;
  gap: ${space(1)};
  align-items: center;
`;

const StyledHeading = styled('span')`
  font-weight: 400;
  font-size: ${p => p.theme.fontSize.xl};
`;

const StyledSubText = styled(TextBlock)`
  color: ${p => p.theme.subText};
  margin: 0;
`;

export default TrialAlert;

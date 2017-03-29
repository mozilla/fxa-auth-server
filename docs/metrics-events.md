# Auth server metrics events

The auth server emits two types of event
that are imported to redshift
and made available to
metrics queries in redash:

* [Flow events](#flow-events),
  which represent something happening
  during the course of
  a sign-in or sign-up flow.

* [Activity events](#activity-events),
  which represent significant actions
  or state changes
  at the account level.

Flow events are used
to plot charts for
sign-in and sign-up user funnels.
They enable us to
follow individual user journeys
for the length of each flow,
even when those journeys
span over multiple devices or browsers.
They also power the chart for our
"time taken for device connection" KPI.

Activity events are used
for analysing user behaviour
in a more general way.
They are behind the charts for our
"engagement ratio" and "multi-device usage" KPIs.

## Flow events

The following flow events
represent a successful step
in a sign-in or sign-up flow:

|Name|Description|
|----|-----------|
|`flow.begin`|A user has requested a page that allows them to sign in/up.|
|`flow.${viewName}.view`|A view has rendered.|
|`flow.${viewName}.engage`|A user has interacted with the the form on a page that allows them to sign in/up`.|
|`flow.${viewName}.submit`|A user has submitted the signup form on a page that allows them to sign in/up.|
|`flow.${viewName}.have-account`|A user has clicked on the 'Already have an account?' link.|
|`flow.${viewName}.create-account`|A user has clicked on the 'Create an account' link.|
|`flow.${viewName}.forgot-password`|A user has clicked on the 'Forgot password?' link.|
|`flow.${action}.attempt`|The content server has sent a sign-in/up request to the auth server.|
|`flow.experiment.${experiment}.${group}`|A user has been included in an active experiment.|
|`flow.performance`|`flow_time` for this event indicates the number of milliseconds a user waited until the first view rendered and they were able to interact with the page.|
|`flow.performance.network`|`flow_time` for this event is a number that approximates the relative speed of a user's network performance (lower is faster).|
|`flow.performance.server`|`flow_time` for this event is a number that approximates the relative speed of the server performance (lower is faster).|
|`flow.performance.client`|`flow_time` for this event is a number that approximates the relative speed of a user's client-side performance (lower is faster).|
|`account.login`|An existing account has been signed in to.|
|`account.created`|A new account has been created.|
|`email.confirmation.sent`|A sign-in confirmation email has been sent to a user.|
|`email.verification.sent`|A sign-up verification email has been sent to a user.|
|`email.confirmation.resent`|A sign-in confirmation email has been re-sent to a user.|
|`email.verification.resent`|A sign-up verification email has been re-sent to a user.|
|`email.verify_code.clicked`|A user has clicked on the link in a confirmation/verification email.|
|`email.${templateName}.delivered`|An email was delivered to a user.|
|`sms.region.${region}`|A user has tried to send SMS to `region`.|
|`sms.${templateName}.sent`|An SMS message has been sent to a user's phone.|
|`account.confirmed`|Sign-in to an existing account has been confirmed via email.|
|`account.reminder`|A new account has been verified via a reminder email.|
|`account.verified`|A new account has been verified via email.|
|`account.keyfetch`|Sync encryption keys have been fetched.|
|`account.signed`|A certificate has been signed.|
|`account.reset`|An account has been reset.|
|`account.login.confirmedUnblockCode`|A user has successfully unblocked their account.|
|`account.login.sentUnblockCode`|A sign-in unblock email has been sent to the user.|
|`password.forgot.send_code.start`|A user has initiated the password reset flow.|
|`password.forgot.send_code.completed`|A password reset email has been sent to the user.|
|`password.forgot.resend_code.start`|A user has requested that the password reset email be re-sent.|
|`password.forgot.resend_code.completed`|A password reset email has been re-sent to the user.|
|`password.forgot.verify_code.start`|A user has clicked on the link in a password reset email.|
|`password.forgot.verify_code.completed`|A password reset has been successfully completed on the server.|
|`route.${path}.200`| A route responded with a 200 status code. Example: `route./account/login.200`|
|`flow.complete`|A user has successfully completed a sign-in or sign-up flow.|

The following flow events
represent error conditions,
which may or may not be terminal
to a flow:

|Name|Description|
|----|-----------|
|`customs.blocked`|A request was blocked by the customs server.|
|`route.${path}.${statusCode}.${errno}`| A route responded with a >=400 status code. Includes `errno`. Example: `route./account/login.400.103`|
|`email.${templateName}.bounced`|An email bounced.|

In redshift,
these events are stored
in two tables:

* `flow_metadata`,
  containing all of the data
  relating to a flow
  as a single entity.

* `flow_events`,
  containing data
  for the individual events
  within each flow.

* `flow_experiments`,
  containing data for flows
  that are part of a feature experiment.

The `flow_metadata` table
contains the following fields:

|Name|Description|
|----|-----------|
|`flow_id`|The flow identifier. A randomly-generated opaque id.|
|`begin_time`|The time at which the `flow.begin` event occurred.|
|`duration`|The length of time from the `flow.begin` event until the last event of the flow.|
|`completed`|Boolean indicating whether the flow was successfully completed.|
|`new_account`|Boolean indicating whether the flow was a sign-up.|
|`uid`|The user id. An opaque token, HMACed to avoid correlation back to FxA user db. Not every flow has a `uid`.|
|`locale`|The user's locale. For cases where we aren't localised in their favoured locale(s), the value will be `en-US.default`|
|`ua_browser`|The user's web browser, e.g. 'Firefox' or 'Chrome'.|
|`ua_version`|The user's browser version.|
|`ua_os`|The user's operating system, e.g. 'Windows 10' or 'Android'.|
|`context`|FxA auth broker context. This is related to browser platform and version |
|`entrypoint`|The entrypoint of the first flow in the session. Typically a UI touchpoint like "preferences".|
|`migration`|Sync migration.|
|`service`|The service identifier. For Sync it may be empty or `sync`. For OAuth reliers it is their hex client id.|
|`utm_campaign`|Marketing campaign identifier for the first flow in the session. Not stored if the `DNT` request header was `1`.|
|`utm_content`|Marketing campaign content identifier for the first flow in the session. Not stored if the `DNT` request header was `1`.|
|`utm_medium`|Marketing campaign medium for the first flow in the session. Not stored if the `DNT` request header was `1`.|
|`utm_source`|Marketing campaign source for the first flow in the session. Not stored if the `DNT` request header was `1`.|
|`utm_term`|Marketing campaign search term for the first flow in the session. Not stored if the `DNT` request header was `1`.|
|`export_date`|The date that the `flow.begin` event was exported to S3 by the metrics pipeline.|

The `flow_events` table
contains the following fields:

|Name|Description|
|----|-----------|
|`timestamp`|The time at which the event occurred.|
|`flow_time`|The time since the beginning of the flow.|
|`flow_id`|The flow identifier.|
|`type`|The event name.|
|`uid`|The user id. An opaque token, HMACed to avoid correlation back to FxA user db. Not every flow event has a `uid`.|
|`locale`|The user's locale. For cases where we aren't localised in their favoured locale(s), the value will be `en-US.default`|

The `flow_experiments` table
contains the following fields:

|Name|Description|
|----|-----------|
|`experiment`|The name of the experiment.|
|`cohort`|The experiment group that this flow was part of, usually one of `treatment` or `control`.|
|`timestamp`|The time at which the experiment event occurred, indicating when the flow was assigned to the experiment.|
|`flow_id`|The flow identifier. A randomly-generated opaque id.|
|`uid`|The user id. An opaque token, HMACed to avoid correlation back to FxA user db. Not every experiment has a `uid`.|
|`export_date`|The date that the experiment event was exported to S3 by the metrics pipeline.|

## Activity events

The following activity events
are emitted:

|Name|Description|
|----|-----------|
|`account.created`|A new account has been created.|
|`account.login`|An existing account has been signed in to.|
|`account.verified`|A new account has been verified via email.|
|`account.confirmed`|Sign-in to an existing account has been confirmed via email.|
|`account.keyfetch`|Sync encryption keys have been fetched.|
|`account.signed`|A certificate has been signed.|
|`account.reset`|An account has been reset.|
|`account.deleted`|An account has been deleted.|
|`device.created`|A device record has been created for a Sync account.|
|`device.updated`|Device record is updated on a Sync account.|
|`device.deleted`|Device record has been deleted from a Sync account.|
|`sync.sentTabToDevice`|Device sent a push message for send-tab-to-device feature.|

In redshift,
these events are stored
in the `activity_events` table
with the following fields:

|Name|Description|
|----|-----------|
|`timestamp`|The time at which the event occurred.|
|`type`|The name of the event.|
|`uid`|The user id. An opaque token, HMACed to avoid correlation back to FxA user db.|
|`device_id`|Optional. The id of the device record.  This *does* correlate back to a record the FxA user db.|
|`service`|Optional. The id of the requesting service. For Sync this may be `'sync'` or the empty string.|
|`ua_browser`|The user's web browser.|
|`ua_version`|The user's browser version.|
|`ua_os`|The user's operating system.|

Two further tables,
summarising device usage,
are populated
based on the activity event data.

The table `daily_activity_per_device`
contains the following fields:

|Name|Description|
|----|-----------|
|`day`|The date of the activity.|
|`uid`|The HMACed user id.|
|`device_id`|The id of the active device.|
|`service`|The id of the requesting service.|
|`ua_browser`|The user's web browser.|
|`ua_version`|The user's browser version.|
|`ua_os`|The user's operating system.|

The table `daily_multi_device_users`
contains the following fields:

|Name|Description|
|----|-----------|
|`day`|The date of the activity.|
|`uid`|The HMACed user id.|

For this table,
a multi-device user is defined as
somebody who was also active
on a different device
in the preceding five days.

## Sampled data sets

For all of the tables mentioned above,
related to both flow events
and activity events,
data automatically expires
when it reaches the end
of a rolling three-month window.
This is to keep the number of records
in each data set
within reasonable limits
so that queries don't run too slowly.

We also maintain down-sampled equivalents
of each data set,
which have a longer history
but contain only a subset
of the available events.
There is a 50%-sampled set,
which includes data
for the preceding six months,
and a 10%-sampled set,
which includes data
for the preceding two years.
If you want to use one of these data sets
in your queries,
just add the appropriate suffix
to each of the table names mentioned above:

* `_sampled_50` for the 50%-sampled sets,
  e.g. `flow_metadata_sampled_50`.

* `_sampled_10` for the 10%-sampled sets,
  e.g. `activity_events_sampled_10`.

## Significant changes

### Train 84

* [The `sms.region.${region}` event
  was implemented](https://github.com/mozilla/fxa-auth-server/pull/1783).

### Train 83

* [`locale` was added
  to the `flow_events`
  and `flow_metadata` schemata](https://github.com/mozilla/fxa-auth-server/pull/1702).

### Train 82

* [The `flow.performance.*` events
  were added](https://github.com/mozilla/fxa-content-server/pull/4776).

* [The `flow.experiment.${experiment}.${group}` event
  was added](https://github.com/mozilla/fxa-content-server/pull/4775).

### Train 81

* [`uid` was added
  to the `flow_events`
  and `flow_metadata` schemata](https://github.com/mozilla/fxa-auth-server/pull/1650).

### Train 80

* [A known cause
  of duplicate flow ids
  being logged
  was fixed](https://github.com/mozilla/fxa-content-server/pull/4676).

### Train 78

* [Logging for the `route.*` events
  was fixed](https://github.com/mozilla/fxa-auth-server/pull/1606).

* [Logging for the `email.${templateName}.bounced` event
  was fixed](https://github.com/mozilla/fxa-auth-server/pull/1609).

### Train 76

* [Duplicate flow events
  were fixed in the content server](https://github.com/mozilla/fxa-content-server/pull/4478).

* [The `account.reset` event
  was made a flow event](https://github.com/mozilla/fxa-auth-server/pull/1584).

### Train 75

* [The correct `service` parameter
  was passed to `/certificate/sign`
  for OAuth reliers,
  stopping those requests from
  being identified as originating from
  the content server](https://github.com/mozilla/fxa-content-server/pull/4419).

* [The `flow.${viewName}.view` event
  was implemented](https://github.com/mozilla/fxa-content-server/pull/4440).

* [The `flow.${viewName}.begin` event
  was changed back to `flow.begin`](https://github.com/mozilla/fxa-content-server/pull/4440).

* [Validation of the `utm_*` parameters
  was implemented](https://github.com/mozilla/fxa-content-server/pull/4446).

* [The `route.*` events were implemented](https://github.com/mozilla/fxa-auth-server/pull/1576).

### Train 74

* [Flow event data validation
  was implemented](https://github.com/mozilla/fxa-content-server/pull/4383).

* [The `${viewName}` part of
  `flow.${viewName}.begin`,
  `flow.${viewName}.engage` and
  `flow.${viewName}.submit`
  was fixed](https://github.com/mozilla/fxa-content-server/pull/4317).

* [The `flow.have-account` event
  was changed to `flow.${viewName}.have-account`](https://github.com/mozilla/fxa-content-server/pull/4317).

* [The `flow.${viewName}.create-account` event
  was implemented](https://github.com/mozilla/fxa-content-server/pull/4317).

* [The `flow.${viewName}.forgot-password` event
  was implemented](https://github.com/mozilla/fxa-content-server/pull/4317).

* [The `flow.${action}.attempt` event
  was implemented](https://github.com/mozilla/fxa-content-server/pull/4317).

### Train 73

* [Expiry time
  for metrics context data in memcached
  was increased from 30 minutes
  to 2 hours](https://github.com/mozilla/fxa-auth-server/pull/1519).

* [The `flow.complete` event
  was implemented](https://github.com/mozilla/fxa-auth-server/pull/1515).

### Train 72

* [A change to the memcached key
  used when stashing metrics context data
  introduced a 30-minute partial blip
  in flow event data](https://github.com/mozilla/fxa-auth-server/pull/1500).

### Train 71

* [The `flow.begin` event
  was changed to `flow.${viewName}.begin`](https://github.com/mozilla/fxa-content-server/pull/4224).

* [Timestamps were fixed
  on the begin, engage and submit events](https://github.com/mozilla/fxa-content-server/pull/4351).

* [Metrics context data was added
  to the begin, engage and submit events](https://github.com/mozilla/fxa-content-server/pull/4234).

* [Erroneous `"none"` values were removed
  from empty metrics context properties
  in the content server](https://github.com/mozilla/fxa-content-server/pull/4234).

* [Expiry time for flow ids
  was increased from 30 minutes
  to two hours](https://github.com/mozilla/fxa-auth-server/pull/1487).


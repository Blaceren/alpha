# Deferred integrations after the structural pass

## Google OAuth

Google login is intentionally not enabled by this pass. Production setup requires OAuth client credentials, the final public domain, an exact callback URL, secret storage, account-linking rules, and a security review.

## Production email

The profile supports a pending email-change request and exposes its verification status. Automatic delivery and confirmation of the new address remain deferred until a production mail provider and operator policy are selected.

## Domain and application URL

`APP_URL` must contain the public HTTPS origin before production links or OAuth callbacks are enabled. The application keeps the existing fallback for local development; production configuration should not rely on that fallback.

## Pocket scope

The confirmed registration postback, affiliate link and progression contract are unchanged. Trading actions and user-info synchronization beyond existing checkpoint checks require a separate Pocket API pass.

## Design scope

Advanced visual changes, 3D and animation were deliberately excluded. This pass changes product structure, navigation, access and functional wiring only.

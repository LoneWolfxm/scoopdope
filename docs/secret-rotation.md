# Secret Rotation Procedures

## Overview

scoopdope implements automated and manual secret rotation to minimize exposure from compromised credentials.

## API Key Rotation

### Automated Rotation
API keys older than **90 days** are automatically deactivated daily at 2 AM UTC via a scheduled cron job.

### Manual Rotation
Users can rotate their own API keys via:
```
POST /v1/secrets/api-keys/:id/rotate
Authorization: Bearer <jwt>
```
Returns a new raw API key. The old key is immediately invalidated.

## Automated Rotation via AWS Secrets Manager

Critical secrets are stored in AWS Secrets Manager and rotated automatically by rotation Lambdas. Rotation is configured in Terraform (`infra/terraform/secrets.tf`); do not rotate these secrets by hand except in an emergency (see below).

| Secret | Rotation mechanism | Schedule |
| --- | --- | --- |
| `JWT_SECRET` | Custom rotation Lambda (`jwt-secret-rotation`) | Every **30 days** |
| `DATABASE_PASSWORD` | AWS-managed RDS rotation Lambda (`SecretsManagerRDSMySQLRotationSingleUser` / `...PostgreSQL...`) | Every **30 days** |
| `PAYMENT_WEBHOOK_SECRET` | Custom rotation Lambda (`payment-webhook-secret-rotation`) | Every **30 days** |

### JWT Signing Keys (`JWT_SECRET`)

The rotation Lambda generates a new secret with `openssl rand -hex 64` and stores it as `AWSCURRENT`, moving the old value to `AWSPREVIOUS`. The application reads both `JWT_SECRET` (from `AWSCURRENT`) and `JWT_SECRET_PREVIOUS` (from `AWSPREVIOUS`) and accepts tokens signed with either during the transition window, so existing sessions are not invalidated mid-rotation. After the next rotation, `AWSPREVIOUS` is replaced and tokens signed with the older key are rejected.

### Database Password (`DATABASE_PASSWORD`)

Rotation is handled entirely by the AWS-managed RDS rotation Lambda, which uses the Secrets Manager rotation protocol (`createSecret`, `setSecret`, `testSecret`, `finishSecret`) to change the password on the database user and update the secret. The application pool reconnects automatically; no restart is required.

### Payment Webhook Secret (`PAYMENT_WEBHOOK_SECRET`)

The rotation Lambda generates a new HMAC signing secret and stores it as `AWSCURRENT`, keeping the old value as `AWSPREVIOUS`. The webhook verifier accepts signatures from both secrets during the transition window so in-flight provider callbacks are not rejected.

## Rotation Notifications

Every rotation Lambda publishes a message to the `secret-rotation-events` SNS topic on success and on failure. The topic is subscribed by the monitoring Slack integration, which posts to the `#monitoring` channel. Notifications include the secret name, environment, rotation outcome, and the Lambda request ID.

If a rotation fails, the Lambda retries per the Secrets Manager rotation schedule and the failure notification is posted to Slack. Treat a failed rotation notification as an incident.

## Emergency Manual Rotation Procedure

Use this only when a secret is believed compromised or automated rotation is broken.

1. **Announce** in `#monitoring` that you are performing an emergency rotation and which secret is affected.
2. **Disable automatic rotation** for the secret so it does not race with your manual change:
   ```
   aws secretsmanager cancel-rotate-secret --secret-id <secret-name>
   ```
3. **Generate and store the new value** using the Secrets Manager CLI so the secret versioning (`AWSCURRENT`/`AWSPREVIOUS`) stays consistent:
   ```
   aws secretsmanager put-secret-value \
     --secret-id <secret-name> \
     --secret-string '<new-value>' \
     --version-stages AWSCURRENT
   ```
   For `JWT_SECRET` and `PAYMENT_WEBHOOK_SECRET`, keep the old value available as `AWSPREVIOUS` so the application continues to accept tokens/signatures during the transition.
4. **For `DATABASE_PASSWORD`**, also update the password on the database user (`ALTER USER ... IDENTIFIED BY ...`) before or immediately after storing the new secret value, then verify the application can connect.
5. **Verify** the application is healthy (auth flows, DB connections, webhook processing) and watch `#monitoring` for errors.
6. **Re-enable automatic rotation**:
   ```
   aws secretsmanager rotate-secret --secret-id <secret-name>
   ```
7. **Record** the rotation in the `secret_rotations` table (see Rotation Log below) and follow up with a post-incident note.

## Staging Validation Before Production

Never enable a new or changed rotation configuration in production without first validating it in staging:

1. Apply the Terraform changes to the staging environment.
2. Trigger a rotation manually in staging:
   ```
   aws secretsmanager rotate-secret --secret-id <secret-name>
   ```
3. Confirm the rotation Lambda succeeds, the Slack notification arrives in `#monitoring`, and the application continues to function (login, DB queries, webhook processing) throughout the rotation.
4. Only after a successful staging rotation, promote the configuration to production.

## Stellar Account Key Rotation

Stellar keys (`STELLAR_SECRET_KEY`) should be rotated by:

1. Generate a new Stellar keypair
2. Transfer any required XLM/assets to the new account
3. Update `STELLAR_SECRET_KEY` in environment
4. Restart the application

**Warning:** Ensure the new account is funded and has the required trustlines before switching.

## Rotation History

Admins can view rotation history:
```
GET /v1/secrets/rotation-history?secretType=api_key&limit=50
Authorization: Bearer <admin-jwt>
```

## Rotation Log

All rotations are recorded in the `secret_rotations` table with:
- `secretType`: type of secret rotated
- `identifier`: specific key/resource ID
- `rotatedBy`: user who triggered rotation (null for automated)
- `automated`: whether rotation was triggered by the scheduler
- `rotatedAt`: timestamp

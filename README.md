# sales-data
Balaclava Sales Dashboard

## Streamlit contact-log storage

The sales data loads from the shared Google Sheet automatically. The Store Contact Form can also write its team contact log back to Google Sheets when Streamlit secrets are configured.

Add these secrets in Streamlit Cloud:

```toml
contact_log_spreadsheet_id = "1kY5e6SXd7eQ7GJx-jg6M1R60WCCZ9I_25Eb7ZmuDKHw"
contact_log_worksheet = "Contact Log"

[gcp_service_account]
type = "service_account"
project_id = "..."
private_key_id = "..."
private_key = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
client_email = "..."
client_id = "..."
auth_uri = "https://accounts.google.com/o/oauth2/auth"
token_uri = "https://oauth2.googleapis.com/token"
auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs"
client_x509_cert_url = "..."
```

Share the Google spreadsheet with the service account `client_email` as an Editor. If these secrets are missing, the app falls back to local SQLite, which is not durable on Streamlit Cloud.

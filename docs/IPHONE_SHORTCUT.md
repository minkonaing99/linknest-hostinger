# iPhone Shortcut Setup

This shortcut saves a shared URL directly to Link Nest. Link Nest cleans the URL,
uses the default `saved` status, and fetches the page title on the server.

## Before You Begin

You need:

- an iPhone or iPad with the Shortcuts app
- a Link Nest installation available through HTTPS
- access to the Link Nest Settings page

Replace `https://YOUR-LINK-NEST-DOMAIN` below with your Link Nest base URL.

## 1. Create an API Token

1. Sign in to Link Nest.
2. Open `https://YOUR-LINK-NEST-DOMAIN/settings.html`.
3. Under **API Tokens**, enter `iPhone Shortcut` as the token name.
4. Select **Read + Write**. A read-only token cannot save links.
5. Tap **Create**, then **Copy**. The token is shown only once.

Keep the token private:

- Paste it directly into the shortcut, then clear the clipboard.
- Never put it in the request URL.
- Do not include it in screenshots or share a copy of the shortcut containing it.
- If it is exposed, revoke it in Settings and create a replacement.

## 2. Create the Shortcut

1. Open Shortcuts and create a new shortcut named `Save to Link Nest`.
2. Open the shortcut details and enable **Show in Share Sheet**.
3. Set the accepted input type to **URLs** only.
4. Add **Get URLs from Shortcut Input**.
5. Add **Get Item from List** and select **First Item**.

Choosing the first URL ensures the API receives one plain URL even when an app
shares more than one item.

## 3. Configure the API Request

1. Add a **URL** action containing:

   ```text
   https://YOUR-LINK-NEST-DOMAIN/api/links
   ```

2. Add **Get Contents of URL** after it.
3. Expand its settings and configure:

   - Method: `POST`
   - Request Body: `JSON`

4. Add one JSON field:

   | Key | Type | Value |
   | --- | --- | --- |
   | `url` | Text | `First Item` from Get Item from List |

5. Add these headers:

   | Key | Value |
   | --- | --- |
   | `Authorization` | `Bearer YOUR_TOKEN` |
   | `Accept` | `application/json` |
   | `Content-Type` | `application/json` |

There must be one space between `Bearer` and the token. Do not add a separate
title request or title field. Link Nest fetches the title automatically.

## 4. Show the Result

1. Add **Get Dictionary Value** after **Get Contents of URL**.
2. Read the `ok` key from the returned dictionary.
3. Add an **If** action:
   - If `ok` is true, add **Show Notification** with `Saved to Link Nest`.
   - Otherwise, add **Show Notification** with `Could not save link`.

HTTP error responses that return JSON can use the failure branch. If the device
cannot reach the server, Shortcuts may stop at **Get Contents of URL** and show its
own native error instead.

## 5. Test It

1. Open a page in Safari.
2. Tap Share.
3. Choose **Save to Link Nest**.
4. Wait for the success notification.
5. Open Link Nest and confirm the saved URL and fetched title.

The same shortcut can appear in other apps that share a valid HTTP or HTTPS URL.

## Troubleshooting

| Result | Cause | Fix |
| --- | --- | --- |
| `401 Authentication required` | Token is missing, incorrect, or revoked | Copy a valid token and keep the `Bearer ` prefix |
| `403 This API token is read-only` | Token uses read-only access | Create a Read + Write token |
| `409 This link already exists` | URL is already saved | Open Link Nest to review the existing link |
| `400` response | Shared value is not a valid HTTP or HTTPS URL | Restrict Share Sheet input to URLs and use First Item |
| Shortcut stops at Get Contents of URL | Server, DNS, TLS, or network failure | Confirm the Link Nest URL opens over HTTPS in Safari |

## Revoke or Replace the Token

Open Link Nest Settings, find `iPhone Shortcut`, and tap **Revoke**. Create a new
Read + Write token and replace the old value in the Authorization header.

## Apple References

- [Receive onscreen items from other apps](https://support.apple.com/en-ca/guide/shortcuts/apd350ce757a/ios)
- [Request your first API in Shortcuts](https://support.apple.com/en-au/guide/shortcuts/apd58d46713f/ios)
- [Use the Show Notification action](https://support.apple.com/guide/shortcuts/use-the-show-notification-action-apd2175adcab/ios)

# Chatbot

Embeds an AI chatbot in the wiki per `Special:Chatbot`. 

Legacy support for [h2ogpt](https://github.com/h2oai/h2ogpt) e. g. with [h2ogpt-cpu](https://github.com/OpenSemanticWorld/h2ogpt-cpu-docker-compose).

Never developments build around [osw-chatbot](https://github.com/opensemanticworld/osw-chatbot).

## Features

Chatbot Popup

![](docs/chatbot-extension-screenshot.png)

Legacy:

 * [Special page](https://www.mediawiki.org/wiki/Manual:Special_pages) (specials/SpecialChatbot.php)
 * [Parser hook](https://www.mediawiki.org/wiki/Manual:Parser_functions) (Chatbot/Chatbot.hooks.php)


Usage with [Extension:Iframe](https://github.com/sigbertklinke/Iframe)

in LocalSettings.php
```php
wfLoadExtension( 'Iframe' );
$wgIframe['width'] = "100%";
$wgIframe['server']['chat'] = [ 'scheme' => 'https', 'domain' => '<your_chat_server>' ];
```

On any page
```html
<iframe key="chat" path=""/>
```

## Config

In `LocalSettings.php`:

```php
wfLoadExtension( 'Chatbot' );

// Url of the chat backend to embed. `panel serve` publishes the app under the
// name of its script, hence the /main suffix.
$wgChatbotPopupAssistentConfig = [
    'iframe_src' => 'https://osw-chatbot.your-domain.com/main',
];

// What the assistant may do. Only 'websearch' is on by default - installing
// the extension never grants it write access to the wiki.
//   websearch  search the web (runs in the backend)
//   redirect   navigate the user to another page
//   edit       create and change pages and their slots
//   delete     delete pages
//   script     write JavaScript/CSS, user scope only - see below
//   upload     store a file the user attached to the chat as a WikiFile
$wgChatbotActions = [ 'websearch', 'redirect', 'edit', 'upload' ];

// Which of those ask the user first. This is a dialog in the browser, shown
// before the tool runs; the assistant cannot bypass it.
$wgChatbotConfirmActions = [ 'websearch', 'redirect', 'script', 'upload' ];

// Shared with the backend (CHATBOT_SHARED_SECRET there). Enables the signed
// per-user token described below. Leave empty to run the backend open.
$wgChatbotSecret = '';           // e.g. bin2hex(random_bytes(32))
$wgChatbotTokenTtl = 43200;      // seconds

// Origins a user may enter in the "Custom backend for iframe" preference.
// Empty (the default) hides that preference entirely - see Development.
$wgChatbotAllowedBackendOrigins = [];
```

## How it talks to the backend

The backend runs in a **cross-origin iframe**, so everything goes over
`postMessage`. Both sides validate `event.origin` *and* `event.source`; without
that, any page able to reach the window could make the wiki run the tool
functions below with the logged-in user's session.

**Client-side tools.** The backend asks the wiki to execute a function
(`where_am_i`, `get_page_content`, `smw_ask_query`, `get_file_data_url`,
`redirect`, …) and the wiki replies with the result. These run in the user's own
browser, so they are bounded by that user's MediaWiki permissions - the backend
never acts on the user's behalf, it only asks the browser to.

**Storage delegation.** The backend cannot rely on its own `localStorage`
(third-party storage is partitioned in Chrome/Firefox and blocked under Safari
ITP), so it asks the wiki to store the chat history for it, via
`chatbot_storage_get` / `_set` / `_remove`. The **wiki** builds the key -
`osw-chatbot:<wgDBname>:<user>:<key>` - and rejects anything outside that
namespace, which is what keeps one user's history away from another's.

**Writing.** With `edit` enabled the assistant can create and change pages through
`edit_page` (MwJson's slot API - `main`, `jsondata`, `jsonschema`, `header`, `footer`, the
`*_template` slots), and with `delete` it can delete them. Only the slots it names are
touched. Every refusal - missing rights, protected page, edit conflict, an abuse filter -
is mapped to a plain sentence and handed back to the assistant, which relays it instead of
claiming success. MediaWiki checks the user's rights on every write regardless of what is
configured here; `$wgChatbotActions` only narrows what the assistant is allowed to attempt.

**Uploads.** A file the user attaches to the chat stays in the browser; the chat page hands
it to the wiki page, which uploads it as `File:OSW<uuid>.<ext>` - an instance of
`Category:WikiFile` with `type`, `uuid`, a self-referencing `file` and a label from the
original filename, plus the usual header/footer invokes. Each upload mints a fresh id, so it
never overwrites an existing file. Needs the `upload` right.

### Scripts run for their author only

`script` lets the assistant build small components - a visualization, a widget - as a user
script. It may write **only** inside the current user's own space (`User:<name>/…`), and
site-wide JavaScript such as `MediaWiki:Common.js` is refused even for interface admins.

That is deliberate. The usual pattern loads a script from `MediaWiki:Common.js` through a
CSS class on a page, so it runs for *every visitor*; combined with a script in user space
that would let any user run code in everyone's browser. A component therefore works for its
author, and going site-wide stays a reviewed, interface-admin operation.

> **Prerequisite:** `$wgAllowUserJs = true`. MediaWiki disables personal JavaScript by
> default, and with it off a `User:<name>/Foo.js` page saves fine but is **never loaded** -
> the component silently does nothing. The assistant warns about this when it writes a
> script to a wiki where the setting is off. No extra rights are needed otherwise:
> `editmyuserjs` is granted to the `user` group by default.

**Identity.** `action=chatbottoken` issues a short lived token
`base64url(json{u,w,iat,exp,n}).base64url(hmac_sha256)` signed with
`$wgChatbotSecret`; `chatbot.js` appends it to the iframe url and the backend
verifies it. It is an API module rather than a `mw.config` var so that a
per-user secret never lands in cached page output. Anonymous readers are issued
a token for the user `anon`.

The token also carries the two action lists. `websearch` runs in the backend rather than in
the browser, so this is the only way the backend can learn whether it is allowed - and
because the payload is signed, a client cannot widen it. Without a configured secret the
backend falls back to web search only; the write actions are enforced in the browser either
way.

## Development

Run a custom instance of [osw-chatbot](https://github.com/opensemanticworld/osw-chatbot)

Allow its origin in `LocalSettings.php` - **without this the preference below is
not shown and any previously saved value is ignored**, because it hands the
whole tool-call channel (page content, file downloads, redirects) to whatever
origin is entered:

```php
$wgChatbotAllowedBackendOrigins = [ 'http://localhost:52670' ];
```

Navigate to Settings > Chatbot (`Special:Preferences#mw-prefsection-chatbot`)

Set `Custom backend for iframe` to your custom instance server, e.g. `http://localhost:52670/main`

The backend also has to accept this wiki as a parent (`PARENT_ORIGIN`) and as a
websocket origin (`BOKEH_ALLOW_WS_ORIGIN`); see the osw-chatbot README.


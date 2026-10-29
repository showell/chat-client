# The client's contract with the server

What this client needs from the host that serves it: the pages' elements and
`data-*` attributes, the inline JSON, the requests it makes and the answers
it reads, the SSE streams and their frames, and the classes of the rendered
markdown. Both chats serve this client, angry-gopher's Zig chat and the Roc
chat (roc-webbox `chat/`), so both owe it everything below.

Each field is cited at the line of `js/` that reads it. The same contract,
machine-readable, is [`contract/contract.json`](contract/contract.json), and
`node tools/test_contract.mjs` holds the client to it (see "The tests").
The two files are one contract: the tests fail when this one lacks a payload,
field or citation the JSON has.

## How to read it

- **Placeholders.** `<conv-base>` is the conversation's URL root, the page's
  `data-conv-base`: `/chat/c/<pair>` for a DM, `/channel/<name>` for a
  channel. `<session-base>` is `<conv-base>/<session>`, the open topic's URL.
  `<sid>` is a topic id, `<id>` a message id (`<sid>_<n>`), `<slug>` a doc's
  slug, `<q>` a URL-encoded query value.
- **Must send.** "yes": a server must send the field, and the client goes
  wrong without it, often silently (a missing `topics` reads as "No sessions
  yet"). "no": the client gives its absence a meaning (`from_uid` absent is a
  message from before accounts; `online` absent is not online).
- **Types** are JSON's, with "integer" for a whole number. An HTML
  attribute is always a string; "of digits" says it must read as a count.
- **Sent, and not read.** Fields a server sends that the client ignores.
  They may change freely; a server checking itself must still list them, or
  the check calls them unknown (see "Checking a server").

## Pages

The client finds these elements by id (`getElementById`) and these classes
by selector. Elements and `data-*` attributes the client makes and reads
itself are in `client_made` in the JSON; no server sends them.

| page | element | what it is | read at |
|---|---|---|---|
| conversation | `#chat-root` | holds the attributes in `page_chat_root` | js/chat.js:2 |
| conversation | `#chat-notify` | the status strip (also on Recent, Code, Images and Docs; notify.js does nothing without it) | js/notify.js:16 |
| conversation | `#chat-left-sidebar` | the rail's mount | js/chat.js:344 |
| conversation | `#chat-sidebar-data` | `<script type="application/json">`: `sidebar_data` | js/chat.js:341 |
| conversation | `#chat-feed` | the feed's mount; the rail goes back in before it on a wide screen (js/chat_responsive.js:80) | js/chat.js:172 |
| conversation | `#chat-right-sidebar` | the compose rail's mount | js/chat.js:354 |
| conversation | `.chat-layout` | the desktop column holding the three mounts | js/chat_responsive.js:79 |
| no topics yet | `#chat-first-topic` | holds `page_first_topic`'s attribute | js/chat_first_topic.js:12 |
| Recent | `#recent-mount`, `#recent-data` | the mount, and `<script type="application/json">`: `recent_data` | js/recent.js:16, js/recent.js:17 |
| Code | `#code-mount`, `#code-data` | the mount, and `code_data` | js/code.js:12, js/code.js:13 |
| Images | `#images-mount`, `#images-data` | the mount, and `images_data` | js/images.js:12, js/images.js:13 |
| a doc | `#docs-body` | the `<textarea>`, holding `page_docs_body`'s attribute; without it (no doc open) docs.js does nothing | js/docs.js:6 |
| a doc | `#docs-preview` | where the rendered doc goes | js/docs.js:9 |
| a doc | `#docs-status` | optional: the save status | js/docs.js:10 |
| a doc | `#docs-post-btn`, `#docs-posted-dialog`, `#docs-posted-ok` | optional, all three or none: "Post to chat" and its dialog | js/docs.js:72, js/docs.js:73, js/docs.js:74 |
| every page | `#chat-theme-toggle` | optional: an empty `<button>` the client gives its glyph | js/chat_theme.js:9, js/chrome_drawer.js:125 |
| every page | `.chat-top-left` | the top bar's left group; without it there is no mobile drawer | js/chrome_drawer.js:81 |
| every page | `.app-top-user` | the viewer: its `<strong>` is the name, its `<a>`s the account links | js/chrome_drawer.js:124, js/chrome_drawer.js:100, js/chrome_drawer.js:116 |
| every page | `.chat-top-links` | its `<a>`s and `<strong>` are the section nav | js/chrome_drawer.js:108 |

Inline JSON is read with `JSON.parse` of the script's text, so a server may
escape it for a `<script>` (`<` for `<`) as JSON allows.

### `page_chat_root`

The attributes of `<div id="chat-root">` on the conversation page.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `data-conv` | string | yes | js/chat.js:3, js/notify.js:52 | the conversation key: the DM pair (`1_2`) or the channel name |
| `data-session` | string | yes | js/chat.js:4, js/notify.js:52 | the open topic's id |
| `data-conv-base` | string | yes | js/chat.js:9 | the conversation's URL root; every per-topic URL is built on it |
| `data-me` | string | yes | js/chat.js:16, js/chat.js:224 | the viewer's account id: a message is mine when its `from_uid` is this, a reaction when its `uid` is |
| `data-me-name` | string | yes | js/chat.js:17 | the viewer's name: decides mine for a message with no `from_uid` |
| `data-search-min` | string of digits | yes | js/chat.js:327 | the shortest word search looks up, in UTF-8 bytes; `ChatSearch.init` throws without it |
| `data-upload-image-max` | string of digits | yes | js/chat.js:364 | the image cap in bytes; `ChatCompose.init` throws without it |
| `data-upload-video-max` | string of digits | yes | js/chat.js:365 | the video cap in bytes; `ChatCompose.init` throws without it |
| `data-upload-accept` | string | yes | js/chat.js:366 | the file picker's `accept` list; `ChatCompose.init` throws without it |

### `page_first_topic`

The attributes of `<div id="chat-first-topic">`, the page of a conversation
with no topics yet.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `data-conv-base` | string | yes | js/chat_first_topic.js:13 | the Add Topic form posts to `<conv-base>/new` and goes to `<conv-base>/<sid>` |

### `page_docs_body`

The attributes of `<textarea id="docs-body">` on a doc's page.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `data-slug` | string | yes | js/docs.js:8 | the doc's slug, sent with every save and post |

## Requests

Every request the client makes. A form body is
`application/x-www-form-urlencoded`, its fields in the order listed. "Answer"
names the payload read from a 2xx answer.

| method and URL | body | answer | otherwise | sent at |
|---|---|---|---|---|
| GET `<session-base>/saved` | | `saved_ids` | not 2xx: the page says it could not read the saved set | js/chat.js:48 |
| GET `<session-base>/reactions` | | text, one `reaction_line` a line | not 2xx: read as none | js/chat_reactions.js:69 |
| POST `<session-base>/react` | form: `msg`, `emoji`, `on` (`1` add, `0` retract) | status only; the `reaction` frame repaints | not 2xx: "Reaction failed" | js/chat_reactions.js:61 |
| POST `<session-base>/send` | form: `markdown`, `cid`; header `X-Chat-Async: 1` | status only; the message frame carrying the `cid` confirms it | not 2xx, or no echo in 3 s: "The host may be down" | js/chat_compose.js:90 |
| POST `<session-base>/upload` | multipart: `file` | `upload_answer` | not 2xx: the answer's text shown when under 200 characters and not HTML | js/chat_compose.js:216 |
| GET `<session-base>/stream?since=0` | | the topic stream | | js/chat.js:237 |
| GET `<session-base>/raw` | | opened in a new tab (`window.open`) | | js/chat.js:388 |
| GET `<session-base>/download` | | an `<a>` clicked; the server's `Content-Disposition: attachment` keeps the page | | js/chat.js:394 |
| POST `<conv-base>/new` | form: `topic` | `topic_created` | not 2xx: the answer's text shown under the form | js/chat_add_topic.js:71 |
| POST `<conv-base>/<sid>/pin` | | status only | not 2xx: the row goes back | js/chat_drag_to_pin.js:187 |
| POST `<conv-base>/<sid>/unpin` | | status only | not 2xx: the row goes back | js/chat_drag_to_pin.js:187 |
| POST `/chat/docs/save_to_reading_list` | form: `conv`, `sid`, `id`, `from`, `at` (in the viewer's zone), `body`, `note` | status only | not 2xx: "Save failed" | js/chat.js:127 |
| GET `/chat/msg/<id>` | | opened in a new tab; the server redirects to the message's topic | | js/chat.js:167 |
| GET `/chat/search/words?prefix=<q>` | | `search_words` | a redirect (to the login page) reads as signed out; 429: too fast; 503: not ready; any other not 200: failed (js/chat_search.js:87) | js/chat_search.js:162 |
| GET `/chat/search/messages?word=<q>` | | `search_messages` | as above | js/chat_search.js:197 |
| GET `/chat/sidebar/stream` | | the sidebar stream | | js/chat_left_sidebar.js:230 |
| GET `/chat/notifications` | | the notifications stream | | js/notify.js:54 |
| GET `/chat/recent/stream` | | the recent stream | | js/recent.js:241 |
| GET `/chat/code/stream` | | the code stream | | js/code.js:79 |
| GET `/chat/images/stream` | | the images stream | | js/images.js:109 |
| POST `/chat/docs/render` | form: `body` | text: the preview's HTML | not 2xx: the last preview stays | js/docs.js:32 |
| POST `/chat/docs/save` | form: `slug`, `body` | 204 is saved | any other: "Save failed (status)" | js/docs.js:42 |
| BEACON `/chat/docs/save` | as above, by `navigator.sendBeacon` at unload | | | js/docs.js:66 |
| POST `/chat/docs/post` | form: `slug` | `docs_posted` | not 2xx: "Post failed (status)" | js/docs.js:89 |

Every request is same-origin and carries the page's cookies; a gone
session answers search with a redirect to the login page (js/chat_search.js:85).

### Where the client sends the page

| URL | when | sent at |
|---|---|---|
| `<conv-base>/<sid>` | a topic was made | js/chat_left_sidebar.js:285, js/chat_first_topic.js:37 |
| `<conv-base>/<sid>#msg-<id>` | a search result in another topic, `<conv-base>` being the result's `conv` | js/chat_search.js:228 |
| `/chat/c/<conv>/<sid>#msg-<id>` | a doc was posted to chat | js/docs.js:108 |
| `/chat/docs/reading-list` | the link in the "saved" notice | js/chat.js:144 |
| `/chat/docs/<slug>` | a doc's row on Recent | js/recent.js:147 |
| as sent | `url`, `link_url` and `source_url` are used as the server sent them | js/chat_left_sidebar.js:101, js/chat_left_sidebar.js:119, js/notify.js:65, js/recent.js:147, js/styles.js:74 |

A page opened at `#msg-<id>` lands on that message once the backlog is in
(js/chat.js:232).

## Streams

Each stream is an `EventSource`. A frame's `event:` line names its type
(none is `message`), and its `data:` is the payload. The browser reconnects
a dropped stream by itself, sending `Last-Event-ID` when frames carried an
`id:`; the client reads no `id:` line.

| stream | URL | event | data | read at |
|---|---|---|---|---|
| topic | `<session-base>/stream?since=0` (js/chat.js:237) | `backlog-size` | `backlog_size` | js/chat.js:263 |
| | | `message` | `message_frame` | js/chat.js:283 |
| | | `reaction` | `reaction_line` | js/chat.js:281 |
| sidebar | `/chat/sidebar/stream` (js/chat_left_sidebar.js:230) | `message` | `sidebar_user_arrived`, `sidebar_topic_added` or `sidebar_user_online`, told apart by `kind`; another kind is ignored | js/chat_left_sidebar.js:231 |
| notifications | `/chat/notifications` (js/notify.js:54) | `message` | `notification` | js/notify.js:55 |
| recent | `/chat/recent/stream` (js/recent.js:241) | `message` | `recent_chat_event` or `recent_doc_event` | js/recent.js:242 |
| code | `/chat/code/stream` (js/code.js:79) | `message` | `code_entry` | js/code.js:80 |
| images | `/chat/images/stream` (js/images.js:109) | `message` | `images_entry` | js/images.js:110 |

**The topic stream** starts every connection, the first and each reconnect,
with `backlog-size`: how many message frames follow as the backlog. The
client takes those as history (no "sent" notice, no scroll-follow) and every
frame after them as live. A message frame may carry an `id: <index>` line;
the client does not read it. Reactions come as their own frames, the
reaction sidecar's lines verbatim, at any point.

```
event: backlog-size
data: 2

id: 0
data: {"index":0,"from":"Steve","from_uid":"1","at":"2026-10-28T14:05:00Z","html":"<p>Hi</p>\n","markdown":"Hi","id":"plans_1"}

id: 1
data: {"index":1,"from":"Claude","from_uid":"2","at":"2026-10-28T14:06:00Z","html":"<p>Hello</p>\n","markdown":"Hello","id":"plans_2"}

event: reaction
data: {"msg":2,"uid":"1","from":"Steve","emoji":"👍","on":true,"at":"2026-10-28T14:09:00Z"}
```

### `backlog_size`

The data of an `event: backlog-size` frame: the number of message frames
that follow as the backlog, as decimal digits (js/chat.js:270,
js/chat.js:276). Anything else stops the topic and says so.

### `message_frame`

A message on the topic stream, parsed at js/chat.js:284: the record each
bubble is built from, and what quote, refer, edit, save and react read.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `index` | integer | yes | js/chat.js:216, js/message.js:202, js/message.js:252 | 0-based position in the topic; the message number is `index`+1 |
| `from` | string | yes | js/chat.js:285, js/message.js:202, js/chat.js:123 | the author's name as of the message |
| `from_uid` | string | no | js/chat.js:285 | the author's account; absent on a message stored before accounts were recorded |
| `at` | string | yes | js/message.js:205, js/message.js:233, js/chat.js:124 | an RFC 3339 UTC instant, shown in the viewer's zone |
| `html` | string | yes | js/message.js:256 | the rendered markdown, sanitized by the server (see "Rendered markdown") |
| `markdown` | string | yes | js/chat.js:217, js/message.js:277, js/chat.js:75 | the message as written; one starting `Edit of MSG_<id>` supersedes that message in place |
| `id` | string | yes | js/chat.js:183, js/message.js:251, js/chat.js:218 | `<sid>_<n>` |
| `cid` | string | no | js/chat.js:301, js/chat.js:311 | the sender's client id, on a live frame only; tells this tab its own send arrived |

Mine is decided by the client, never sent: `from_uid` against `data-me`,
or, without `from_uid`, `from` against `data-me-name` (js/chat.js:285).

### `reaction_line`

One line of GET `<session-base>/reactions`, and the data of each
`reaction` frame; parsed at js/chat_reactions.js:40. The client folds them:
the last line for a message, account and emoji wins.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `msg` | integer | yes | js/chat_reactions.js:42, js/chat_reactions.js:48 | the message number, `index`+1 |
| `emoji` | string | yes | js/chat_reactions.js:44 | |
| `uid` | string | yes | js/chat_reactions.js:46 | the reactor's account; mine when it is `data-me` |
| `from` | string | yes | js/chat_reactions.js:46 | the reactor's name, for the chip's title |
| `on` | boolean | yes | js/chat_reactions.js:46 | true adds, false retracts |

Sent, and not read: `at`.

### `sidebar_data`

The inline `<script type="application/json" id="chat-sidebar-data">` on the
conversation page, parsed at js/chat.js:342 and read by the rail.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `conversations` | array of objects | yes | js/chat_left_sidebar.js:262 | every DM partner, then every channel; missing reads as an empty section |
| conversations[].`id` | string | yes | js/chat_left_sidebar.js:98, js/chat_left_sidebar.js:106 | `uid:<n>` for a person (who gets the presence dot), `ch:<name>` for a channel |
| conversations[].`label` | string | yes | js/chat_left_sidebar.js:110 | |
| conversations[].`url` | string | yes | js/chat_left_sidebar.js:101 | |
| conversations[].`active` | boolean | yes | js/chat_left_sidebar.js:111 | true for the open conversation |
| conversations[].`online` | boolean | no | js/chat_left_sidebar.js:99 | sent, as true, only for a person online |
| `pinned_sessions` | array of `sidebar_topic` | yes | js/chat_left_sidebar.js:264 | this conversation's topics the viewer pinned; missing reads as no pins |
| `topics` | array of `sidebar_topic` | yes | js/chat_left_sidebar.js:268 | its other topics; missing reads as "No sessions yet". It was `sessions` until angry-gopher 838f3572 renamed it, and nothing failed until the client followed (bdc12b50) |

### `sidebar_topic`

One row of `pinned_sessions` or `topics`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `id` | string | yes | js/chat_left_sidebar.js:117 | the topic id: the pin and unpin URLs' `<sid>`, and the row's sort key |
| `label` | string | yes | js/chat_left_sidebar.js:119 | |
| `url` | string | yes | js/chat_left_sidebar.js:119 | |
| `active` | boolean | yes | js/chat_left_sidebar.js:121 | true for the open topic |

### `sidebar_user_arrived`

A sidebar frame: a new member can be talked to.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `kind` | string `user-arrived` | yes | js/chat_left_sidebar.js:236 | |
| `user_id` | string | yes | js/chat_left_sidebar.js:196, js/chat_left_sidebar.js:199 | |
| `user_name` | string | no | js/chat_left_sidebar.js:200 | the row's label; the `user_id` without it |
| `url` | string | yes | js/chat_left_sidebar.js:196, js/chat_left_sidebar.js:201 | the DM's URL, built for each recipient |

Sent, and not read: `conv`.

### `sidebar_topic_added`

A sidebar frame: a topic got its first message.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `kind` | string `topic-added` | yes | js/chat_left_sidebar.js:237 | |
| `conv` | string | yes | js/chat_left_sidebar.js:207 | the conversation key; a topic of another conversation is not shown |
| `sid` | string | yes | js/chat_left_sidebar.js:207, js/chat_left_sidebar.js:212, js/chat_left_sidebar.js:213 | the row's id and label |
| `url` | string | yes | js/chat_left_sidebar.js:207, js/chat_left_sidebar.js:214 | |

### `sidebar_user_online`

A sidebar frame: a member came online.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `kind` | string `user-online` | yes | js/chat_left_sidebar.js:238 | |
| `user_id` | string | yes | js/chat_left_sidebar.js:224, js/chat_left_sidebar.js:225 | |

Sent, and not read: `user_name`.

### `notification`

A frame on `/chat/notifications`, parsed at js/notify.js:56.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `text` | string | yes | js/notify.js:57, js/notify.js:65 | shown as text, never as HTML |
| `link_url` | string | yes | js/notify.js:57, js/notify.js:65 | |
| `conv` | string | no | js/notify.js:63 | with `session`: a ping about the open topic is dropped; absent on a came-online ping |
| `session` | string | no | js/notify.js:63 | |

### `recent_data`

The inline `<script type="application/json" id="recent-data">` on
`/chat/recent`: an array of `recent_chat_event` and `recent_doc_event`,
newest first, parsed at js/recent.js:21. Anything but an array reads as an
empty feed (js/recent.js:23).

### `recent_chat_event`

A chat row on Recent: an item of `recent_data`, or a frame on
`/chat/recent/stream`. A row with the same `url` replaces the one there.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `kind` | string `chat` | yes | js/recent.js:142, js/recent.js:244 | |
| `at` | string | yes | js/recent.js:149, js/recent.js:181, js/recent.js:244 | an RFC 3339 instant; the feed's order |
| `url` | string | yes | js/recent.js:143, js/recent.js:147, js/recent.js:101 | the topic's URL, and the row's identity |
| `who` | string | no | js/recent.js:119, js/recent.js:190, js/recent.js:193 | the last author, `You` for the viewer |
| `where` | string | no | js/recent.js:106, js/recent.js:120 | `in <channel>` or `to <partner>` |
| `topic` | string | no | js/recent.js:167, js/recent.js:177 | |
| `excerpt` | string | no | js/recent.js:186, js/recent.js:196 | |
| `dm` | boolean | no | js/recent.js:105, js/recent.js:114, js/recent.js:158 | sent, as true, only for a DM |

### `recent_doc_event`

A doc row on Recent, as `recent_chat_event`; its identity is its `slug`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `kind` | string `doc` | yes | js/recent.js:142, js/recent.js:244 | |
| `at` | string | yes | js/recent.js:149, js/recent.js:181, js/recent.js:244 | |
| `slug` | string | yes | js/recent.js:144, js/recent.js:147, js/recent.js:101 | |
| `title` | string | no | js/recent.js:177 | the row's title; the `slug` without it |

Sent, and not read: `who`.

### `code_data`

The inline `<script type="application/json" id="code-data">` on `/chat/code`:
an array of `code_entry`, parsed at js/code.js:17. Anything but an array
reads as no entries (js/code.js:19).

### `code_entry`

An entry on `/chat/code`: an item of `code_data`, or a frame on
`/chat/code/stream`, which replaces an entry with the same `source_id`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `source_id` | string | yes | js/code.js:33, js/code.js:84, js/code.js:86 | the message's id, and the entry's identity |
| `from` | string | yes | js/code.js:34 | |
| `at` | string | yes | js/code.js:35 | an RFC 3339 instant, shown in UTC |
| `source_url` | string | yes | js/code.js:36 | |
| `blocks` | array of objects | yes | js/code.js:38 | |
| blocks[].`lang` | string | no | js/code.js:45, js/code.js:52 | empty for none |
| blocks[].`body` | string | yes | js/code.js:61 | shown as text |

Sent, and not read: `conv`.

### `images_data`

The inline `<script type="application/json" id="images-data">` on
`/chat/images`: an array of `images_entry`, parsed at js/images.js:17.
Anything but an array reads as no entries (js/images.js:19).

### `images_entry`

An entry on `/chat/images`, as `code_entry`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `source_id` | string | yes | js/images.js:70, js/images.js:114, js/images.js:117 | |
| `from` | string | yes | js/images.js:71 | |
| `at` | string | yes | js/images.js:72 | |
| `source_url` | string | yes | js/images.js:73 | |
| `images` | array of strings | yes | js/images.js:82 | each an `<img>` tag, sanitized by the server and inserted as HTML |

Sent, and not read: `conv`.

## Answers

### `saved_ids`

The answer of GET `<session-base>/saved`: an array of strings, the ids of
this topic's messages in the viewer's reading list (js/chat.js:49).

### `topic_created`

The answer of POST `<conv-base>/new`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `sid` | string | yes | js/chat_left_sidebar.js:285, js/chat_first_topic.js:37 | the topic made; the page goes to `<conv-base>/<sid>` |

Sent, and not read: `conv`.

### `upload_answer`

The answer of POST `<session-base>/upload`, parsed at js/chat_compose.js:231.
The client inserts a tag for the upload into the compose box.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `url` | string | yes | js/chat_compose.js:233, js/chat_compose.js:241 | |
| `kind` | string: `image` or `video` | yes | js/chat_compose.js:232 | `video` inserts a `<video>`, anything else an `<img>` |
| `name` | string | no | js/chat_compose.js:239 | the `<img>`'s alt; `image` without it |
| `width` | integer | no | js/chat_compose.js:240 | with `height`, both over 0, the `<img>`'s width and height. **Both servers send 0** |
| `height` | integer | no | js/chat_compose.js:240 | as `width` |

### `search_words`

The answer of GET `/chat/search/words?prefix=<q>`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `prefix` | string | yes | js/chat_search.js:175 | the prefix as the server read it; each word begins with it |
| `most` | integer | yes | js/chat_search.js:167 | the cap on words in one answer |
| `unreadable` | integer | no | js/chat_search.js:166, js/chat_search.js:167 | topics the server could not read; said when over 0 |
| `words` | array of objects | yes | js/chat_search.js:165 | in the server's order |
| words[].`word` | string | yes | js/chat_search.js:175, js/chat_search.js:179 | |
| words[].`count` | integer | yes | js/chat_search.js:176 | how many messages hold it |

### `search_messages`

The answer of GET `/chat/search/messages?word=<q>`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `matched` | integer | yes | js/chat_search.js:201, js/chat_search.js:202 | how many messages hold the word, which is more than are sent when capped |
| `unreadable` | integer | no | js/chat_search.js:200, js/chat_search.js:202 | |
| `messages` | array of objects | yes | js/chat_search.js:199 | in the server's order |
| messages[].`conv` | string | yes | js/chat_search.js:188, js/chat_search.js:189, js/chat_search.js:210 | the conversation's URL root (`<conv-base>`), not its key |
| messages[].`kind` | string: `dm` or `channel` | yes | js/chat_search.js:189 | |
| messages[].`sid` | string | yes | js/chat_search.js:188, js/chat_search.js:190, js/chat_search.js:210 | |
| messages[].`id` | string | yes | js/chat_search.js:210 | |
| messages[].`from` | string | yes | js/chat_search.js:207 | |
| messages[].`date` | string | yes | js/chat_search.js:207 | an RFC 3339 instant |
| messages[].`before` | string | yes | js/chat_search.js:208 | the raw markdown before the word, already cut; shown as text |
| messages[].`mark` | string | yes | js/chat_search.js:208 | the word as the index read it |
| messages[].`after` | string | yes | js/chat_search.js:208 | |

Sent, and not read: `word`.

### `docs_posted`

The answer of POST `/chat/docs/post`.

| field | type | must send | read at | note |
|---|---|---|---|---|
| `conv` | string | yes | js/docs.js:93 | the DM pair the doc went to |
| `session` | string | yes | js/docs.js:93 | |
| `id` | string | no | js/docs.js:93 | the message made; the page opens at it |

## Rendered markdown

A message frame's `html` goes into the bubble as it is (js/message.js:256):
the server sanitizes it, and the client styles it (one stylesheet,
js/message.js:66) and routes clicks on it (js/message.js:144). The client
relies on this markup:

| markup | the server sends | the client | read at |
|---|---|---|---|
| `a.msg-ref` | `<a href="#msg-<id>" class="msg-ref">MSG_<id></a>` for each `MSG_<id>` | styles it (`.chat-body a.msg-ref`); a click jumps to the bubble when `<id>` is in the open topic, else opens `/chat/msg/<id>` in a new tab | js/message.js:148, js/chat.js:157 |
| its `href` | `#msg-<sid>_<n>`: the topic is what comes before the last underscore | | js/chat.js:157, js/chat.js:159 |
| `pre` | `<pre><code class="language-<lang>">…</code></pre>` for a fence | styles it (`.chat-body pre`); a click opens the code popup with its text | js/message.js:146 |
| `pre.chat-quote` | `<pre class="chat-quote">…</pre>` for a `~~~ quote` fence | styles it as a quote (`.chat-body pre.chat-quote`); a click opens the code popup as any `pre` | js/message.js:101 |
| `img` | `<img src alt [width height]>` | styles it (`.chat-body img`); a click opens the image popup at its `src` | js/message.js:145 |
| `video` | `<video src controls>` | styles it (`.chat-body video`) | js/message.js:116 |
| `a[target=_blank]` | an external link carries `target="_blank" rel="noopener"` | leaves the click to the browser, so the server's target opens it in a new tab | js/message.js:150, js/message.js:245 |
| `p` | paragraphs | styles the first and last (`.chat-body p:first-child`) | js/message.js:91 |

The client makes the rest of the bubble itself (`.chat-msg`, `.chat-meta`,
`.chat-body`, the buttons, the reaction chips). The server's
`<p class="md-malformed">` and `<code class="language-…">` carry no rule
here; the client does not rely on them.

The preview of a doc (`/chat/docs/render`) is HTML the doc page's own
styles cover; the client puts it in `#docs-preview` as it is (js/docs.js:35).

## Read but never sent

Checked against angry-gopher (zig-server/src) and roc-webbox (chat/*.roc)
as of 2026-10-29: every field the client reads is sent by at least one of
them. One is sent but carries nothing: `upload_answer`'s `width` and
`height` are always 0 from both (roc-webbox chat/Upload.roc `stored_answer`;
angry-gopher zig-server/src/chat_upload.zig), so the branch that gives an
uploaded `<img>` its size (js/chat_compose.js:240) never runs.

## The tests

```
node tools/test_contract.mjs
```

The tests run each script in `node:vm` over a small stand-in for the
browser (`tools/fakedom.mjs`), feed it the JSON's `examples`, and record what
it does: the DOM it builds, the requests it makes, where it sends the page.
Then:

- every example has its payload's shape;
- every citation is a line of `js/` that says the field it is cited for;
- each payload's readers, fed its examples, show what the examples say;
- every field is read under its name: renaming the key in the examples
  must change what the client does, so a reader that reads another name, or
  none, fails;
- the client makes exactly the requests listed, with the form fields
  listed, listens for exactly the stream events listed, and looks up no
  element id or `data-*` attribute that is not listed;
- the markup it styles has its rule, and the markup it routes clicks on
  changes what a click does when the class is gone;
- this file names every payload, field and citation the JSON has.

To see them catch a rename, plant one:
`node tools/test_contract.mjs --plant sidebar_data.topics=sessions` says
`sessions` in the contract and its examples, as if the contract had
followed a server that renamed the key while the client still read
`topics`; the run fails. One test plants the same rename in the examples
alone, as a server sending `sessions`, and holds that the shape check and
the sidebar's reader both catch it.

## Checking a server

A server holds itself to this contract by running its own output through
the same file:

```
node tools/test_contract.mjs --check sidebar_data sidebar.json
node tools/test_contract.mjs --check reaction_line reactions.txt --lines
node tools/test_contract.mjs --check-stream topic stream.txt
node tools/test_contract.mjs --check-page conversation page.html
```

`--check` takes one payload (the names above); `--lines` reads one JSON
value a line. `--check-stream` takes a stream's text as sent (`curl -N`) and
checks each frame by its event. `--check-page` takes a page as served and
checks its elements, the `data-*` attributes of the ones that carry them,
and its inline JSON. Each says "agrees with the contract" and exits 0, or
names each disagreement and exits 1. A key the contract does not name is a
disagreement, so a renamed key is caught on the server's side too; a field
added on purpose goes into its payload's `ignored` list here first.

## Changing the contract

A change to what the client reads changes `contract/contract.json` and this
file in the same commit as the script, and the tests say what else to
change: a new field needs an example that carries it, a citation, and a
reader that the rename check can see read it.

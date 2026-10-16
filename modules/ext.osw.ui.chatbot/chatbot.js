/*@nomin*/
/* note: html template and css code is based on https://gist.github.com/RakeshSingh38/46a8d3e9733927777380bccf561d0c20 */

$(document).ready(function () {

    var container = document.createElement("div");
    container.setAttribute("class", "floating-chat");

    var config = mw.config.get('wgChatbotPopupAssistentConfig');
    var userConfig = {
        "iframe_src": mw.user.options.get("chatbot-custom-backend-iframe-src")
    };

    // Which actions the assistant may perform, and which of them ask first.
    // The site config is the ceiling; the preference can only add confirmations.
    var allowedActions = mw.config.get('wgChatbotActions') || [];
    var confirmActions = (function () {
        var pref = mw.user.options.get('chatbot-confirm-actions');
        if (pref === null || pref === undefined || pref === '') {
            return mw.config.get('wgChatbotConfirmActions') || [];
        }
        return Array.isArray(pref) ? pref : String(pref).split('\n').filter(Boolean);
    })();

    function actionAllowed(action) {
        return allowedActions.indexOf(action) !== -1;
    }
    function actionNeedsConfirm(action) {
        return confirmActions.indexOf(action) !== -1;
    }
    if (userConfig["iframe_src"] && userConfig["iframe_src"] !== ""
        && isAllowedBackend(userConfig["iframe_src"])) {
        config["iframe_src"] = userConfig["iframe_src"];
    }
    //console.log(config);

    if (!config || !config["iframe_src"] || config["iframe_src"] === "") return;

    // A custom backend receives every tool call - page content, file
    // downloads, redirects - so it must be on the configured allowlist.
    // Checked here as well as server side, because a value may have been
    // saved before the allowlist was introduced.
    function isAllowedBackend(src) {
        var allowed = mw.config.get('wgChatbotAllowedBackendOrigins') || [];
        if (!allowed.length) return false;
        try {
            return allowed.indexOf(new URL(src, location.href).origin) !== -1;
        } catch (e) {
            return false;
        }
    }

    // The origin of the backend. Every postMessage we send goes there
    // explicitly, and every message we accept must come from there - otherwise
    // any page able to reach this window could make the wiki run the tool
    // functions below with the logged in user's session.
    var frameOrigin;
    try {
        frameOrigin = new URL(config["iframe_src"], location.href).origin;
    } catch (e) {
        console.error("chatbot: invalid iframe_src", e);
        return;
    }

    container.innerHTML = `
    <i class="fa fa-comments" aria-hidden="true"></i>
    <div class="chat">
        <div class="header">
            <span class="title">
                EVE Chat Assistant
            </span>
            <button class="resize">
                <i aria-hidden="true" class="fa fa-expand"></i>
            </button>
            <button class="close">
                <i class="fa fa-times" aria-hidden="true"></i>
            </button>

        </div>

        <iframe id="chatbot_iframe" style="height: 100%;"></iframe>
        <!-- elements below can be used to render messages directly instead of embedding an iframe -->
        <ul class="messages" style="display:none">
            <li class="self">Test Question?</li>
            <li class="other">Test Response</li>
        </ul>
        <div class="footer" style="display:none">
            <div class="text-box" contenteditable="true" disabled="true"></div>
            <button id="sendMessage">send</button>
        </div>
    </div>
`;
    document.body.appendChild(container);

    var element = $('.floating-chat');
    var myStorage = localStorage;

    if (!myStorage.getItem('chatID')) {
        myStorage.setItem('chatID', createUUID());
    }

    // Namespace for everything the backend asks us to store on its behalf.
    // The backend runs in a third-party iframe where localStorage is
    // partitioned or blocked, so it delegates storage to us - and because we
    // build the key, one wiki user can never read another one's history.
    var storageNamespace = 'osw-chatbot:' + mw.config.get('wgDBname') + ':'
        + (mw.user.isAnon() ? 'anon:' + myStorage.getItem('chatID') : mw.user.getName())
        + ':';

    // The iframe src is set asynchronously: the backend may require a signed
    // token identifying the current user (see ApiChatbotToken.php).
    getBackendUrl(config["iframe_src"]).then(function (src) {
        document.getElementById("chatbot_iframe").src = src;
    });

    function getBackendUrl(baseSrc) {
        return new mw.Api().get({ action: 'chatbottoken', format: 'json' })
            .then(function (data) {
                var token = data && data.chatbottoken && data.chatbottoken.token;
                if (!token) return baseSrc;
                var url = new URL(baseSrc, location.href);
                url.searchParams.set('token', token);
                return url.toString();
            })
            .catch(function () {
                // No token support configured ($wgChatbotSecret unset) - the
                // backend then accepts unauthenticated sessions.
                return baseSrc;
            });
    }

    setTimeout(function () {
        element.addClass('enter');
    }, 1000);

    element.click(openElement);

    var chat_window = null;

    function openElement() {
        // use a separate, detached popup window
        /*     const windowFeatures = "left=100,top=100,width=320,height=320";
            chat_window = window.open(
                "http://localhost:52670/",
                "chatbot_popup",
                windowFeatures,
            );
            if (!chat_window) {
                console.error("Popup window failed")
            }
            return; */
        //var messages = element.find('.messages');
        var textInput = element.find('.text-box');
        element.find('>i').hide();
        element.addClass('expand');
        element.find('.chat').addClass('enter');
        var strLength = textInput.val().length * 2;
        textInput.keydown(onMetaAndEnter).prop("disabled", false).focus();
        element.off('click', openElement);
        if (!element.currentSize) element.currentSize = "small";
        resizeElement(element.currentSize);
        element.find('.header .close').click(closeElement);
        element.find('.header .resize').click(onResizeEvent);
        element.find('#sendMessage').click(sendNewMessage);
        //messages.scrollTop(messages.prop("scrollHeight"));

        chat_window = document.getElementById("chatbot_iframe").contentWindow;
    }

    function onResizeEvent() {
        resizeElement();
    }

    function resizeElement(size) {
        if (!size) {
            // default: toggle size
            if (element.currentSize === "small") size = "large";
            else size = "small";
        }
        if (size === "large") {
            element.currentSize = size;
            element.removeClass('expand');
            element.addClass('expand-large');
            element.find('.header .resize i').removeClass('fa-expand');
            element.find('.header .resize i').addClass('fa-compress');
        }
        else if (size === "small") {
            element.currentSize = size;
            element.removeClass('expand-large');
            element.addClass('expand');
            element.find('.header .resize i').removeClass('fa-compress');
            element.find('.header .resize i').addClass('fa-expand');
        }
        return element.currentSize;
    }

    function closeElement() {
        element.find('.chat').removeClass('enter').hide();
        element.find('>i').show();
        element.removeClass('expand');
        element.removeClass('expand-large');
        element.find('.header .close').off('click', closeElement);
        element.find('.header .resize').off('click', onResizeEvent);
        element.find('#sendMessage').off('click', sendNewMessage);
        element.find('.text-box').off('keydown', onMetaAndEnter).prop("disabled", true).blur();
        setTimeout(function () {
            element.find('.chat').removeClass('enter').show();
            element.click(openElement);
        }, 500);
    }

    function createUUID() {
        // http://www.ietf.org/rfc/rfc4122.txt
        var s = [];
        var hexDigits = "0123456789abcdef";
        for (var i = 0; i < 36; i++) {
            s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
        }
        s[14] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
        s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1); // bits 6-7 of the clock_seq_hi_and_reserved to 01
        s[8] = s[13] = s[18] = s[23] = "-";

        var uuid = s.join("");
        return uuid;
    }

    function sendNewMessage() {
        var userInput = $('.text-box');
        var newMessage = userInput.html().replace(/\<div\>|\<br.*?\>/ig, '\n').replace(/\<\/div\>/g, '').trim().replace(/\n/g, '<br>');

        if (!newMessage) return;

        var messagesContainer = $('.messages');

        messagesContainer.append([
            '<li class="self">',
            newMessage,
            '</li>'
        ].join(''));

        // clean out old message
        userInput.html('');
        // focus on input
        userInput.focus();

        messagesContainer.finish().animate({
            scrollTop: messagesContainer.prop("scrollHeight")
        }, 250);
    }

    function onMetaAndEnter(event) {
        if ((event.metaKey || event.ctrlKey) && event.keyCode == 13) {
            sendNewMessage();
        }
    }


    //// functions callable as tools for the LLM

    async function multiply(a, b) {
        // just a dummy tool with an obvious error
        return a * b + 10;
    }

    async function where_am_i() {
        // returns the current window.location and user information
        let user = mw.user;
        let user_name = "";
        if (user.isAnon()) user_name = "Anonymouse";
        else {
            try {
            // query user display title via smw ask api
            const query = `[[User:${user.getName()}]]`;
            const url = mw.config.get("wgScriptPath") + `/api.php?format=json&action=ask&query=` + encodeURIComponent(query);
            const data = await (await fetch(url)).json();
            if (data.query?.results) {
                for (const result_key of Object.keys(data.query.results)) {
                    user_name = data.query.results[result_key].displaytitle;
                }
            }
            if (!user_name || user_name === "") user_name = user.getName();
            } catch(err) {
                user_name = user.getName(); // fallback
                console.error(err);
            }
        }
        let result = {
            "url": window.location.toString(),
            "title": document.title,
            "content": document.body.outerHTML.substring(0,10000*10),
            "user": {
                // getName() is null for anonymous readers - always send a string
                "id": user.getName() || "anonymous",
                "name": user_name,
            }
        };
        return result;
    }

    async function highlight_html_element(x_path) {
        // Replace 'your-xpath-expression' with your actual XPath expression
        //var xpathExpression = "//*[@id='ooui-php-8']";
        var xpathExpression = x_path;

        try {

        // Evaluate the XPath expression to select matching elements
        var result = document.evaluate(
            xpathExpression,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );

        // Function to apply the initial background color
        function applyBackground() {
            for (var i = 0; i < result.snapshotLength; i++) {
                var element = result.snapshotItem(i);
                // Set the background color to yellow
                element.style.backgroundColor = 'yellow';
            }
        }

        // Function to toggle the border highlight
        function toggleBorder() {
            for (var i = 0; i < result.snapshotLength; i++) {
                var element = result.snapshotItem(i);
                if (element.style.outline) {
                    // Remove the red border
                    element.style.outline = '';
                } else {
                    // Apply the red border
                    element.style.outline = '2px solid red';
                }
            }
        }

        // Apply the yellow background immediately
        applyBackground();

        // Start the interval to flash the red border every 0.5 seconds
        var blinkInterval = setInterval(toggleBorder, 500);

        // Stop the blinking and remove styles after 5 seconds
        setTimeout(function() {
            // Clear the interval to stop blinking
            clearInterval(blinkInterval);

            for (var i = 0; i < result.snapshotLength; i++) {
                var element = result.snapshotItem(i);
                // Remove the red border
                element.style.outline = '';
                // Remove the yellow background color
                element.style.backgroundColor = '';
            }
        }, 5000);

        } catch (err) {
            return "failed: " + err;
        }
        return "success";
    }

    async function redirect(page) {
        if (!actionAllowed("redirect")) return "rejected";

        let url = mw.config.get("wgScriptPath") + "/index.php?title=" + encodeURIComponent(page);
        if (page.startsWith("/") || page.startsWith("http")) url = page;

        if (!await confirm_action("redirect", { url: url })) return "rejected";
        setTimeout(() => {
            window.location = url;
        }, 1000); // wait for pending data transmissions
        return "accepted";
    }

    //// writing to the wiki

    // Human text for the confirmation dialog and for refusals. Kept here rather
    // than in the model's hands so the user always sees the same wording.
    const ACTION_LABELS = {
        websearch: "search the web",
        redirect: "take you to another page",
        edit: "create or change a page",
        delete: "delete a page",
        script: "write a script in your user space",
        upload: "upload a file to the wiki"
    };

    // MediaWiki/MwJson error codes mapped to something a chat user can act on.
    // Anything unmapped falls through to the server's own message.
    const ERROR_MESSAGES = {
        permissiondenied: "You do not have permission to do that on this page.",
        protectedpage: "This page is protected, so it cannot be changed.",
        // what MediaWiki actually answers for site-wide JS/CSS - it does not
        // use permissiondenied for these
        sitejsprotected: "Site-wide JavaScript affects every visitor and can only be "
            + "edited by an interface administrator. Use your own user space instead.",
        sitecssprotected: "Site-wide CSS affects every visitor and can only be edited by "
            + "an interface administrator. Use your own user space instead.",
        userjsprotected: "Only this user may edit their own JavaScript pages.",
        usercssprotected: "Only this user may edit their own CSS pages.",
        cascadeprotected: "This page is protected because it is included on a protected page.",
        blocked: "Your account is blocked from editing.",
        autoblocked: "Your account is blocked from editing.",
        readonly: "The wiki is in read-only mode right now.",
        ratelimited: "You have hit the rate limit - please wait a moment and try again.",
        abusefilter: "An abuse filter rejected this edit.",
        abusefilter_warning: "An abuse filter warned about this edit.",
        spamblacklist: "The content contains a URL that is on the spam blacklist.",
        editconflict: "Someone else changed the page in the meantime - please retry.",
        badtoken: "The edit token expired. Please reload the page and try again.",
        missingtitle: "That page does not exist.",
        cantdelete: "This page cannot be deleted.",
        articleexists: "That page already exists.",
        "mwjson-category-edit-right-denied": "You do not have the rights required to edit pages of this category."
    };

    function errorResult(code, fallback) {
        return {
            ok: false,
            code: code || "unknown",
            message: ERROR_MESSAGES[code] || fallback || "The wiki refused the request."
        };
    }

    function isScriptPage(title) {
        return /\.(js|css|json)$/i.test(title || "");
    }

    /**
     * Gate a write before it is attempted.
     * Returns null when the action may proceed, or an error result object.
     */
    function checkAction(action, title) {
        if (!actionAllowed(action)) {
            return {
                ok: false,
                code: "action-disabled",
                message: "The wiki has not enabled the assistant to "
                    + (ACTION_LABELS[action] || action)
                    + ". An administrator can allow it with $wgChatbotActions."
            };
        }

        if (isScriptPage(title)) {
            // Scripts are a separate, stricter permission than ordinary edits:
            // 'edit' must never be usable to write executable code.
            if (!actionAllowed("script")) {
                return {
                    ok: false,
                    code: "script-disabled",
                    message: "The wiki has not enabled the assistant to write scripts "
                        + "(add 'script' to $wgChatbotActions)."
                };
            }
            const user = mw.user.getName();
            // Site-wide JS/CSS runs for every visitor, so it stays out of reach
            // regardless of the user's rights.
            if (/^MediaWiki:/i.test(title)) {
                return {
                    ok: false,
                    code: "site-script-blocked",
                    message: "Site-wide scripts such as " + title + " run for every visitor and "
                        + "cannot be written by the assistant, even with interface-admin rights. "
                        + "Use your own user space instead."
                };
            }
            if (!user || title.indexOf("User:" + user + "/") !== 0) {
                return {
                    ok: false,
                    code: "out-of-user-scope",
                    message: "The assistant may only write scripts inside your own user space, "
                        + "i.e. pages starting with 'User:" + (user || "<your name>") + "/'."
                };
            }
        }
        return null;
    }

    /**
     * Ask the user. Also exposed as a tool so the backend can ask for actions
     * that run on its side (web search). Resolves true when it may proceed.
     */
    async function confirm_action(action, details) {
        if (!actionNeedsConfirm(action)) return true;
        const what = ACTION_LABELS[action] || action;
        let text = "EVE wants to " + what;
        if (details && details.title) text += ": " + details.title;
        else if (details && details.url) text += ": " + details.url;
        else if (details && details.query) text += ": " + details.query;
        text += ".";
        try {
            return !!await OO.ui.confirm(text);
        } catch (e) {
            // OOUI unavailable (e.g. stripped skin) - fall back rather than
            // silently proceeding without consent.
            return window.confirm(text);
        }
    }

    /**
     * Create or edit a page. `slots` maps slot name to content; json slots take
     * objects. Only the named slots are touched.
     */
    async function edit_page(title, slots, summary) {
        if (!title || typeof title !== "string") {
            return { ok: false, code: "invalid-title", message: "No page title was given." };
        }
        if (!slots || typeof slots !== "object" || Array.isArray(slots) || !Object.keys(slots).length) {
            return { ok: false, code: "invalid-slots", message: "No slot content was given." };
        }

        const blocked = checkAction("edit", title);
        if (blocked) return blocked;
        if (!await confirm_action(isScriptPage(title) ? "script" : "edit",
                                  { title: title, slots: Object.keys(slots) })) {
            return { ok: false, code: "declined", message: "You declined the change." };
        }

        try {
            await mw.loader.using(['ext.mwjson.api', 'ext.mwjson.util']);
            // Always start from getPage: editSlots writes every key of
            // page.slots, so a hand-built object would blank untouched slots.
            const page = await mwjson.api.getPage(title);
            const created = !page.exists;
            for (const slot of Object.keys(slots)) {
                page.slots[slot] = slots[slot];
                page.slots_changed[slot] = true;
            }
            let prepared = page;
            if (Object.keys(slots).indexOf("jsondata") !== -1 && window.osl && osl.util) {
                // Sets the header/footer invokes; without them the entity
                // renders blank. [] skips schema regeneration.
                prepared = await osl.util.postProcessPage(page, []);
            }
            await mwjson.api.updatePage(prepared, { comment: summary || "Edited by the chat assistant" });

            const result = { ok: true, title: title, created: created, slots: Object.keys(slots) };
            if (isScriptPage(title) && mw.config.get('wgAllowUserJs') === false) {
                result.warnings = ["The page was saved, but personal JavaScript is disabled on "
                    + "this wiki ($wgAllowUserJs is false), so the script will not run until an "
                    + "administrator enables it."];
            }
            return result;
        } catch (e) {
            // updatePage already showed a sticky mw.notify - do not add another.
            return errorResult(e && e.code, e && (e.info || e.message));
        }
    }

    // Ask the chat iframe for a file the user staged there. The blob is
    // structure-cloned, so it never becomes base64 and never passes through
    // the chat backend.
    function fetchStagedAttachment(id) {
        return new Promise((resolve) => {
            const requestId = "att-req-" + Math.random().toString(36).slice(2);
            const timer = setTimeout(() => {
                window.removeEventListener("message", onMessage);
                resolve(null);
            }, 15000);
            function onMessage(event) {
                const iframe = document.getElementById("chatbot_iframe");
                if (!iframe || event.source !== iframe.contentWindow) return;
                if (event.origin !== frameOrigin) return;
                const data = event.data;
                if (!data || data.type !== "chatbot_attachment_blob") return;
                if (data.requestId !== requestId) return;
                clearTimeout(timer);
                window.removeEventListener("message", onMessage);
                resolve(data);
            }
            window.addEventListener("message", onMessage);
            replyToBackend({ type: "chatbot_attachment_get", id: id, requestId: requestId });
        });
    }

    // Category:WikiFile - a file page is an entity like any other
    const WIKIFILE_CATEGORY = "Category:OSW11a53cdfbdc24524bf8ac435cbf65d9d";

    async function upload_file(attachment_id, label) {
        const blocked = checkAction("upload", "");
        if (blocked) return blocked;

        const staged = await fetchStagedAttachment(attachment_id);
        if (!staged || !staged.blob) {
            return { ok: false, code: "no-attachment",
                     message: "That attachment is no longer available - ask the user to attach it again." };
        }
        if (!await confirm_action("upload", { title: staged.name })) {
            return { ok: false, code: "declined", message: "You declined the upload." };
        }

        try {
            await mw.loader.using(['ext.mwjson.api', 'ext.mwjson.util', 'ext.OpenSemanticLab.forms']);
            const uuid = mwjson.util.uuidv4();
            const ext = (staged.name || "").includes(".")
                ? staged.name.split(".").pop().toLowerCase() : "bin";
            const target = mwjson.util.OswId(uuid) + "." + ext;   // OSW<uuid>.png
            const title = "File:" + target;

            // mw.Api wants a File with the target name, not the original one
            const file = new File([staged.blob], target,
                                  { type: staged.mime || staged.blob.type });

            let page;
            try { page = await mwjson.api.getFilePage(target); }
            catch (e) { page = await mwjson.api.getPage(title); }

            page.file = file;
            page.file.contentBlob = file;
            page.file.changed = true;
            page.slots['jsondata'] = {
                type: [WIKIFILE_CATEGORY],
                uuid: uuid,
                file: title,
                label: [{ text: label || staged.name,
                          lang: mw.config.get('wgUserLanguage') || 'en' }]
            };
            page.slots_changed['jsondata'] = true;
            page = await osl.util.postProcessPage(page, []);
            await mwjson.api.updatePage(page, { comment: "Uploaded by the chat assistant" });
            return { ok: true, title: title, name: staged.name };
        } catch (e) {
            return errorResult(e && e.code, e && (e.info || e.message));
        }
    }

    async function delete_page(title, reason) {
        if (!title || typeof title !== "string") {
            return { ok: false, code: "invalid-title", message: "No page title was given." };
        }
        const blocked = checkAction("delete", title);
        if (blocked) return blocked;
        if (!await confirm_action("delete", { title: title })) {
            return { ok: false, code: "declined", message: "You declined the deletion." };
        }
        try {
            await mw.loader.using(['ext.mwjson.api']);
            await mwjson.api.deletePage(title, { comment: reason || "Deleted by the chat assistant" });
            return { ok: true, title: title, deleted: true };
        } catch (e) {
            const result = errorResult(e && e.code, e && e.message);
            // deletePage stays silent, unlike updatePage - tell the user here.
            if (mw.notify) mw.notify(result.message, { type: 'error' });
            return result;
        }
    }

    async function full_text_search(query) {
        try {
            const encodedQuery = encodeURIComponent(query);
            let url = mw.config.get("wgScriptPath");
            url += `/index.php?title=Special:Search&limit=100&offset=0&profile=default&search=${encodedQuery}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const searchResults = doc.querySelector('.mw-search-results');
            
            if (searchResults) {
                return searchResults.outerHTML;
            } else {
                return null;
            }
            
        } catch (error) {
            throw error;
        }
    }

    async function find_page_from_topic(topic) {
        let query = mw.config.get("wgScriptPath");
        topic = topic.toLowerCase().replace(/[^0-9a-z]/gi, '');
        query += `/api.php?format=json&action=compoundquery&query=`;
        query += encodeURIComponent(`[[:Category:+]] [[HasNormalizedLabel::${topic}]][[HasOswId::!~*#*]];?HasLabel=displaytitle;?HasType.HasName=type;?HasImage=thumbnail;?HasDescription=desc;limit=1 |[[:Category:+]][[HasNormalizedLabel::~*${topic}*]][[HasOswId::!~*#*]];?HasLabel=displaytitle;?HasType.HasName=type;?HasImage=thumbnail;?HasDescription=desc;limit=7`);
        const data = await (await fetch(query)).json();
        let results = [];
        if (data.query?.results) {
            for (const result_key of Object.keys(data.query.results)) {
                const po = data.query.results[result_key].printouts;
                const label = po.displaytitle?.[0]?.Text?.item[0];
                const description = po.description?.[0]?.Text?.item[0];
                const type = po.type[0];
                results.push({
                    "title": result_key,
                    "label": label ? label : "",
                    "description": description ? description : "",
                    "type": type ? type : "",
                });
            }
        }
        return results;
    }

    async function get_page_content(titles, include_html = true) {

        // get slot content of multiple pages
        const encodedTitles = encodeURIComponent(titles.join('|'));
        const response = await fetch(`${mw.config.get("wgScriptPath")}/api.php?action=query&format=json&prop=revisions&list=&titles=${encodedTitles}&rvprop=ids%7Ctimestamp%7Cflags%7Ccomment%7Cuser%7Ccontent%7Ccontentmodel&rvslots=*`);
        slot_data = await response.json();

        if (include_html) {
            // get html content of multiple pages
            // send multiple parse api requests in parallel
            const promises = titles.map(async (title) => {
                const encodedTitle = encodeURIComponent(title);
                const response = await fetch(`${mw.config.get("wgScriptPath")}/api.php?action=parse&page=${encodedTitle}&format=json`);
                return await response.json();
            });
            const results = await Promise.all(promises);
            let html_contents = {};
            results.forEach((result, index) => {
                if (result.parse && result.parse.text) {
                    html_contents[titles[index]] = result.parse.text["*"];
                } else {
                    html_contents[titles[index]] = null;
                }
            });

            // add html as additional slot
            if (slot_data.query && slot_data.query.pages) {
                for (const pageId of Object.keys(slot_data.query.pages)) {
                    const page = slot_data.query.pages[pageId];
                    if (page.title && html_contents[page.title]) {
                        if (page.revisions && page.revisions[0] && page.revisions[0].slots) {
                            page.revisions[0].slots["html"] = {
                                "contentmodel": "html",
                                "contentformat": "text/html",
                                "*": html_contents[page.title]
                            };
                        }
                    }
                }
            }

        }

        return slot_data;
    };

    async function get_category_schema(category_page) {
        // Special:SlotResolver answers with a rendered "No content" page -
        // status 200, text/html - when the category or its jsonschema slot is
        // missing. The schema bundler then tries to parse the skin's markup
        // and fails with an unreadable parser error, so check first.
        try {
            const url = mw.config.get("wgScriptPath")
                + "/api.php?action=query&format=json&prop=revisions&rvprop=content"
                + "&rvslots=jsonschema&titles=" + encodeURIComponent(category_page);
            const data = await (await fetch(url)).json();
            const pages = (data.query && data.query.pages) || {};
            const page = pages[Object.keys(pages)[0]] || {};
            if ("missing" in page) {
                return { ok: false, code: "missing-category",
                         message: "'" + category_page + "' does not exist on this wiki. "
                             + "Find the right category with find_page_from_topic instead of "
                             + "guessing an OSW-ID." };
            }
            const slots = ((page.revisions || [{}])[0] || {}).slots || {};
            if (!slots.jsonschema || !slots.jsonschema["*"]) {
                return { ok: false, code: "no-schema",
                         message: "'" + category_page + "' has no jsonschema slot, so it is "
                             + "not a category you can create instances of." };
            }
        } catch (err) {
            console.error(err);
            return { ok: false, code: "lookup-failed",
                     message: "Could not look up '" + category_page + "': " + err };
        }

        let config = {};
        config.schema = { "allOf": [] };
        config.schema.allOf.push({ "$ref": osl.util.getAbsoluteJsonSchemaUrl(category_page) });
        config.mode = "default";
        config.lang = mw.config.get('wgUserLanguage');
        // ToDo: Refactor datetime format selection as util in MwJson
		let langDatetimeFormats = {
			"en": {"date": "F d, Y", "time": "G:i K", "datetime-local": "F d, Y G:i K"},
			"de": {"date": "d.m.Y", "time": "H:i", "datetime-local": "d.m.Y H:i"},
		};
		let datetimeFormats = {
			"default": langDatetimeFormats[config.lang ? config.lang : defaultConfig.lang],//No preference
			"mdy": {"date": "F d, Y", "time": "G:i K", "datetime-local": "F d, Y G:i K"}, //16:12, January 15, 2011
			"dmy": {"date": "d.m.Y", "time": "H:i", "datetime-local": "d.m.Y H:i"}, //16:12, 15 January 2011
			"ymd": {"date": "Y/m/d", "time": "H:i", "datetime-local": "Y/m/d H:i"}, //16:12, 2011 January 15
			"ISO 8601": {"date": "Y-m-d", "time": "H:i", "datetime-local": "Z"}, //2011-01-15T16:12:34
		};
		config.format = datetimeFormats[mw.user.options.get("date")];
        config.target = null;
        console.log(config);
        try {
            let jsonschema = new mwjson.schema({jsonschema: config.schema, config: {mode: config.mode, lang: config.lang, format: config.format, target: config.target}});
            await jsonschema.bundle();
            await jsonschema.preprocess();
            return jsonschema.getSchema();
        } catch(err) {
            console.error(err);
            // An empty schema used to be returned here, which the assistant
            // read as "this category has no properties" and happily wrote
            // invalid data from.
            return { ok: false, code: "schema-error",
                     message: "Could not resolve the schema of '" + category_page + "': " + err };
        }
    }

    async function create_category_instance(category_page, default_data) {
        osl.ui.createInstance([category_page], default_data);
        // createInstance opens a modal editor and its promise never settles on
        // cancel, so we cannot await it. Report what actually happened rather
        // than "success" - otherwise the assistant tells the user a page
        // exists that may never be saved.
        return "The form editor is now open, prefilled. The page is only created once the "
            + "user reviews the fields and saves it.";
    }

    async function smw_ask_query(smw_ask_query) {
        let query = mw.config.get("wgScriptPath");
        query += `/api.php?format=json&action=ask&query=${encodeURIComponent(smw_ask_query)}`;
        const data = await (await fetch(query)).json();
        return data;
    }

    async function get_file_data_url(file_title) {
        // construct direct URL to file using Special:Redirect/file/<file_title>
        let url = mw.config.get("wgScriptPath") + "/index.php?title=Special:Redirect/file/" + encodeURIComponent(file_title);
        // load file
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        // generate base64 data URL
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    //// storage delegated to us by the backend (see storageNamespace above)

    function storageKey(key) {
        // Only plain keys - never let the backend address anything outside its
        // own namespace, or any other MediaWiki localStorage entry.
        if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(key)) return null;
        return storageNamespace + key;
    }

    function handleStorageMessage(data) {
        const key = storageKey(data["key"]);
        if (key === null) {
            console.warn("chatbot: rejected storage key", data["key"]);
            return null;
        }
        try {
            if (data["type"] === "chatbot_storage_get") {
                return {
                    "type": "chatbot_storage_result",
                    "id": data["id"],
                    "value": myStorage.getItem(key)
                };
            }
            if (data["type"] === "chatbot_storage_set") {
                myStorage.setItem(key, String(data["value"]));
            }
            if (data["type"] === "chatbot_storage_remove") {
                myStorage.removeItem(key);
            }
        } catch (error) {
            console.warn("chatbot: storage unavailable", error && error.name);
            if (data["type"] === "chatbot_storage_get") {
                return { "type": "chatbot_storage_result", "id": data["id"], "value": null };
            }
        }
        return null;
    }

    function replyToBackend(response) {
        if (!response) return;
        const iframe = document.getElementById("chatbot_iframe");
        if (!iframe || !iframe.contentWindow) return;
        chat_window = iframe.contentWindow;
        chat_window.postMessage(response, frameOrigin);
    }

    window.addEventListener("message", async (event) => {

        try {
            // Only the backend iframe may drive any of this.
            const iframe = document.getElementById("chatbot_iframe");
            if (!iframe || event.source !== iframe.contentWindow) return;
            if (event.origin !== frameOrigin) {
                console.warn("chatbot: dropped message from", event.origin);
                return;
            }

            const data = event.data;
            if (!data || typeof data !== "object") return;

            if (data["type"] && data["type"].indexOf("chatbot_storage_") === 0) {
                replyToBackend(handleStorageMessage(data));
                return;
            }

            if (data["type"] === "function_call") {
                console.log("Received data from child iframe ", event.origin, event.data);
                let response = {
                    "type": "function_call_result",
                    "id": data["id"],
                };

                if (data["name"] === "resize_chatwindow") {
                    response["result"] = await resizeElement(...data["args"]);
                }

                if (data["name"] === "multiply") {
                    response["result"] = await multiply(...data["args"]);
                }

                if (data["name"] === "where_am_i") {
                    response["result"] = await where_am_i(...data["args"]);
                }

                if (data["name"] === "highlight_html_element") {
                    response["result"] = await highlight_html_element(...data["args"]);
                }

                if (data["name"] === "redirect") {
                    response["result"] = await redirect(...data["args"]);
                }

                if (data["name"] === "full_text_search") {
                    response["result"] = await full_text_search(...data["args"]);
                }

                if (data["name"] === "find_page_from_topic") {
                    response["result"] = await find_page_from_topic(...data["args"]);
                }

                if (data["name"] === "get_page_content") {
                    response["result"] = await get_page_content(...data["args"]);
                }

                if (data["name"] === "get_category_schema") {
                    response["result"] = await get_category_schema(...data["args"]);
                }

                if (data["name"] === "create_category_instance") {
                    response["result"] = await create_category_instance(...data["args"]);
                }

                if (data["name"] === "smw_ask_query") {
                    response["result"] = await smw_ask_query(...data["args"]);
                }

                if (data["name"] === "edit_page") {
                    response["result"] = await edit_page(...data["args"]);
                }

                if (data["name"] === "delete_page") {
                    response["result"] = await delete_page(...data["args"]);
                }

                if (data["name"] === "upload_file") {
                    response["result"] = await upload_file(...data["args"]);
                }

                if (data["name"] === "confirm_action") {
                    response["result"] = await confirm_action(...data["args"]);
                }

                if (data["name"] === "get_file_data_url") {
                    response["result"] = await get_file_data_url(...data["args"]);
                }

                replyToBackend(response);
            }
        } catch (error) {
            console.error(error);
        }
    });

});
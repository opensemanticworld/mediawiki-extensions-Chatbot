/*@nomin*/
/* note: html template and css code is based on https://gist.github.com/RakeshSingh38/46a8d3e9733927777380bccf561d0c20 */

$(document).ready(function () {

    var container = document.createElement("div");
    container.setAttribute("class", "floating-chat");

    var config = mw.config.get('wgChatbotPopupAssistentConfig');
    var userConfig = {
        "confirm_redirect": mw.user.options.get("chatbot-confirm-redirect"),
        "iframe_src": mw.user.options.get("chatbot-custom-backend-iframe-src")
    }
    if (userConfig["confirm_redirect"]) config["confirm_redirect"] = true;
    else config["confirm_redirect"] = false;
    if (userConfig["iframe_src"] && userConfig["iframe_src"] !== "") config["iframe_src"] = userConfig["iframe_src"];
    //console.log(config);
    
    if (!config || !config["iframe_src"] || config["iframe_src"] === "") return;

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

        <iframe id="chatbot_iframe" src="${config["iframe_src"]}" style="height: 100%;"></iframe>
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
        resizeElement(element.currentSize)
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
        return element.currentSize
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
            element.find('.chat').removeClass('enter').show()
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
            const data = await (await fetch(url)).json()
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
                "id": user.getName(),
                "name": user_name,
            }
        }
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
            return "failed: " + err
        }
        return "success"
    }

    async function redirect(page) {
        var config = mw.config.get('wgChatbotPopupAssistentConfig');
        var userConfig = {
            "confirm_redirect": mw.user.options.get("chatbot-confirm-redirect"),
            "iframe_src": mw.user.options.get("chatbot-custom-backend-iframe-src")
        }
        if (userConfig["confirm_redirect"]) config["confirm_redirect"] = true;
        else config["confirm_redirect"] = false;
        if (userConfig["iframe_src"]) config["iframe_src"] = userConfig["iframe_src"];

        let url =  mw.config.get("wgScriptPath") + "/index.php?title=" + encodeURIComponent(page);
        if (page.startsWith("/") || page.startsWith("http")) url = page;
        let result = "rejected";
        if (config["confirm_redirect"] === false || window.confirm("EVE wants to guide you to '" + url + "'. Accept?")) {
            result = "accepted";
            setTimeout(() => {
                window.location = url;
            }, 1000) // wait for pending data transmissions
        }
        return result;
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
        const data = await (await fetch(query)).json()
        let results = []
        if (data.query?.results) {
            for (const result_key of Object.keys(data.query.results)) {
                const po = data.query.results[result_key].printouts;
                const label = po.displaytitle?.[0]?.Text?.item[0];
                const description = po.description?.[0]?.Text?.item[0];
                const type = po.type[0]
                results.push({
                    "title": result_key,
                    "label": label ? label : "",
                    "description": description ? description : "",
                    "type": type ? type : "",
                })
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
                            }
                        }
                    }
                }
            }

        }

        return slot_data;
    };

    async function get_category_schema(category_page) {
        let config = {};
        config.schema = { "allOf": [] };
        config.schema.allOf.push({ "$ref": osl.util.getAbsoluteJsonSchemaUrl(category_page) });
        config.mode = "default";
        config.lang = mw.config.get('wgUserLanguage');
        // ToDo: Refactor datetime format selection as util in MwJson
		let langDatetimeFormats = {
			"en": {"date": "F d, Y", "time": "G:i K", "datetime-local": "F d, Y G:i K"},
			"de": {"date": "d.m.Y", "time": "H:i", "datetime-local": "d.m.Y H:i"},
		}
		let datetimeFormats = {
			"default": langDatetimeFormats[config.lang ? config.lang : defaultConfig.lang],//No preference
			"mdy": {"date": "F d, Y", "time": "G:i K", "datetime-local": "F d, Y G:i K"}, //16:12, January 15, 2011
			"dmy": {"date": "d.m.Y", "time": "H:i", "datetime-local": "d.m.Y H:i"}, //16:12, 15 January 2011
			"ymd": {"date": "Y/m/d", "time": "H:i", "datetime-local": "Y/m/d H:i"}, //16:12, 2011 January 15
			"ISO 8601": {"date": "Y-m-d", "time": "H:i", "datetime-local": "Z"}, //2011-01-15T16:12:34
		}
		config.format = datetimeFormats[mw.user.options.get("date")];
        config.target = null
        console.log(config);
        try {
            let jsonschema = new mwjson.schema({jsonschema: config.schema, config: {mode: config.mode, lang: config.lang, format: config.format, target: config.target}});
            await jsonschema.bundle()
            await jsonschema.preprocess()
            return jsonschema.getSchema();
        } catch(err) {
            console.error(err);
            return {}
        }
    }

    async function create_category_instance(category_page, default_data) {
        osl.ui.createInstance([category_page], default_data);
        let result = "success";
        return result;
    }

    async function smw_ask_query(smw_ask_query) {
        let query = mw.config.get("wgScriptPath");
        query += `/api.php?format=json&action=ask&query=${encodeURIComponent(smw_ask_query)}`;
        const data = await (await fetch(query)).json()
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

    window.addEventListener("message", async (event) => {

        try {

            const data = event.data;
            if (data["type"] === "function_call") {
                console.log("Received data from child iframe ", event.origin, event.data);
                let response = {
                    "type": "function_call_result",
                    "id": data["id"],
                };

                if (data["name"] === "resize_chatwindow") {
                    response["result"] = await resizeElement(...data["args"])
                }

                if (data["name"] === "multiply") {
                    response["result"] = await multiply(...data["args"])
                }

                if (data["name"] === "where_am_i") {
                    response["result"] = await where_am_i(...data["args"])
                }

                if (data["name"] === "highlight_html_element") {
                    response["result"] = await highlight_html_element(...data["args"])
                }

                if (data["name"] === "redirect") {
                    response["result"] = await redirect(...data["args"])
                }

                if (data["name"] === "full_text_search") {
                    response["result"] = await full_text_search(...data["args"])
                }

                if (data["name"] === "find_page_from_topic") {
                    response["result"] = await find_page_from_topic(...data["args"])
                }

                if (data["name"] === "get_page_content") {
                    response["result"] = await get_page_content(...data["args"])
                }

                if (data["name"] === "get_category_schema") {
                    response["result"] = await get_category_schema(...data["args"])
                }

                if (data["name"] === "create_category_instance") {
                    response["result"] = await create_category_instance(...data["args"])
                }

                if (data["name"] === "smw_ask_query") {
                    response["result"] = await smw_ask_query(...data["args"])
                }

                if (data["name"] === "get_file_data_url") {
                    response["result"] = await get_file_data_url(...data["args"])
                }

                chat_window = document.getElementById("chatbot_iframe").contentWindow;
                chat_window.postMessage(response, "*")
            }
        } catch (error) {
            console.error(error);
        }
    });

});
(function () {

	/**
	 * @class mw.chatbot
	 * @singleton
	 */
	mw.chatbot = {

		async init() {
			//console.log("Chatbot init");
			const iframe = document.getElementById('Iframe1');
			//const input = iframe.contentDocument.querySelectorAll('[data-testid="textbox"]')[0];
			//const input = await waitForElm('[data-testid="textbox"]');
			//console.log("Wait for input ready")
			let input = await this.waitForElm('[placeholder="Enter to Submit, Shift-Enter for more lines"]', iframe.contentDocument, 3000);
			if (!input) input = await this.waitForElm('[placeholder="Enter to Submit, Shift-Enter for more lines"]', iframe.contentDocument, 3000);
			//console.log(input);

			let uri = location.href;
			// search query is escaped with mw.html.escape();
			const escapings = {
				"<": "&lt;",
				">": "&gt;",
				"'": "&#039;",
				"&": "&amp;",
				"\"": "&quot;"
			};
			for (let unescaped in escapings) {
				uri = uri.replaceAll(escapings[unescaped], unescaped);
			}
			uri = new mw.Uri(uri);

			if (uri.query["q"]) {
				q = uri.query["q"];
				input.value = q;
				var ie = new Event('input', {
					bubbles: true,
					cancelable: true,
				});
				input.dispatchEvent(ie); //svelte binds to input event
				const ke = new KeyboardEvent('keypress', {
					bubbles: true, cancelable: true, key: 'Enter'
				});
				input.dispatchEvent(ke); //svelte binds to keypress event
			}

			// subscribe to changes
			const observer = new MutationObserver(mutations => {
				let links = iframe.contentDocument.querySelectorAll('a');
				//if (!Array.isArray(links)) links = [links];
				links.forEach(e => {
					this.updateLink(e);
				});
			});

			observer.observe(iframe.contentDocument, {
				childList: true,
				subtree: true
			});
		},

		waitForElm(selector, document = undefined, timeout = undefined) {
			if (!document) document = window.document;
			//const iframe = document.getElementById('Iframe1');
			//document = iframe.contentDocument;
			return new Promise(resolve => {
				if (document.querySelector(selector)) {
					return resolve(document.querySelector(selector));
				}

				// set a countdown to give up and reject

				var _timeout = undefined;

				if (timeout) {
					_timeout = setTimeout(
						() => {
							// when the timeout expires, stop watching…
							observer.disconnect();
							// and reject
							//reject('Never showed up.')
							resolve();
						},
						timeout // how long to wait before rejecting
					);
				}

				const observer = new MutationObserver(mutations => {
					if (document.querySelector(selector)) {

						// stop the rejection timeout
						clearTimeout(_timeout);

						observer.disconnect();
						resolve(document.querySelector(selector));
					}
				});

				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
			});
		},

		updateLink(element) {
			let link = element.href;
			let link_maps = [
				{
					"regex": "file/userdata/pages/(?<ns>.+)_(?<title>.+)",
					"fulltitle_template": "{{ns}}:{{title}}"
				},
				{
					"regex": "file/userdata/files/[0-9a-f]{1}/[0-9a-f]{2}/(?<title>.+)",
					"fulltitle_template": "File:{{title}}"
				}
			];
			let strip_extensions = [".html", ".txt"];
			link_maps.forEach(map => {
				let regex = map.regex;
				//let regex = "file/userdata/pages/(?<ns>[^_]+)_(?<title>\S+)"
				//regex = regex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				//console.log(regex);
				let res = new RegExp(regex).exec(
					link,
				);
				if (res) {
					const { ns, title } = res.groups;
					let fulltitle = map.fulltitle_template.replaceAll("{{ns}}", ns).replaceAll("{{title}}", title);
					//link = "/wiki/" + fulltitle;
					link = mw.util.getUrl( fulltitle );
					strip_extensions.forEach(ext => {link = link.replaceAll(ext, ""); });
					//link = link.replaceAll(".html", "");

					element.href = link;

					new mw.Api().get( {
						action: 'query',
						prop: 'info',
						inprop: 'displaytitle',
						titles: fulltitle,
						format: 'json',
						formatversion: '2' //pages as list
					} ).done( function ( data ) {
						//console.log( data );
						if (data && data['query'] && data['query']['pages']) {
							data['query']['pages'].forEach(p => {
								if (p['displaytitle']) element.textContent = p['displaytitle'];
							});
						}
					} );
				}
			});

		}

	};
	const iframe = document.getElementById('Iframe1');
	//iframe.addEventListener( "load", function(e) {

	mw.chatbot.init();

	//} );

}());





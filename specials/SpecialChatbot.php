<?php
/**
 * HelloWorld SpecialPage for HdfHandler extension
 *
 * @file
 * @ingroup Extensions
 */

use SpecialPage;

class SpecialChatbot extends SpecialPage {
	public function __construct() {
		parent::__construct( 'Chatbot', '' );
		$this->mIncludable = true; // make it includeable in other pages
	}

	/**
	 * Show the page to the user
	 *
	 * @param string $par The subpage string argument (if any) => interpreted as file name.
	 *  [[Special:Chatbot/subpage]].
	 */
	public function execute( $par ) {
		$out = $this->getOutput();

		// request params if needed
		// $request = $this->getRequest();
		// $myparam = $request->getText( 'myparam' );

		$out->addModules('ext.chatbot');

		$out->setPageTitle( $this->msg( 'chatbot-special-hdfviewer-title' ) );

		// $out->addHelpLink( 'Displays Hierarchical Data Format (HDF) Files' );

		$out->addWikiMsg( 'chatbot-special-hdfviewer-intro' );

		$params = "";
		if ($par) $params = "?url=/w/index.php?title=Special:Redirect/file/$par";

		$iframe = <<<EOD
		<iframe 
			id="Iframe1" 
			src="/h2ogpt/$params" 

			width="100%" 
			height="1000px" 
			frameborder="0">
		</iframe>
		EOD; #			onload="mw.chatbot.init()"
		$out->addHTML($iframe);
	}

	protected function getGroupName() {
		return 'media';
	}
}


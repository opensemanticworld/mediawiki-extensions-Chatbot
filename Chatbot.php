<?php

if ( function_exists( 'wfLoadExtension' ) ) {
	wfLoadExtension( 'Chatbot' );
	// Keep i18n globals so mergeMessageFileList.php doesn't break
	$wgMessagesDirs['Chatbot'] = __DIR__ . '/i18n';
	$wgExtensionMessagesFiles['ChatbotAlias'] = __DIR__ . '/Chatbot.i18n.alias.php';
	$wgExtensionMessagesFiles['ChatbotMagic'] = __DIR__ . '/Chatbot.i18n.magic.php';
	wfWarn(
		'Deprecated PHP entry point used for Chatbot extension. Please use wfLoadExtension ' .
		'instead, see https://www.mediawiki.org/wiki/Extension_registration for more details.'
	);
	return true;
} else {
	die( 'This version of the Chatbot extension requires MediaWiki 1.25+' );
}

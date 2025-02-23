<?php
/**
 * Hooks for Chatbot extension
 *
 * @file
 * @ingroup Extensions
 */

class ChatbotHooks {

	public static function onBeforePageDisplay( $out ) {

		$out->addModules( 'ext.osw.ui.chatbot' );

		return true;

	}

	// see https://www.mediawiki.org/wiki/Manual:Hooks/ResourceLoaderGetConfigVars
	public static function onResourceLoaderGetConfigVars( array &$vars, $skin, Config $config ): void {
		$vars['wgChatbotPopupAssistentConfig'] = $config->get( 'ChatbotPopupAssistentConfig' );
	}

	public static function onParserFirstCallInit( Parser &$parser ) {
		// important: This needs 	
		// "ExtensionMessagesFiles": { "ChatbotMagic": "Chatbot.i18n.magic.php" }
		// in extension.json

		$parser->setFunctionHook( 'chatbot', 'ChatbotHooks::doSomething' );
	}

	/**
	 * @param Parser &$parser
	 * @param string &$text
	 * @return true
	 */
	public static function doSomething( &$parser, &$text ) {
		// Called in MW text like this: {{#chatbot: }}

		// For named parameters like {{#chatbot: foo=bar | apple=orange | banana }}
		// See: https://www.mediawiki.org/wiki/Manual:Parser_functions#Named_parameters

		return "This text will be shown when calling this in MW text.";
	}
}

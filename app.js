'use strict';

const { OAuth2App } = require('homey-oauth2app');
const myUplinkOAuth2Client = require('./lib/myUplinkOAuth2Client');

const DEBUG = false;
const MYUPLINK_DUMP = false;

class myUplinkApp extends OAuth2App {

  static OAUTH2_CLIENT = myUplinkOAuth2Client; // Default: OAuth2Client
  static OAUTH2_DEBUG = DEBUG; // Default: false
  static OAUTH2_MULTI_SESSION = true; // Default: false
  // static OAUTH2_DRIVERS = ['generic']; // Default: all drivers

  /**
   * onInit is called when the app is initialized.
   */
  async onOAuth2Init() {
    if (DEBUG) {
      this.log('myUplink App has been initialized');
    }
  }

  /**
   * Service dumping to facillitate dumping of the myUplink state (only for debug)
   */
  startDump() {
    if (MYUPLINK_DUMP) {
      this.log('===== START_OF_MYUPLINK_DUMP =====');
    }
    return MYUPLINK_DUMP;
  }

  /**
   * Service dumping to facillitate dumping of the myUplink state (only for debug)
   */
  endDump() {
    if (MYUPLINK_DUMP) {
      this.log('===== END_OF_MYUPLINK_DUMP =====');
    }
    return MYUPLINK_DUMP;
  }

}

module.exports = myUplinkApp;

/**
 * Pending questions:
 * - Definition of which capabilities to use / link to capabilities
 * - Definition of which settings to use
 */

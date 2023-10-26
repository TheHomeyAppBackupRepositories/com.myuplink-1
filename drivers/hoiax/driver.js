/* eslint-disable comma-dangle */

'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

class hoiaxDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onOAuth2Init() {
    // Register Flow Cards etc.
    this.log('Høiax driver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    this.log('onPairListDevices');
    return oAuth2Client.discoverDevices(this);
  }

  /**
   * onPair is triggered when trying to pair a device with homey. It links up functions
   * that need to be available during the pairing process.
   */
  async onPair(session) {
    super.onPair(session);
    const oAuth2ShowViewHandler = session._handlers.get('showView');
    session.setHandler('showView', async (view) => {
      console.log(`view is: ${view}`);
      if (view === 'loading') {
        // Note: this is just a workaround to make sure that the loading icon for devices is shown.
        //   Athom has a bug in their code that prevent the loading icon to show up when jumping
        //   directly from the oAuth2 screen into the list_devices screen
        await session.nextView();
      }
      return oAuth2ShowViewHandler(view);
    });
  }

}

module.exports = hoiaxDriver;

/* eslint-disable comma-dangle */

'use strict';

const { OAuth2Driver } = require('homey-oauth2app');
const DeviceDefinition = require('./deviceDefinition.json');

class genericDriver extends OAuth2Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onOAuth2Init() {
    // Register Flow Cards etc.
    this.log(`${DeviceDefinition.name} driver has been initialized`);
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices({ oAuth2Client }) {
    this.log('onPairListDevices');
    return oAuth2Client.discoverDevices(DeviceDefinition.filter);
  }

}

module.exports = genericDriver;
